import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  register,
  login,
  logout,
  listProjects,
  createProject,
  getProject,
  deleteProject,
  publishProject,
  streamChat,
} from "./api.js";

describe("api.js", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("register posts username/password and returns the parsed body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true }),
    });
    const result = await register("alice", "pw");
    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/register",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "alice", password: "pw" }),
      })
    );
  });

  it("register throws on a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "exists" }),
    });
    await expect(register("alice", "pw")).rejects.toThrow();
  });

  it("login posts username/password and returns the parsed body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const result = await login("alice", "pw");
    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ username: "alice", password: "pw" }),
      })
    );
  });

  it("login throws on a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "bad credentials" }),
    });
    await expect(login("alice", "wrong")).rejects.toThrow();
  });

  it("logout posts with credentials included and returns the parsed body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const result = await logout();
    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/logout",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("listProjects gets /api/projects and returns the projects", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [{ id: "1" }] }),
    });
    const result = await listProjects();
    expect(result).toEqual({ projects: [{ id: "1" }] });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("createProject posts the name and returns the created project", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: "1", name: "X" } }),
    });
    const project = await createProject("X");
    expect(project.id).toBe("1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("createProject sends the name in the body with credentials included", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project: { id: "1", name: "X" } }),
    });
    await createProject("X");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "X" }),
      })
    );
  });

  it("getProject gets /api/projects/:id and returns the project", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ project: { id: "42" } }),
    });
    const result = await getProject("42");
    expect(result).toEqual({ project: { id: "42" } });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects/42",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("getProject throws on a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    });
    await expect(getProject("missing")).rejects.toThrow();
  });

  it("deleteProject deletes /api/projects/:id and returns ok", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const result = await deleteProject("42");
    expect(result).toEqual({ ok: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects/42",
      expect.objectContaining({ method: "DELETE", credentials: "include" })
    );
  });

  it("publishProject posts to /api/projects/:id/publish and returns the published url", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ publishedUrl: "https://example.com/p/42" }),
    });
    const result = await publishProject("42");
    expect(result).toEqual({ publishedUrl: "https://example.com/p/42" });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects/42/publish",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  it("streamChat calls onChunk for each piece and resolves with the full text", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("<html>"));
        controller.enqueue(encoder.encode("</html>"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });
    const chunks = [];
    const full = await streamChat("1", "hi", (c) => chunks.push(c));
    expect(chunks.join("")).toBe("<html></html>");
    expect(full).toBe("<html></html>");
  });

  it("streamChat posts the message to /api/projects/:id/chat", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("ok"));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, body });
    await streamChat("1", "hi", () => {});
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/projects/1/chat",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ message: "hi" }),
      })
    );
  });

  it("streamChat throws on a non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
    });
    await expect(streamChat("1", "hi", () => {})).rejects.toThrow();
  });
});
