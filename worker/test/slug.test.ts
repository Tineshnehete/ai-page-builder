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
});
