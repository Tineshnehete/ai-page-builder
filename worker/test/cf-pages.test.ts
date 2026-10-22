import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createPagesProject,
  deployPagesProject,
  deletePagesProject,
} from "../src/cf-pages";

describe("Cloudflare Pages API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createPagesProject", () => {
    it("reports created:true on a fresh name", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: "abc123",
              name: "test-project",
              subdomain: "test-project",
              domains: ["test-project.pages.dev"],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const result = await createPagesProject(
        "account123",
        "token123",
        "test-project"
      );

      expect(result.created).toBe(true);
      expect(result.alreadyExists).toBe(false);
      expect(result.subdomain).toBe("test-project");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/accounts/account123/pages/projects",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token123",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({
            name: "test-project",
            production_branch: "main",
          }),
        })
      );
    });

    it("reports alreadyExists:true on a name-taken error", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: 8000007,
                message: "Pages project with this name already exists",
              },
            ],
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      );

      const result = await createPagesProject(
        "account123",
        "token123",
        "existing-project"
      );

      expect(result.created).toBe(false);
      expect(result.alreadyExists).toBe(true);
      expect(result.subdomain).toBeUndefined();
    });

    it("throws on other error codes", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: 1234,
                message: "Some other error",
              },
            ],
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      );

      await expect(
        createPagesProject("account123", "token123", "test-project")
      ).rejects.toThrow();
    });
  });

  describe("deployPagesProject", () => {
    it("returns the deployment url on success", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: "deploy123",
              url: "https://deploy-abc123.test-project.pages.dev",
              environment: "production",
              created_on: "2024-01-01T00:00:00Z",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const result = await deployPagesProject(
        "account123",
        "token123",
        "test-project",
        "<html><body>Hello</body></html>"
      );

      expect(result.url).toBe(
        "https://deploy-abc123.test-project.pages.dev"
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/accounts/account123/pages/projects/test-project/deployments",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer token123",
          }),
        })
      );
    });

    it("throws on error response", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Deploy failed" }],
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        )
      );

      await expect(
        deployPagesProject(
          "account123",
          "token123",
          "test-project",
          "<html><body>Hello</body></html>"
        )
      ).rejects.toThrow();
    });
  });

  describe("deletePagesProject", () => {
    it("returns ok:true on successful delete", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const result = await deletePagesProject(
        "account123",
        "token123",
        "test-project"
      );

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/accounts/account123/pages/projects/test-project",
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({
            Authorization: "Bearer token123",
          }),
        })
      );
    });

    it("returns ok:false on a non-2xx response", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Not found" }],
          }),
          { status: 500, headers: { "content-type": "application/json" } }
        )
      );

      const result = await deletePagesProject(
        "account123",
        "token123",
        "test-project"
      );

      expect(result.ok).toBe(false);
    });
  });
});
