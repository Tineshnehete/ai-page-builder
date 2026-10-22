import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/auth";

describe("session cookie signing and verification", () => {
  it("verifySession returns the username for a freshly signed cookie", async () => {
    const cookie = await signSession("alice", "secret", 3600);
    expect(await verifySession(cookie, "secret")).toEqual({ username: "alice" });
  });

  it("verifySession rejects a tampered signature", async () => {
    const cookie = await signSession("alice", "secret", 3600);
    const tampered = cookie.slice(0, -2) + "xx";
    expect(await verifySession(tampered, "secret")).toBeNull();
  });

  it("verifySession rejects an expired cookie even with a valid signature", async () => {
    const cookie = await signSession("alice", "secret", -1);
    expect(await verifySession(cookie, "secret")).toBeNull();
  });
});
