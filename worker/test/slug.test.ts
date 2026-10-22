import { describe, it, expect } from "vitest";
import { slugify, buildPagesProjectName } from "../src/slug";

describe("slug generation", () => {
  it("slugify lowercases and strips non-alphanumeric characters to hyphens", () => {
    expect(slugify("My Cool Site!!")).toBe("my-cool-site");
  });

  it("buildPagesProjectName combines username and project name", () => {
    expect(buildPagesProjectName("alice", "My Site", 0)).toBe("alice-my-site");
  });

  it("buildPagesProjectName appends the attempt number past zero", () => {
    expect(buildPagesProjectName("alice", "My Site", 2)).toBe("alice-my-site-2");
  });

  it("buildPagesProjectName handles empty-slug edge cases", () => {
    // When username slugifies to empty, should not create leading hyphen
    expect(buildPagesProjectName("!!!", "My Site", 0)).toBe("my-site");

    // When project name slugifies to empty, should not create trailing hyphen
    expect(buildPagesProjectName("alice", "!!!", 0)).toBe("alice");

    // When project name slugifies to empty with attempt, should collapse hyphens
    expect(buildPagesProjectName("alice", "!!!", 2)).toBe("alice-2");

    // When both username and project name slugify to empty with attempt, no leading/trailing/double hyphens
    expect(buildPagesProjectName("!!!", "!!!", 2)).toBe("2");
  });

  it("buildPagesProjectName caps long names within Cloudflare's 58-char limit, suffix included", () => {
    const longUser = "averyveryverylongusername";
    const longProject = "My Extremely Long Project Name That Keeps Going And Going";
    const base = buildPagesProjectName(longUser, longProject, 0);
    expect(base.length).toBeLessThanOrEqual(50);
    expect(base.startsWith("averyveryverylongusername-my-extremely-long")).toBe(true);
    expect(base).not.toMatch(/-$/);

    const suffixed = buildPagesProjectName(longUser, longProject, 12);
    expect(suffixed.length).toBeLessThanOrEqual(58);
    expect(suffixed).toBe(`${base}-12`);
  });

  it("buildPagesProjectName trims a hyphen left at the truncation point", () => {
    // 49 chars of username + "-" lands the hyphen exactly at position 50.
    const user = "a".repeat(49);
    const name = buildPagesProjectName(user, "site", 0);
    expect(name).toBe(user);
    expect(buildPagesProjectName(user, "site", 3)).toBe(`${user}-3`);
  });
});
