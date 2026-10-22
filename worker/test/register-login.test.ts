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
});
