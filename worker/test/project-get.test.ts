import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

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

describe("get single project", () => {
  it("gets a project the user owns", async () => {
    const cookie = await registerAndLogin("hank", "pw123456");
    const created = await createProject(cookie, "Portfolio");
    const res = await SELF.fetch(`https://example.com/api/projects/${created.id}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).project.name).toBe("Portfolio");
  });

  it("returns 404 for an id that doesn't exist", async () => {
    const cookie = await registerAndLogin("ivy", "pw123456");
    const res = await SELF.fetch("https://example.com/api/projects/does-not-exist", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });
});
