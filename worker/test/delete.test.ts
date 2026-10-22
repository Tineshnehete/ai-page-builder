import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";

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

async function createProject(
  cookie: string,
  name: string
): Promise<{ id: string; name: string }> {
  const res = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { project: { id: string; name: string } };
  return body.project;
}

async function publishProject(
  cookie: string,
  name: string
): Promise<{ id: string; name: string }> {
  const project = await createProject(cookie, name);

  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: "abc123", name: "pages-project", subdomain: "pages-project" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          result: { id: "deploy123", url: "https://deploy-abc123.pages-project.pages.dev" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

  const res = await SELF.fetch(`https://example.com/api/projects/${project.id}/publish`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);

  vi.restoreAllMocks();

  return project;
}

describe("delete endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a never-published project without calling the Pages API", async () => {
    const cookie = await registerAndLogin("liam", "pw123456");
    const project = await createProject(cookie, "Draft");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    const after = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      headers: { Cookie: cookie },
    });
    expect(after.status).toBe(404);
  });

  it("keeps the project when the Pages deletion call fails", async () => {
    const cookie = await registerAndLogin("mia", "pw123456");
    const project = await publishProject(cookie, "Live");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const res = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(502);
    const after = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      headers: { Cookie: cookie },
    });
    expect(after.status).toBe(200);
  });

  it("returns 404 deleting a project that doesn't exist", async () => {
    const cookie = await registerAndLogin("noah", "pw123456");
    const res = await SELF.fetch("https://example.com/api/projects/does-not-exist", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  it("rejects delete with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects/whatever", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});
