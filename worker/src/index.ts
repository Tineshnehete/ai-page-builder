// Worker API entry point.
// See docs/superpowers/specs/2026-10-22-ai-page-builder-design.md for
// the full design (auth, chat/generate, publish, delete).

import { hashPassword, verifyPassword, signSession, verifySession } from "./auth";
import { UserRecord, Project, ChatMessage } from "./user-do";
import { checkHtmlForAbuse } from "./abuse-filter";
import { createPagesProject, deployPagesProject, deletePagesProject } from "./cf-pages";
import { buildPagesProjectName } from "./slug";
import { buildPrompt, extractHtml, streamGeneration, AiBinding } from "./generate";

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // Handle POST /api/projects/:id/publish
    const publishMatch = url.pathname.match(/^\/api\/projects\/(.+)\/publish$/);
    if (publishMatch && request.method === "POST") {
      const session = await requireSession(request, env);
      if (session instanceof Response) {
        return session;
      }
      return handlePublishProject(publishMatch[1], session, env);
    }

    // Handle POST /api/projects/:id/chat
    const chatMatch = url.pathname.match(/^\/api\/projects\/(.+)\/chat$/);
    if (chatMatch && request.method === "POST") {
      const session = await requireSession(request, env);
      if (session instanceof Response) {
        return session;
      }
      return handleChatProject(chatMatch[1], request, session, env, ctx);
    }

    // Handle GET /api/projects/:id
    const projectIdMatch = url.pathname.match(/^\/api\/projects\/(.+)$/);
    if (projectIdMatch && request.method === "GET") {
      const session = await requireSession(request, env);
      if (session instanceof Response) {
        return session;
      }
      const projectId = projectIdMatch[1];
      return handleGetProject(projectId, session, env);
    }

    // Handle DELETE /api/projects/:id
    if (projectIdMatch && request.method === "DELETE") {
      const session = await requireSession(request, env);
      if (session instanceof Response) {
        return session;
      }
      const projectId = projectIdMatch[1];
      return handleDeleteProject(projectId, session, env);
    }

    // Chat/generate routes are left to the builder
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

async function handleGetProject(
  projectId: string,
  session: { username: string },
  env: Env
): Promise<Response> {
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);
  const res = await stub.fetch(`https://do/internal/projects/${projectId}`);
  if (res.status !== 200) {
    return new Response("Not found", { status: res.status });
  }
  const body = await res.json();
  return Response.json(body, { status: res.status });
}

async function handleDeleteProject(
  projectId: string,
  session: { username: string },
  env: Env
): Promise<Response> {
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);

  const getRes = await stub.fetch(`https://do/internal/projects/${projectId}`);
  if (getRes.status !== 200) {
    return new Response("Not found", { status: 404 });
  }
  const { project } = (await getRes.json()) as { project: Project };

  if (project.everPublished && project.pagesProjectName) {
    const result = await deletePagesProject(
      env.CF_ACCOUNT_ID,
      env.CF_API_TOKEN,
      project.pagesProjectName
    );
    if (!result.ok) {
      return Response.json({ error: "cf_delete_failed" }, { status: 502 });
    }
  }

  const deleteRes = await stub.fetch(`https://do/internal/projects/${projectId}`, {
    method: "DELETE",
  });
  const body = await deleteRes.json();
  return Response.json(body, { status: deleteRes.status });
}

const MAX_CREATE_ATTEMPTS = 5;

async function handlePublishProject(
  projectId: string,
  session: { username: string },
  env: Env
): Promise<Response> {
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);

  const getRes = await stub.fetch(`https://do/internal/projects/${projectId}`);
  if (getRes.status !== 200) {
    return new Response("Not found", { status: 404 });
  }
  const { project } = (await getRes.json()) as { project: Project };

  // The abuse check runs on every publish, before any Cloudflare API call.
  const abuseResult = checkHtmlForAbuse(project.html);
  if (abuseResult.blocked) {
    return Response.json(
      { error: "abuse_check_failed", reason: abuseResult.reason },
      { status: 400 }
    );
  }

  let pagesProjectName = project.pagesProjectName;

  try {
    // Only the first publish needs to create the Pages project.
    if (!pagesProjectName) {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        const candidateName = buildPagesProjectName(session.username, project.name, attempt);
        const result = await createPagesProject(env.CF_ACCOUNT_ID, env.CF_API_TOKEN, candidateName);
        if (result.created) {
          pagesProjectName = candidateName;
          break;
        }
        // result.alreadyExists: try the next attempt's name.
      }
      if (!pagesProjectName) {
        return Response.json({ error: "cf_api_error" }, { status: 502 });
      }
    }

    const deployResult = await deployPagesProject(
      env.CF_ACCOUNT_ID,
      env.CF_API_TOKEN,
      pagesProjectName,
      project.html
    );

    await stub.fetch(`https://do/internal/projects/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({
        pagesProjectName,
        publishedUrl: deployResult.url,
        everPublished: true,
      }),
    });

    return Response.json({ publishedUrl: deployResult.url }, { status: 200 });
  } catch {
    return Response.json({ error: "cf_api_error" }, { status: 502 });
  }
}

async function handleChatProject(
  projectId: string,
  request: Request,
  session: { username: string },
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const id = env.USER_DO.idFromName(session.username);
  const stub = env.USER_DO.get(id);

  const getRes = await stub.fetch(`https://do/internal/projects/${projectId}`);
  if (getRes.status !== 200) {
    return new Response("Not found", { status: 404 });
  }
  const { project } = (await getRes.json()) as { project: Project };

  const { message } = (await request.json()) as { message: string };

  const prompt = buildPrompt(project.html, message);
  // `env.AI`'s real type (`Ai<AiModels>`) has a much narrower `run` overload
  // set than `streamGeneration`'s intentionally loose `AiBinding` shape (see
  // generate.ts); the module is designed to accept anything shaped like
  // `{ run: Function }`, including the real binding, so this cast just
  // bridges that structural gap.
  const { stream, done } = streamGeneration(env.AI as unknown as AiBinding, prompt);

  // The HTTP response below starts streaming immediately; persistence has
  // to happen once the full model output is known, which is after the
  // response has already been handed back to the client. `ctx.waitUntil`
  // keeps this Worker invocation alive long enough for that persist call to
  // complete, without making the client wait for it on top of the stream.
  const persist = done
    .then((fullText) => {
      const html = extractHtml(fullText);
      const now = Date.now();
      const userMessage: ChatMessage = { role: "user", content: message, timestamp: now };
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: html,
        timestamp: now,
      };
      const chatHistory = [...project.chatHistory, userMessage, assistantMessage];
      return stub.fetch(`https://do/internal/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify({ html, chatHistory }),
      });
    })
    .catch(() => {
      // Generation or persistence failed; nothing further to do here since
      // the response stream has already reported the error to the client.
    });
  ctx.waitUntil(persist);

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
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
