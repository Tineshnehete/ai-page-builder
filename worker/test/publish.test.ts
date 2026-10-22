import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifySession } from "../src/auth";
import { mockCloudflareApi } from "./cf-api-mock";

const SESSION_SECRET = "test-secret"; // matches wrangler.test.toml

async function registerAndLogin(username: string, password: string): Promise<string> {
  await SELF.fetch("https://example.com/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const login = await SELF.fetch("https://example.com/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const setCookie = login.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("login did not set a session cookie");
  }
  return setCookie.split(";")[0];
}

async function createProjectWithHtml(
  cookie: string,
  name: string,
  html: string
): Promise<{ id: string; name: string }> {
  const session = await verifySession(cookie.split("=")[1], SESSION_SECRET);
  if (!session) {
    throw new Error("could not decode session from cookie");
  }

  const res = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { project: { id: string; name: string } };

  // Directly set the project's html via the internal DO route.
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);
  await stub.fetch(`https://do/internal/projects/${body.project.id}`, {
    method: "PUT",
    body: JSON.stringify({ html }),
  });

  return body.project;
}

interface StoredProject {
  pagesProjectName: string | null;
  publishedUrl: string | null;
  everPublished: boolean;
}

async function getStored(cookie: string, projectId: string): Promise<StoredProject> {
  const res = await SELF.fetch(`https://example.com/api/projects/${projectId}`, {
    headers: { Cookie: cookie },
  });
  return ((await res.json()) as { project: StoredProject }).project;
}

function publish(cookie: string, projectId: string) {
  return SELF.fetch(`https://example.com/api/projects/${projectId}/publish`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
}

describe("publish endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks publish on abuse-flagged html without calling the Pages API", async () => {
    const cookie = await registerAndLogin("jack", "pw123456");
    const project = await createProjectWithHtml(
      cookie,
      "Bad",
      `<form action="https://evil.example.com"><p>password</p></form>`
    );
    const cf = mockCloudflareApi();
    const res = await publish(cookie, project.id);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe("abuse_check_failed");
    expect(cf.spy).not.toHaveBeenCalled();
    expect(cf.calls).toHaveLength(0);
  });

  it("publishes a clean project and stores the stable pages.dev url, not the per-deployment url", async () => {
    const cookie = await registerAndLogin("kate", "pw123456");
    const project = await createProjectWithHtml(cookie, "Good", "<html><body>hi</body></html>");

    const cf = mockCloudflareApi({
      createProject: () => ({
        body: { success: true, result: { name: "kate-good", subdomain: "kate-good-x1y.pages.dev" } },
      }),
      createDeployment: () => ({
        body: { success: true, result: { url: "https://deploy-abc123.kate-good-x1y.pages.dev" } },
      }),
    });

    const res = await publish(cookie, project.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publishedUrl: string };
    expect(body.publishedUrl).toBe("https://kate-good-x1y.pages.dev");
    expect(cf.routes()).toEqual([
      "createProject",
      "uploadToken",
      "checkMissing",
      "upload",
      "upsertHashes",
      "createDeployment",
    ]);

    const stored = await getStored(cookie, project.id);
    expect(stored.everPublished).toBe(true);
    expect(stored.pagesProjectName).toBe("kate-good");
    expect(stored.publishedUrl).toBe("https://kate-good-x1y.pages.dev");
  });

  it("re-publishing reuses the Pages project and keeps the same url", async () => {
    const cookie = await registerAndLogin("kim", "pw123456");
    const project = await createProjectWithHtml(cookie, "Site", "<html><body>v1</body></html>");

    mockCloudflareApi();
    expect((await publish(cookie, project.id)).status).toBe(200);
    const first = await getStored(cookie, project.id);
    vi.restoreAllMocks();

    const cf = mockCloudflareApi({
      createDeployment: () => ({ body: { success: true, result: { url: "https://zzz999.proj.pages.dev" } } }),
    });
    const res = await publish(cookie, project.id);
    expect(res.status).toBe(200);
    expect(cf.routes()).not.toContain("createProject");
    expect(((await res.json()) as { publishedUrl: string }).publishedUrl).toBe(first.publishedUrl);
  });

  it("records the created Pages project even if the first deploy fails, and the retry skips creation", async () => {
    const cookie = await registerAndLogin("kai", "pw123456");
    const project = await createProjectWithHtml(cookie, "Retry", "<html><body>hi</body></html>");

    mockCloudflareApi({
      createProject: () => ({ body: { success: true, result: { subdomain: "kai-retry.pages.dev" } } }),
      createDeployment: () => ({ status: 500, body: { success: false, errors: [{ message: "boom" }] } }),
    });
    const failed = await publish(cookie, project.id);
    expect(failed.status).toBe(502);

    const afterFail = await getStored(cookie, project.id);
    expect(afterFail.pagesProjectName).toBe("kai-retry");
    expect(afterFail.everPublished).toBe(false);
    vi.restoreAllMocks();

    const cf = mockCloudflareApi();
    const retried = await publish(cookie, project.id);
    expect(retried.status).toBe(200);
    expect(cf.routes()).not.toContain("createProject");
    expect(((await retried.json()) as { publishedUrl: string }).publishedUrl).toBe(
      "https://kai-retry.pages.dev"
    );
    const afterRetry = await getStored(cookie, project.id);
    expect(afterRetry.everPublished).toBe(true);
    expect(afterRetry.pagesProjectName).toBe("kai-retry");
  });

  it("tries a suffixed name when the first Pages project name is taken", async () => {
    const cookie = await registerAndLogin("kurt", "pw123456");
    const project = await createProjectWithHtml(cookie, "Taken", "<html><body>hi</body></html>");

    let creates = 0;
    mockCloudflareApi({
      createProject: () => {
        creates++;
        return creates === 1
          ? { status: 409, body: { success: false, errors: [{ code: 8000007, message: "already exists" }] } }
          : { body: { success: true, result: { subdomain: "kurt-taken-1.pages.dev" } } };
      },
    });
    const res = await publish(cookie, project.id);
    expect(res.status).toBe(200);
    expect(creates).toBe(2);
    expect((await getStored(cookie, project.id)).pagesProjectName).toBe("kurt-taken-1");
  });

  it("returns 404 publishing a project that doesn't exist", async () => {
    const cookie = await registerAndLogin("liam", "pw123456");
    const res = await publish(cookie, "does-not-exist");
    expect(res.status).toBe(404);
  });

  it("rejects publish with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects/whatever/publish", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});
