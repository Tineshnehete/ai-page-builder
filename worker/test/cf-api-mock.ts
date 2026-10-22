import { vi } from "vitest";

/**
 * A fake of the Cloudflare Pages API, installed over `globalThis.fetch`.
 *
 * Responses are constructed lazily, inside the fetch call. That matters:
 * a `Response` created in the test's own request context can't have its
 * body read from the worker handler's context under SELF.fetch ("Cannot
 * perform I/O on behalf of a different request"), which made the previous
 * `mockResolvedValueOnce(new Response(...))` fixtures 502 every time.
 *
 * Routes by method + URL to a handler; unknown routes return a 500 so a
 * test fails loudly rather than reaching the network.
 */
export type CfRoute =
  | "createProject"
  | "uploadToken"
  | "checkMissing"
  | "upload"
  | "upsertHashes"
  | "createDeployment"
  | "deleteProject";

export type CfHandler = (req: { url: string; init?: RequestInit }) => {
  status?: number;
  body: unknown;
};

const ok = (result: unknown) => ({ status: 200, body: { success: true, result } });

export function defaultCfHandlers(projectSubdomain = "proj.pages.dev"): Record<CfRoute, CfHandler> {
  return {
    createProject: () => ok({ id: "p1", name: "proj", subdomain: projectSubdomain }),
    uploadToken: () => ok({ jwt: "upload-jwt" }),
    checkMissing: ({ init }) => ok(JSON.parse(String(init?.body)).hashes),
    upload: () => ok(null),
    upsertHashes: () => ok(null),
    createDeployment: () => ok({ id: "d1", url: "https://abc123.proj.pages.dev" }),
    deleteProject: () => ok(null),
  };
}

function routeOf(url: string, method: string): CfRoute | null {
  const u = new URL(url);
  if (u.hostname !== "api.cloudflare.com") return null;
  const p = u.pathname;
  if (method === "POST" && /\/accounts\/[^/]+\/pages\/projects$/.test(p)) return "createProject";
  if (method === "GET" && /\/pages\/projects\/[^/]+\/upload-token$/.test(p)) return "uploadToken";
  if (method === "POST" && p.endsWith("/pages/assets/check-missing")) return "checkMissing";
  if (method === "POST" && p.endsWith("/pages/assets/upload")) return "upload";
  if (method === "POST" && p.endsWith("/pages/assets/upsert-hashes")) return "upsertHashes";
  if (method === "POST" && /\/pages\/projects\/[^/]+\/deployments$/.test(p)) return "createDeployment";
  if (method === "DELETE" && /\/accounts\/[^/]+\/pages\/projects\/[^/]+$/.test(p)) return "deleteProject";
  return null;
}

export interface CfCall {
  route: CfRoute | null;
  url: string;
  method: string;
  init?: RequestInit;
}

export function mockCloudflareApi(overrides: Partial<Record<CfRoute, CfHandler>> = {}) {
  const handlers = { ...defaultCfHandlers(), ...overrides };
  const calls: CfCall[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const route = routeOf(url, method);
    calls.push({ route, url, method, init });
    if (!route) {
      return new Response(JSON.stringify({ success: false, errors: [{ message: "unmocked" }] }), {
        status: 500,
      });
    }
    const { status = 200, body } = handlers[route]({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return {
    spy,
    calls,
    routes: () => calls.map((c) => c.route),
  };
}
