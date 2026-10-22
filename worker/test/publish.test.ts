import { SELF, env } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { verifySession } from "../src/auth";

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

  // Directly set the project's html via the internal DO route; there is no
  // public chat/generate endpoint yet (left to a later task).
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);
  await stub.fetch(`https://do/internal/projects/${body.project.id}`, {
    method: "PUT",
    body: JSON.stringify({ html }),
  });

  return body.project;
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
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await SELF.fetch(`https://example.com/api/projects/${project.id}/publish`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe("abuse_check_failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publishes a clean project and stores the resulting url", async () => {
    const cookie = await registerAndLogin("kate", "pw123456");
    const project = await createProjectWithHtml(cookie, "Good", "<html><body>hi</body></html>");

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { id: "abc123", name: "kate-good", subdomain: "kate-good" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: { id: "deploy123", url: "https://deploy-abc123.kate-good.pages.dev" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

    const res = await SELF.fetch(`https://example.com/api/projects/${project.id}/publish`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publishedUrl: string };
    expect(body.publishedUrl).toMatch(/^https:\/\//);

    const after = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      headers: { Cookie: cookie },
    });
    const afterBody = (await after.json()) as { project: { everPublished: boolean } };
    expect(afterBody.project.everPublished).toBe(true);
  });

  it("returns 404 publishing a project that doesn't exist", async () => {
    const cookie = await registerAndLogin("liam", "pw123456");
    const res = await SELF.fetch("https://example.com/api/projects/does-not-exist/publish", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  it("rejects publish with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects/whatever/publish", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});
