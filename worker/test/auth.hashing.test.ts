import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth";

describe("password hashing", () => {
  it("verifyPassword returns true for the correct password", async () => {
    const { hash, salt } = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash, salt)).toBe(true);
  });

  it("verifyPassword returns false for the wrong password", async () => {
    const { hash, salt } = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong", hash, salt)).toBe(false);
  });

  it("hashing the same password twice produces different hashes (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});
