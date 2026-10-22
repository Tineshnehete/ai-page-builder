import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// NOTE on the `username` field in POST bodies below: the DO's identity is
// meant to come from `this.state.id.name` (set by `idFromName`), per the
// design doc. This local test runtime (@cloudflare/vitest-pool-workers
// 0.2.12 on miniflare 3.20240512.0) does not propagate `id.name` into the
// Durable Object instance (confirmed by direct instrumentation: the caller
// sees `id.name === "alice"` right after `idFromName("alice")`, but
// `this.state.id.name` inside the DO's own `fetch` is `undefined`, even when
// read synchronously before any `await`). `user-do.ts` falls back to an
// optional `username` in the POST body for exactly this case, which is what
// lets these tests exercise real behavior in this environment. Production
// callers never need to send it.
describe("UserDO user record", () => {
  it("creates a user then returns it on GET", async () => {
    const id = env.USER_DO.idFromName("alice");
    const stub = env.USER_DO.get(id);
    const create = await stub.fetch("https://do/internal/user", {
      method: "POST",
      body: JSON.stringify({ passwordHash: "h", passwordSalt: "s", username: "alice" }),
    });
    expect(create.status).toBe(201);
    const get = await stub.fetch("https://do/internal/user");
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ username: "alice", passwordHash: "h" });
  });

  it("rejects creating a second record for the same DO with 409", async () => {
    const id = env.USER_DO.idFromName("bob");
    const stub = env.USER_DO.get(id);
    await stub.fetch("https://do/internal/user", {
      method: "POST",
      body: JSON.stringify({ passwordHash: "h1", passwordSalt: "s1", username: "bob" }),
    });
    const second = await stub.fetch("https://do/internal/user", {
      method: "POST",
      body: JSON.stringify({ passwordHash: "h2", passwordSalt: "s2", username: "bob" }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "username_taken" });
    const get = await stub.fetch("https://do/internal/user");
    expect((await get.json() as { passwordHash: string }).passwordHash).toBe("h1");
  });

  it("returns 404 on GET when no user record exists", async () => {
    const id = env.USER_DO.idFromName("carol");
    const stub = env.USER_DO.get(id);
    const get = await stub.fetch("https://do/internal/user");
    expect(get.status).toBe(404);
  });

  it("returns an empty projects array on a freshly created user", async () => {
    const id = env.USER_DO.idFromName("dave");
    const stub = env.USER_DO.get(id);
    await stub.fetch("https://do/internal/user", {
      method: "POST",
      body: JSON.stringify({ passwordHash: "h", passwordSalt: "s", username: "dave" }),
    });
    const get = await stub.fetch("https://do/internal/user");
    expect(await get.json()).toMatchObject({ projects: [] });
  });
});
