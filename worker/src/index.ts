// Worker API entry point.
// See docs/superpowers/specs/2026-10-22-ai-page-builder-design.md for
// the full design (auth, chat/generate, publish, delete).

export { UserDO } from "./user-do";

export interface Env {
  AI: Ai;
  USER_DO: DurableObjectNamespace;
  SESSION_SECRET: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    // Auth, chat/generate, publish, and delete routes are left to the
    // builder (see design doc "What's Left to the Builder").
    return new Response("Not found", { status: 404 });
  },
};
