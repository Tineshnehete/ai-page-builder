import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/auth";

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
  // setCookie looks like "session=<value>; HttpOnly; Secure; SameSite=Lax; Path=/"
  return setCookie.split(";")[0];
}

describe("session guard, logout, and project create/list", () => {
  it("rejects /api/projects with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects");
    expect(res.status).toBe(401);
  });

  it("rejects /api/projects with a tampered session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: "session=garbage.value" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects /api/projects with a validly signed but expired session cookie", async () => {
    await registerAndLogin("plc-expired", "pw123456");
    // Correctly signed with the Worker's secret, but already past its exp.
    const expired = await signSession("plc-expired", "test-secret", -60);
    expect(await verifySession(expired, "test-secret")).toBeNull();
    const res = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: `session=${expired}` },
    });
    expect(res.status).toBe(401);

    // Same user, same secret, unexpired: accepted -- so the 401 above is
    // down to expiry alone.
    const fresh = await signSession("plc-expired", "test-secret", 60);
    const ok = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: `session=${fresh}` },
    });
    expect(ok.status).toBe(200);
  });

  it("creates and lists a project for the logged-in user", async () => {
    const cookie = await registerAndLogin("fay", "pw123456");
    const create = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ name: "My Site" }),
    });
    expect(create.status).toBe(201);
    const createBody = (await create.json()) as { project: { id: string; name: string } };
    expect(createBody.project.name).toBe("My Site");
    expect(typeof createBody.project.id).toBe("string");

    const list = await SELF.fetch("https://example.com/api/projects", {
      headers: { Cookie: cookie },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { projects: Array<{ name: string }> };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe("My Site");
  });

  it("rejects POST /api/projects with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("logout returns 200 and clears the session cookie", async () => {
    const cookie = await registerAndLogin("gina", "pw123456");
    const logout = await SELF.fetch("https://example.com/api/logout", {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);
    // Sessions are stateless signed cookies (no server-side session store,
    // by design); logout clears the browser's cookie via Max-Age=0 rather
    // than revoking the token itself. A replayed pre-logout cookie staying
    // valid until its TTL expires is an accepted consequence of that
    // design, not something this route is expected to prevent.
    expect(logout.headers.get("set-cookie")).toMatch(/^session=;.*Max-Age=0/);
  });
});
