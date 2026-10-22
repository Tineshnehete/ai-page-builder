// Worker API entry point.
// See docs/superpowers/specs/2026-10-22-ai-page-builder-design.md for
// the full design (auth, chat/generate, publish, delete).

import { hashPassword, verifyPassword, signSession, verifySession } from "./auth";
import { UserRecord, Project, ChatMessage } from "./user-do";
import { checkHtmlForAbuse } from "./abuse-filter";
import {
  createPagesProject,
  deployPagesProject,
  deletePagesProject,
  stablePagesUrl,
} from "./cf-pages";
import { buildPagesProjectName } from "./slug";
import { buildPrompt, extractHtml, extractSummary, streamGeneration, AiBinding } from "./generate";

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
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
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
      return handleChatProject(chatMatch[1], request, session, env);
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

  // Gate on the Pages project existing, not on a successful publish: a
  // first publish can create the Pages project and then fail to deploy.
  if (project.pagesProjectName) {
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
  let publishedUrl = project.publishedUrl;

  try {
    // Only the first publish needs to create the Pages project.
    if (!pagesProjectName) {
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        const candidateName = buildPagesProjectName(session.username, project.name, attempt);
        const result = await createPagesProject(env.CF_ACCOUNT_ID, env.CF_API_TOKEN, candidateName);
        if (result.created) {
          pagesProjectName = candidateName;
          // The project's stable *.pages.dev URL, which stays the same
          // across every future deploy (unlike the per-deployment URL).
          publishedUrl = stablePagesUrl(result.subdomain, candidateName);
          break;
        }
        // result.alreadyExists: try the next attempt's name.
      }
      if (!pagesProjectName) {
        return Response.json({ error: "cf_api_error" }, { status: 502 });
      }

      // Record the created Pages project immediately, before deploying: if
      // the deploy below fails, the next publish reuses this project
      // instead of creating (and orphaning) another one, and delete knows
      // there's a Pages project to clean up.
      const recordRes = await stub.fetch(`https://do/internal/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify({ pagesProjectName, publishedUrl }),
      });
      if (!recordRes.ok) {
        return Response.json({ error: "persist_failed" }, { status: 500 });
      }
    }

    if (!publishedUrl) {
      publishedUrl = stablePagesUrl(undefined, pagesProjectName);
    }

    await deployPagesProject(env.CF_ACCOUNT_ID, env.CF_API_TOKEN, pagesProjectName, project.html);

    const publishRes = await stub.fetch(`https://do/internal/projects/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ publishedUrl, everPublished: true }),
    });
    if (!publishRes.ok) {
      return Response.json({ error: "persist_failed" }, { status: 500 });
    }

    return Response.json({ publishedUrl }, { status: 200 });
  } catch {
    return Response.json({ error: "cf_api_error" }, { status: 502 });
  }
}

async function handleChatProject(
  projectId: string,
  request: Request,
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

  let message: unknown;
  try {
    ({ message } = (await request.json()) as { message?: unknown });
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const userText = message;

  const prompt = buildPrompt(project.html, userText);
  // `env.AI`'s real type (`Ai<AiModels>`) has a large overload set keyed on
  // literal model ids; `streamGeneration` takes the narrower `AiBinding`
  // shape (model id string + inputs object, see generate.ts), which the real
  // binding satisfies at runtime. This cast bridges that structural gap.
  const { stream, done } = streamGeneration(env.AI as unknown as AiBinding, prompt);
  // If generation fails, `stream` errors (which the TransformStream below
  // propagates to the client) and `flush` never runs, so `done`'s rejection
  // would otherwise be unobserved. The error itself is not lost.
  done.catch(() => {});

  // Persist BEFORE the response stream closes: `flush` runs after the last
  // generated chunk has been forwarded, and the client only sees
  // end-of-stream once it resolves. So when `streamChat` resolves on the
  // frontend, the follow-up `getProject` is guaranteed to see the new HTML.
  // If persisting fails, or the model produced no extractable HTML, the
  // stream is errored instead of closed, so the client sees a failure
  // rather than a silent success.
  const persisting = new TransformStream<Uint8Array, Uint8Array>({
    async flush(controller) {
      const fullText = await done;
      const html = extractHtml(fullText);
      const now = Date.now();
      const userMessage: ChatMessage = { role: "user", content: userText, timestamp: now };
      const assistantMessage: ChatMessage = {
        role: "assistant",
        // On success, the chat history shows the model's short human-readable
        // summary (per its prompt contract), not the raw HTML/fence markup —
        // the HTML itself only ever renders in the preview iframe. On
        // extraction failure, record what the model actually said instead,
        // so the turn is still visible in history; the page's HTML is left
        // untouched either way.
        content: html !== null ? extractSummary(fullText) : fullText,
        timestamp: now,
      };
      const chatHistory = [...project.chatHistory, userMessage, assistantMessage];
      const updates = html === null ? { chatHistory } : { html, chatHistory };

      const putRes = await stub.fetch(`https://do/internal/projects/${projectId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      if (!putRes.ok) {
        controller.error(new Error("persist_failed"));
        return;
      }
      if (html === null) {
        controller.error(new Error("no_html_generated"));
      }
    },
  });

  return new Response(stream.pipeThrough(persisting), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Parses `{ username, password }` from a request body, requiring both to be
 * non-empty strings. Returns a 400 Response on malformed input.
 */
async function readCredentials(
  request: Request
): Promise<{ username: string; password: string } | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim() === "" ||
    password === ""
  ) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  return { username, password };
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const credentials = await readCredentials(request);
  if (credentials instanceof Response) {
    return credentials;
  }
  const { username, password } = credentials;

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
  const credentials = await readCredentials(request);
  if (credentials instanceof Response) {
    return credentials;
  }
  const { username, password } = credentials;

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
