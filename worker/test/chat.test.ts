import { SELF, env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import worker, { Env } from "../src/index";

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

// The `AI` binding isn't declared in wrangler.test.toml (there's no way to
// simulate real Workers AI output locally), and `SELF.fetch` dispatches to a
// separate worker instance built solely from that config, so mutating
// `env.AI` from `cloudflare:test` has no effect on it (confirmed by running
// this test with that approach: the route handler saw `env.AI` as
// `undefined`). Instead, these tests call the worker's exported `fetch`
// handler directly with a constructed `Env` that spreads the real test env
// (so DO bindings / vars are still shared with the rest of the test, e.g.
// the follow-up `SELF.fetch` GET below) and overrides `AI` with a fake
// `{ run }`. `createExecutionContext`/`waitOnExecutionContext` are the
// documented cloudflare:test helpers for driving `ctx.waitUntil` to
// completion in this direct-call style.
function fakeAiEnv(run: ReturnType<typeof vi.fn>): Env {
  return { ...(env as Env), AI: { run } as unknown as Env["AI"] };
}

describe("chat endpoint", () => {
  it("streams the model output and persists the extracted html plus chat history", async () => {
    const cookie = await registerAndLogin("noah", "pw123456");
    const project = await createProject(cookie, "Draft");
    const run = vi.fn().mockResolvedValue(
      (async function* () {
        yield { response: "<html><body>new</body></html>" };
      })()
    );
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`https://example.com/api/projects/${project.id}/chat`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ message: "make it say new" }),
      }),
      fakeAiEnv(run),
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html><body>new</body></html>");
    await waitOnExecutionContext(ctx);

    const after = await SELF.fetch(`https://example.com/api/projects/${project.id}`, {
      headers: { Cookie: cookie },
    });
    const { project: stored } = (await after.json()) as {
      project: { html: string; chatHistory: { role: string; content: string }[] };
    };
    expect(stored.html).toBe("<html><body>new</body></html>");
    expect(stored.chatHistory).toHaveLength(2);
    expect(stored.chatHistory[0]).toMatchObject({ role: "user", content: "make it say new" });
    expect(stored.chatHistory[1]).toMatchObject({
      role: "assistant",
      content: "<html><body>new</body></html>",
    });
  });

  it("returns 404 chatting on a project that doesn't exist", async () => {
    const cookie = await registerAndLogin("olive", "pw123456");
    const run = vi.fn();
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.com/api/projects/does-not-exist/chat", {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ message: "hi" }),
      }),
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
