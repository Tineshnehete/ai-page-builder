import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createPagesProject,
  deployPagesProject,
  deletePagesProject,
  stablePagesUrl,
  hashAsset,
} from "../src/cf-pages";
import { mockCloudflareApi } from "./cf-api-mock";

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
              subdomain: "test-project.pages.dev",
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
      expect(result.subdomain).toBe("test-project.pages.dev");
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
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
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

    it("also treats an 'already exists' message with an unexpected code as name-taken", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 8000999, message: "A project with this name already exists." }],
          }),
          { status: 409 }
        )
      );
      const result = await createPagesProject("account123", "token123", "existing-project");
      expect(result.alreadyExists).toBe(true);
    });

    it("throws on other error codes", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
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

  describe("stablePagesUrl", () => {
    it("uses the full subdomain host returned by project creation", () => {
      expect(stablePagesUrl("my-site-abc.pages.dev", "my-site")).toBe("https://my-site-abc.pages.dev");
    });

    it("tolerates a bare subdomain label", () => {
      expect(stablePagesUrl("my-site", "my-site")).toBe("https://my-site.pages.dev");
    });

    it("falls back to the project name", () => {
      expect(stablePagesUrl(undefined, "my-site")).toBe("https://my-site.pages.dev");
    });
  });

  describe("deployPagesProject", () => {
    const html = "<html><body>Héllo</body></html>";

    it("runs the direct-upload flow in order and deploys a manifest pointing at the uploaded asset", async () => {
      const cf = mockCloudflareApi();

      const result = await deployPagesProject("account123", "token123", "test-project", html);

      expect(result.url).toBe("https://abc123.proj.pages.dev");
      expect(cf.routes()).toEqual([
        "uploadToken",
        "checkMissing",
        "upload",
        "upsertHashes",
        "createDeployment",
      ]);

      const [tokenCall, checkCall, uploadCall, upsertCall, deployCall] = cf.calls;
      expect(tokenCall.url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account123/pages/projects/test-project/upload-token"
      );
      expect((tokenCall.init?.headers as Record<string, string>).Authorization).toBe("Bearer token123");

      // Asset endpoints authenticate with the upload JWT, not the API token.
      for (const call of [checkCall, uploadCall, upsertCall]) {
        expect((call.init?.headers as Record<string, string>).Authorization).toBe("Bearer upload-jwt");
      }

      const expectedBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
      const expectedHash = await hashAsset(expectedBase64, "html");
      expect(expectedHash).toMatch(/^[0-9a-f]{32}$/);

      expect(JSON.parse(String(checkCall.init?.body))).toEqual({ hashes: [expectedHash] });
      expect(JSON.parse(String(uploadCall.init?.body))).toEqual([
        {
          key: expectedHash,
          value: expectedBase64,
          metadata: { contentType: "text/html" },
          base64: true,
        },
      ]);
      // The uploaded content round-trips to the original HTML.
      const uploaded = JSON.parse(String(uploadCall.init?.body))[0].value;
      expect(new TextDecoder().decode(Uint8Array.from(atob(uploaded), (c) => c.charCodeAt(0)))).toBe(html);
      expect(JSON.parse(String(upsertCall.init?.body))).toEqual({ hashes: [expectedHash] });

      expect(deployCall.url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/account123/pages/projects/test-project/deployments"
      );
      expect((deployCall.init?.headers as Record<string, string>).Authorization).toBe("Bearer token123");
      const form = deployCall.init?.body as FormData;
      expect(JSON.parse(String(form.get("manifest")))).toEqual({ "/index.html": expectedHash });
      expect(form.get("branch")).toBe("main");
    });

    it("skips the upload when the asset is already present", async () => {
      const cf = mockCloudflareApi({
        checkMissing: () => ({ body: { success: true, result: [] } }),
      });
      await deployPagesProject("account123", "token123", "test-project", html);
      expect(cf.routes()).toEqual(["uploadToken", "checkMissing", "upsertHashes", "createDeployment"]);
    });

    it("throws if getting the upload token fails", async () => {
      const cf = mockCloudflareApi({
        uploadToken: () => ({ status: 403, body: { success: false, errors: [{ message: "forbidden" }] } }),
      });
      await expect(
        deployPagesProject("account123", "token123", "test-project", html)
      ).rejects.toThrow();
      expect(cf.routes()).toEqual(["uploadToken"]);
    });

    it("throws if the asset upload fails, without creating a deployment", async () => {
      const cf = mockCloudflareApi({
        upload: () => ({ status: 500, body: { success: false, errors: [{ message: "upload failed" }] } }),
      });
      await expect(
        deployPagesProject("account123", "token123", "test-project", html)
      ).rejects.toThrow();
      expect(cf.routes()).not.toContain("createDeployment");
    });

    it("throws on a deployment error response", async () => {
      mockCloudflareApi({
        createDeployment: () => ({ status: 500, body: { success: false, errors: [{ message: "Deploy failed" }] } }),
      });
      await expect(
        deployPagesProject("account123", "token123", "test-project", html)
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

    it("returns ok:true when the project is already gone (404)", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: false, errors: [{ message: "Project not found" }] }),
          { status: 404 }
        )
      );
      const result = await deletePagesProject("account123", "token123", "test-project");
      expect(result.ok).toBe(true);
    });

    it("returns ok:false on a non-2xx, non-404 response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ message: "Internal error" }],
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
