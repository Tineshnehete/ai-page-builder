import { describe, it, expect, vi, beforeEach } from "vitest";

// app.js boots on import, so each test mocks api.js, resets the DOM, and
// imports a fresh copy of the module.
const api = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  deleteProject: vi.fn(),
  publishProject: vi.fn(),
  streamChat: vi.fn(),
  isUnauthorized: (err) => Boolean(err) && err.status === 401,
}));
vi.mock("./api.js", () => api);

function httpError(status, message = "error") {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function bootApp() {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  await import("./app.js");
  // Let the boot promise chain settle.
  await new Promise((r) => setTimeout(r, 0));
}

const $ = (sel) => document.querySelector(sel);

describe("app.js boot and session handling", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) {
      if (vi.isMockFunction(fn)) fn.mockReset();
    }
  });

  it("goes straight to the projects view when the existing session is valid", async () => {
    api.listProjects.mockResolvedValue([{ id: "1", name: "Mine", everPublished: false }]);
    await bootApp();
    expect($(".view-projects")).not.toBeNull();
    expect($(".view-auth")).toBeNull();
    expect(document.body.textContent).toContain("Mine");
  });

  it("shows the login screen when there is no valid session", async () => {
    api.listProjects.mockRejectedValue(httpError(401, "unauthorized"));
    await bootApp();
    expect($(".view-auth")).not.toBeNull();
  });

  it("routes back to the login screen on a 401 mid-session instead of a dead end", async () => {
    api.listProjects.mockResolvedValue([{ id: "1", name: "Mine", everPublished: false }]);
    api.getProject.mockRejectedValue(httpError(401, "unauthorized"));
    await bootApp();

    const openBtn = [...document.querySelectorAll(".project-card button")].find(
      (b) => b.textContent === "Open"
    );
    openBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect($(".view-auth")).not.toBeNull();
    expect(document.body.textContent).toContain("session has expired");
  });

  it("keeps the in-place error for non-401 failures", async () => {
    api.listProjects.mockResolvedValue([{ id: "1", name: "Mine", everPublished: false }]);
    api.getProject.mockRejectedValue(httpError(500, "boom"));
    await bootApp();

    const openBtn = [...document.querySelectorAll(".project-card button")].find(
      (b) => b.textContent === "Open"
    );
    openBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect($(".view-auth")).toBeNull();
    expect(document.body.textContent).toContain("boom");
  });
});
