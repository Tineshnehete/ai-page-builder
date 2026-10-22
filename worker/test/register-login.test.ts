import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("register and login routes", () => {
  it("registers a new user", async () => {
    const res = await SELF.fetch("https://example.com/api/register", {
      method: "POST",
      body: JSON.stringify({ username: "alice", password: "pw123456" }),
    });
    expect(res.status).toBe(201);
  });

  it("rejects registering a username that already exists, leaving the original untouched", async () => {
    await SELF.fetch("https://example.com/api/register", {
      method: "POST",
      body: JSON.stringify({ username: "carol", password: "first-pw" }),
    });
    const dup = await SELF.fetch("https://example.com/api/register", {
      method: "POST",
      body: JSON.stringify({ username: "carol", password: "second-pw" }),
    });
    expect(dup.status).toBe(409);
    const login = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "carol", password: "first-pw" }),
    });
    expect(login.status).toBe(200);
  });

  it("rejects login with the wrong password", async () => {
    await SELF.fetch("https://example.com/api/register", {
      method: "POST",
      body: JSON.stringify({ username: "dave", password: "right-pw" }),
    });
    const res = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "dave", password: "wrong-pw" }),
    });
    expect(res.status).toBe(401);
  });

  it("sets a session cookie on successful login", async () => {
    await SELF.fetch("https://example.com/api/register", {
      method: "POST",
      body: JSON.stringify({ username: "erin", password: "right-pw" }),
    });
    const res = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "erin", password: "right-pw" }),
    });
    expect(res.headers.get("set-cookie")).toMatch(/^session=/);
  });

  it("rejects login for a username that was never registered", async () => {
    const res = await SELF.fetch("https://example.com/api/login", {
      method: "POST",
      body: JSON.stringify({ username: "ghost", password: "whatever" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 (not 500) for missing, empty, or non-string credentials", async () => {
    const badBodies = [
      "not json",
      JSON.stringify(null),
      JSON.stringify({}),
      JSON.stringify({ username: "m1-fay" }),
      JSON.stringify({ password: "pw123456" }),
      JSON.stringify({ username: "", password: "pw123456" }),
      JSON.stringify({ username: "   ", password: "pw123456" }),
      JSON.stringify({ username: "m1-fay", password: "" }),
      JSON.stringify({ username: 42, password: "pw123456" }),
      JSON.stringify({ username: "m1-fay", password: ["x"] }),
    ];
    for (const route of ["register", "login"]) {
      for (const body of badBodies) {
        const res = await SELF.fetch(`https://example.com/api/${route}`, { method: "POST", body });
        expect(res.status, `${route} ${body}`).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe("invalid_input");
      }
    }
  });
});
