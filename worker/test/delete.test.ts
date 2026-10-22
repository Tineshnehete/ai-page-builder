import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, afterEach } from "vitest";
import { mockCloudflareApi } from "./cf-api-mock";

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
  name: string,
  overrides: Parameters<typeof mockCloudflareApi>[0] = {}
): Promise<{ id: string; name: string; publishStatus: number }> {
  const project = await createProject(cookie, name);
  mockCloudflareApi(overrides);
  const res = await SELF.fetch(`https://example.com/api/projects/${project.id}/publish`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  vi.restoreAllMocks();
  return { ...project, publishStatus: res.status };
}

function del(cookie: string, projectId: string) {
  return SELF.fetch(`https://example.com/api/projects/${projectId}`, {
    method: "DELETE",
    headers: { Cookie: cookie },
  });
}

function get(cookie: string, projectId: string) {
  return SELF.fetch(`https://example.com/api/projects/${projectId}`, {
    headers: { Cookie: cookie },
  });
}

describe("delete endpoint", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a never-published project without calling the Pages API", async () => {
    const cookie = await registerAndLogin("liam", "pw123456");
    const project = await createProject(cookie, "Draft");
    const cf = mockCloudflareApi();
    const res = await del(cookie, project.id);
    expect(res.status).toBe(200);
    expect(cf.spy).not.toHaveBeenCalled();
    expect((await get(cookie, project.id)).status).toBe(404);
  });

  it("deletes a published project's Pages project, then the project", async () => {
    const cookie = await registerAndLogin("maya", "pw123456");
    const project = await publishProject(cookie, "Live");
    expect(project.publishStatus).toBe(200);
    const cf = mockCloudflareApi();
    const res = await del(cookie, project.id);
    expect(res.status).toBe(200);
    expect(cf.routes()).toEqual(["deleteProject"]);
    expect(cf.calls[0].url).toMatch(/\/pages\/projects\/maya-live$/);
    expect((await get(cookie, project.id)).status).toBe(404);
  });

  it("keeps the project when the Pages deletion call fails", async () => {
    const cookie = await registerAndLogin("mia", "pw123456");
    const project = await publishProject(cookie, "Live");
    expect(project.publishStatus).toBe(200);
    mockCloudflareApi({
      deleteProject: () => ({ status: 500, body: { success: false, errors: [{ message: "boom" }] } }),
    });
    const res = await del(cookie, project.id);
    expect(res.status).toBe(502);
    expect((await get(cookie, project.id)).status).toBe(200);
  });

  it("succeeds when the Pages project was already removed outside the app (404)", async () => {
    const cookie = await registerAndLogin("milo", "pw123456");
    const project = await publishProject(cookie, "Gone");
    expect(project.publishStatus).toBe(200);
    mockCloudflareApi({
      deleteProject: () => ({ status: 404, body: { success: false, errors: [{ message: "not found" }] } }),
    });
    const res = await del(cookie, project.id);
    expect(res.status).toBe(200);
    expect((await get(cookie, project.id)).status).toBe(404);
  });

  it("cleans up a Pages project that was created but whose first deploy failed", async () => {
    const cookie = await registerAndLogin("mona", "pw123456");
    const project = await publishProject(cookie, "Half", {
      createDeployment: () => ({ status: 500, body: { success: false, errors: [{ message: "boom" }] } }),
    });
    expect(project.publishStatus).toBe(502);
    const cf = mockCloudflareApi();
    const res = await del(cookie, project.id);
    expect(res.status).toBe(200);
    expect(cf.routes()).toEqual(["deleteProject"]);
    expect(cf.calls[0].url).toMatch(/\/pages\/projects\/mona-half$/);
  });

  it("returns 404 deleting a project that doesn't exist", async () => {
    const cookie = await registerAndLogin("noah", "pw123456");
    const res = await del(cookie, "does-not-exist");
    expect(res.status).toBe(404);
  });

  it("rejects delete with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects/whatever", {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});
