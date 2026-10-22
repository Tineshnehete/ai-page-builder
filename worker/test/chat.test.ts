import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker, { Env } from "../src/index";
import { verifySession } from "../src/auth";
import { MODEL_ID } from "../src/generate";

const SESSION_SECRET = "test-secret"; // matches wrangler.test.toml

async function registerAndLogin(username: string, password: string): Promise<string> {
  await SELF.fetch("https://example.com/api/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const login = await SELF.fetch("https://example.com/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  const setCookie = login.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("login did not set a session cookie");
  }
  return setCookie.split(";")[0];
}

async function createProject(
  cookie: string,
  name: string
): Promise<{ id: string; name: string }> {
  const res = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { project: { id: string; name: string } };
  return body.project;
}

async function doStub(cookie: string) {
  const session = await verifySession(cookie.split("=")[1], SESSION_SECRET);
  if (!session) throw new Error("could not decode session from cookie");
  return env.USER_DO.get(env.USER_DO.idFromName(session.username));
}

async function getStoredProject(cookie: string, projectId: string) {
  const res = await SELF.fetch(`https://example.com/api/projects/${projectId}`, {
    headers: { Cookie: cookie },
  });
  const { project } = (await res.json()) as {
    project: { html: string; chatHistory: { role: string; content: string }[] };
  };
  return project;
}

/**
 * What the real Workers AI binding resolves to for `stream: true`: a
 * ReadableStream of Server-Sent-Event bytes, `data: {"response":"..."}`
 * frames ending with `data: [DONE]`.
 */
function sseStream(tokens: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const t of tokens) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: t })}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

// The `AI` binding isn't declared in wrangler.test.toml (there's no way to
// simulate real Workers AI output locally), and `SELF.fetch` dispatches to a
// separate worker instance built solely from that config, so mutating
// `env.AI` from `cloudflare:test` has no effect on it. Instead, these tests
// call the worker's exported `fetch` handler directly with a constructed
// `Env` that spreads the real test env (so DO bindings / vars are shared
// with the rest of the test) and overrides `AI` with a fake `{ run }`.
function fakeAiEnv(run: ReturnType<typeof vi.fn>): Env {
  return { ...(env as Env), AI: { run } as unknown as Env["AI"] };
}

function chatRequest(
  projectId: string,
  cookie: string,
  message: unknown,
  style?: unknown
): Request {
  return new Request(`https://example.com/api/projects/${projectId}/chat`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify(style === undefined ? { message } : { message, style }),
  });
}

describe("chat endpoint", () => {
  it("streams the model output and persists the extracted html plus chat history before the stream ends", async () => {
    const cookie = await registerAndLogin("noah", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi
      .fn()
      .mockImplementation(async () =>
        sseStream([
          "SUMMARY: Made it say new.\n```html\n<html><body>",
          "new</body></html>\n```",
        ])
      );
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "make it say new"),
      fakeAiEnv(run),
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      "SUMMARY: Made it say new.\n```html\n<html><body>new</body></html>\n```"
    );

    // No waitOnExecutionContext here on purpose: persistence must already
    // have landed by the time the response stream has ended.
    const stored = await getStoredProject(cookie, project.id);
    expect(stored.html).toBe("<html><body>new</body></html>");
    expect(stored.chatHistory).toHaveLength(2);
    expect(stored.chatHistory[0]).toMatchObject({ role: "user", content: "make it say new" });
    // The chat message shows the model's short human-readable summary, not
    // the raw HTML/fence markup — that only ever renders in the preview.
    expect(stored.chatHistory[1]).toMatchObject({
      role: "assistant",
      content: "Made it say new.",
    });

    expect(run).toHaveBeenCalledTimes(1);
    const [model, inputs] = run.mock.calls[0];
    expect(model).toBe(MODEL_ID);
    expect(inputs).toMatchObject({ stream: true });
    expect(inputs.prompt).toContain("make it say new");
    await waitOnExecutionContext(ctx);
  });

  it("includes the requested style preset's guidance in the prompt", async () => {
    const cookie = await registerAndLogin("nikau", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi
      .fn()
      .mockImplementation(async () => sseStream(["SUMMARY: ok\n```html\n<html></html>\n```"]));
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "add a footer", "dark"),
      fakeAiEnv(run),
      createExecutionContext()
    );
    await res.text();

    const [, inputs] = run.mock.calls[0];
    expect(inputs.prompt).toContain("Dark mode");
  });

  it("falls back to the default style when an unrecognized style is given", async () => {
    const cookie = await registerAndLogin("naia", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi
      .fn()
      .mockImplementation(async () => sseStream(["SUMMARY: ok\n```html\n<html></html>\n```"]));
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "add a footer", "not-a-real-style"),
      fakeAiEnv(run),
      createExecutionContext()
    );
    await res.text();

    const [, inputs] = run.mock.calls[0];
    expect(inputs.prompt).toContain("No specific style preference");
  });

  it("extracts the html from a fenced block wrapped in prose", async () => {
    const cookie = await registerAndLogin("nadia", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi
      .fn()
      .mockImplementation(async () =>
        sseStream(["Here you go:\n```html\n<html><body>fenced</body></html>\n```\nEnjoy!"])
      );
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "change it"),
      fakeAiEnv(run),
      createExecutionContext()
    );
    await res.text();
    const stored = await getStoredProject(cookie, project.id);
    expect(stored.html).toBe("<html><body>fenced</body></html>");
  });

  it("keeps the previous html, records the turn, and errors the stream when no HTML is generated", async () => {
    const cookie = await registerAndLogin("nora", "pw123456");
    const project = await createProject(cookie, "Draft");
    const stub = await doStub(cookie);
    await stub.fetch(`https://do/internal/projects/${project.id}`, {
      method: "PUT",
      body: JSON.stringify({ html: "<html><body>original</body></html>" }),
    });

    const run = vi
      .fn()
      .mockImplementation(async () => sseStream(["Sorry, I can't help with that."]));
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "do something"),
      fakeAiEnv(run),
      createExecutionContext()
    );
    expect(res.status).toBe(200);
    await expect(res.text()).rejects.toThrow();

    const stored = await getStoredProject(cookie, project.id);
    expect(stored.html).toBe("<html><body>original</body></html>");
    expect(stored.chatHistory).toHaveLength(2);
    expect(stored.chatHistory[1]).toMatchObject({
      role: "assistant",
      content: "Sorry, I can't help with that.",
    });
  });

  it("errors the stream and persists nothing when ai.run rejects", async () => {
    const cookie = await registerAndLogin("nell", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi.fn().mockRejectedValue(new Error("AI unavailable"));
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "hi"),
      fakeAiEnv(run),
      createExecutionContext()
    );
    await expect(res.text()).rejects.toThrow();
    const stored = await getStoredProject(cookie, project.id);
    expect(stored.html).toBe("");
    expect(stored.chatHistory).toHaveLength(0);
  });

  it("errors the stream (instead of silently succeeding) when persisting fails", async () => {
    const cookie = await registerAndLogin("nico", "pw123456");
    const project = await createProject(cookie, "Draft");
    const stub = await doStub(cookie);
    const encoder = new TextEncoder();
    // Delete the project out from under the generation, so the final PUT
    // to the DO returns 404.
    const run = vi.fn().mockImplementation(
      async () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            await stub.fetch(`https://do/internal/projects/${project.id}`, { method: "DELETE" });
            controller.enqueue(encoder.encode(`data: {"response":"<html></html>"}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        })
    );
    const res = await worker.fetch(
      chatRequest(project.id, cookie, "hi"),
      fakeAiEnv(run),
      createExecutionContext()
    );
    await expect(res.text()).rejects.toThrow();
  });

  it("returns 400 for a missing or empty message", async () => {
    const cookie = await registerAndLogin("nash", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi.fn();
    for (const message of [undefined, "", "   ", 42]) {
      const res = await worker.fetch(
        chatRequest(project.id, cookie, message),
        fakeAiEnv(run),
        createExecutionContext()
      );
      expect(res.status).toBe(400);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 404 chatting on a project that doesn't exist", async () => {
    const cookie = await registerAndLogin("olive", "pw123456");
    const run = vi.fn();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      chatRequest("does-not-exist", cookie, "hi"),
      fakeAiEnv(run),
      ctx
    );
    expect(res.status).toBe(404);
    await waitOnExecutionContext(ctx);
  });

  it("rejects chat with no session cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/projects/whatever/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hi" }),
    });
    expect(res.status).toBe(401);
  });
});
