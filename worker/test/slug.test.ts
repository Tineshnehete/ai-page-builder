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
  });
});
