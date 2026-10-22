// Worker API entry point.
// See docs/superpowers/specs/2026-10-22-ai-page-builder-design.md for
// the full design (auth, chat/generate, publish, delete).

import { hashPassword, verifyPassword, signSession, verifySession } from "./auth";
import { UserRecord } from "./user-do";

export { UserDO } from "./user-do";

export interface Env {
  AI: Ai;
  USER_DO: DurableObjectNamespace;
  SESSION_SECRET: string;
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/register" && request.method === "POST") {
      return handleRegister(request, env);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout();
    }

    if (url.pathname === "/api/projects" && request.method === "GET") {
      const session = await requireSession(request, env);
      if (session instanceof Response) {
        return session;
      }
      return handleListProjects(session, env);
    }

    if (url.pathname === "/api/projects" && request.method === "POST") {
      const session = await requireSession(request, env);
      if (session instanceof Response) {
        return session;
      }
      return handleCreateProject(request, session, env);
    }

    // Chat/generate, publish, and delete routes are left to the builder
    // (see design doc "What's Left to the Builder").
    return new Response("Not found", { status: 404 });
  },
};

function parseSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Validate the session cookie on an incoming request.
 * Returns the authenticated session info on success, or a 401 Response
 * ready to return directly on failure. Callers should check
 * `instanceof Response` and return it as-is when present.
 */
export async function requireSession(
  request: Request,
  env: Env
): Promise<{ username: string } | Response> {
  const cookieValue = parseSessionCookie(request);
  if (!cookieValue) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await verifySession(cookieValue, env.SESSION_SECRET);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return session;
}

function handleLogout(): Response {
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      },
    }
  );
}

async function handleListProjects(
  session: { username: string },
  env: Env
): Promise<Response> {
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);
  const res = await stub.fetch("https://do/internal/projects");
  const body = await res.json();
  return Response.json(body, { status: res.status });
}

async function handleCreateProject(
  request: Request,
  session: { username: string },
  env: Env
): Promise<Response> {
  const { name } = (await request.json()) as { name: string };

  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);
  const res = await stub.fetch("https://do/internal/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  const body = await res.json();
  return Response.json(body, { status: res.status });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const { username, password } = (await request.json()) as {
    username: string;
    password: string;
  };

  const { hash, salt } = await hashPassword(password);

  const id = env.USER_DO.idFromName(username);
  const stub = env.USER_DO.get(id);
  const createRes = await stub.fetch("https://do/internal/user", {
    method: "POST",
    // `username` is included for the local test runtime, which doesn't
    // propagate `id.name` into the DO instance; see user-do.ts for detail.
    // Production callers rely on `idFromName(username)` alone.
    body: JSON.stringify({ passwordHash: hash, passwordSalt: salt, username }),
  });

  if (createRes.status === 409) {
    return Response.json({ error: "username_taken" }, { status: 409 });
  }

  return Response.json({ ok: true }, { status: 201 });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { username, password } = (await request.json()) as {
    username: string;
    password: string;
  };

  const id = env.USER_DO.idFromName(username);
  const stub = env.USER_DO.get(id);
  const getRes = await stub.fetch("https://do/internal/user");

  if (getRes.status !== 200) {
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const record = (await getRes.json()) as UserRecord;
  const valid = await verifyPassword(password, record.passwordHash, record.passwordSalt);
  if (!valid) {
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const session = await signSession(username, env.SESSION_SECRET, SESSION_TTL_SECONDS);

  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": `session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      },
    }
  );
}
