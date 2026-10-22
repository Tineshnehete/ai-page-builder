# AI Page Builder

Chat with an AI to build a single-page website, preview it live, and
publish it to Cloudflare Pages — multi-user, minimal by design.

Full design (architecture, data model, auth, publish flow, streaming):
[`docs/superpowers/specs/2026-10-22-ai-page-builder-design.md`](docs/superpowers/specs/2026-10-22-ai-page-builder-design.md)

## Project layout

```
worker/   Cloudflare Worker — API (auth, chat/generate, publish, delete),
          the UserDO Durable Object (per-user data), and static serving
          of the frontend in web/ (via wrangler.toml [assets])
web/      Static frontend (plain JS, no build step), served by the Worker
docs/     Design docs
```

## Stack

- **Cloudflare Workers** — API backend, and serves the app's own UI as
  static assets from the same origin (no CORS, session cookie just works)
- **Durable Objects** — one `UserDO` per user, storing that user's
  projects (HTML, chat history, publish state)
- **Workers AI** — chat-driven HTML generation, streamed to the client
- **Cloudflare Pages** — each *user project* gets its own Pages project
  (and stable `*.pages.dev` URL) on publish, via the Pages API

## How It Works

### Chat → AI generation lifecycle

1. The browser sends `POST /api/projects/:id/chat { message, style }` with
   the session cookie (`web/api.js`'s `streamChat`).
2. The Worker (`handleChatProject` in `worker/src/index.ts`) loads the
   project's current HTML from its `UserDO`, then builds a prompt
   (`buildPrompt` in `worker/src/generate.ts`) with three labeled
   sections, in this order:
   - **WEBSITE DEFINITION** — the page's current, complete HTML.
   - **STYLING PREFERENCES** — the plain-English guidance for the chosen
     style preset (`default`/`dark`/`modern`/`minimal`/`playful`/
     `corporate`; an unrecognized or missing one falls back to
     `default`).
   - **REQUESTED CHANGE** — the user's chat message.

   The prompt also tells the model to answer in exactly one format: a
   `SUMMARY: <sentence>` line, then the full updated HTML document inside
   a ```` ```html ```` fence.
3. The Worker calls Workers AI — `env.AI.run(MODEL_ID, { prompt, stream:
   true, max_tokens })` — via the native `AI` binding declared in
   `wrangler.toml`'s `[ai]` block (no separate SDK package; the binding
   is just a method on `env` the Workers runtime provides). With
   `stream: true` this resolves to a `ReadableStream` of
   Server-Sent-Events bytes (`data: {"response":"..."}\n\n`, ending
   `data: [DONE]\n\n`).
4. `streamGeneration` decodes that SSE stream and re-emits the raw text
   as it arrives, piped straight through as the HTTP response body —
   this is what makes the chat feel live. In parallel, it accumulates
   the full text.
5. Once the model finishes, a `TransformStream`'s `flush` callback (so
   this runs *before* the response stream closes, not after) pulls the
   HTML out of the fence (`extractHtml`) and the one-line summary out of
   the `SUMMARY:` line (`extractSummary`), then `PUT`s both — plus the
   appended user/assistant `ChatMessage`s — back to the `UserDO`. If
   extraction or the save fails, the response stream errors instead of
   closing normally, so the client sees a real failure rather than a
   silent no-op; the project's previous HTML is left untouched either
   way.
6. The browser only shows the `SUMMARY:` line as the assistant's chat
   message (never the raw HTML) — an animated loading state fills in
   while the request is in flight. Once it resolves, the frontend calls
   `GET /api/projects/:id` again and re-renders the (now sandboxed)
   preview iframe with the fresh HTML — the live preview intentionally
   does **not** update token-by-token.

### Publish lifecycle (Cloudflare Pages)

1. The browser sends `POST /api/projects/:id/publish`.
2. The Worker runs the stored HTML through a basic abuse filter
   (`checkHtmlForAbuse` — flags, e.g., a form posting to an external
   domain alongside phishing-style language) **before any Cloudflare
   API call**; a flagged page is rejected with no Pages project touched.
3. **First publish only:** the Worker calls the Cloudflare REST API
   directly with `fetch` (not an npm SDK — see below) to create a Pages
   project: `POST /accounts/:accountId/pages/projects`, `Authorization:
   Bearer <CF_API_TOKEN>`. If the name collides with an existing
   project, it retries with a numeric suffix (`buildPagesProjectName` in
   `worker/src/slug.ts`, capped under Cloudflare's ~58-character project
   name limit). The project's stable `*.pages.dev` subdomain (returned
   on creation) is saved to the `UserDO` immediately — before the deploy
   step below — so a failed first deploy can't orphan a Pages project
   with nothing in the app pointing at it.
4. **Every publish:** the Worker runs Cloudflare's direct-upload deploy
   flow for a single `index.html` (`deployPagesProject` in
   `worker/src/cf-pages.ts`):
   1. `GET /pages/projects/:name/upload-token` → a short-lived upload JWT.
   2. `POST /pages/assets/check-missing { hashes }` — which content
      hashes does Cloudflare not already have?
   3. `POST /pages/assets/upload` — the file content, base64-encoded,
      only if step 2 said it was missing.
   4. `POST /pages/assets/upsert-hashes` — mark the hash as in use.
   5. `POST /pages/projects/:name/deployments` — a multipart request
      whose `manifest` field maps `/index.html` to that content hash,
      creating the actual deployment.
5. The Worker stores the project's **stable** subdomain URL (from step
   3), not the per-deployment URL step 4 returns (which changes on every
   publish) — matching the design's "the project keeps its own
   `*.pages.dev` URL" intent.

### Delete lifecycle

`DELETE /api/projects/:id` calls Cloudflare's delete-project endpoint
only if the project has a Pages project on record (not just "has been
published" — a project that got as far as step 3 above but failed at
step 4 still needs cleanup); a 404 from Cloudflare counts as success
(the project is already gone, which is the desired end state). If the
delete call fails for any other reason, the Worker returns a retryable
502 and leaves the project in place rather than silently losing track of
a live Pages project.

### How the Cloudflare "SDK" is used

There's no `cloudflare` npm package anywhere in this project — two
different mechanisms are both informally "the SDK":

- **Native bindings**, configured in `wrangler.toml` and used as plain
  methods/objects on the Worker's `env`: `env.AI.run(...)` for Workers
  AI, `env.USER_DO.idFromName(...)`/`.get(...)` for Durable Objects, and
  the `[assets]` directory binding that serves `web/`'s static files
  from the same Worker. These only exist inside the Workers runtime —
  there's nothing to `npm install` for them.
- **Plain `fetch` calls to the Cloudflare REST API** for everything
  Pages-related (`worker/src/cf-pages.ts`), authenticated with a Bearer
  token (`CF_API_TOKEN`) read from a Worker secret, never sent to the
  browser. This is the same HTTP API `wrangler pages deploy` itself
  calls under the hood — this project just calls it directly instead of
  shelling out to wrangler.

## Setup

```sh
cd worker
npm install

# secrets (not committed):
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CF_API_TOKEN     # token with Pages edit permission
npx wrangler secret put CF_ACCOUNT_ID

npx wrangler dev          # local dev: UI + API on one origin
npx wrangler deploy       # deploys the Worker, UI assets included
```

The frontend is served by the Worker itself; `wrangler deploy` from
`worker/` deploys both. There is no separate Pages deploy for the app's
own UI. `web/.assetsignore` keeps `node_modules`, package files and tests
out of the uploaded assets.

Note: Workers AI isn't available under plain `wrangler dev` — chat needs
`wrangler dev --remote` (and a logged-in wrangler), since it runs against
your real Cloudflare account and incurs usage either way. Durable Object
storage is separate between the two modes, so a project created under
plain `wrangler dev` won't exist once you switch to `--remote`.

## Tests

```sh
cd worker && npm install && npx vitest run   # Worker + Durable Object tests
cd web && npm install && npx vitest run      # frontend api/preview tests
```

## Status

Implemented: register/login/logout (signed stateless session cookie),
project list/create/get/delete, streaming chat-driven HTML generation
with Workers AI, sandboxed live preview, publish to a per-project
Cloudflare Pages project with a basic abuse filter, and the
auth/projects/editor UI.

Verified only against mocked Cloudflare APIs: the Pages direct-upload
deploy flow and the Workers AI streaming response format follow
Cloudflare's documented behavior but have not yet been exercised against
a live account. See the design doc for deliberate non-goals.

## Limitations

Current gaps, not permanent design decisions — reasonable things to add
in a later iteration:

- **No collaboration.** Each project has exactly one owner; there's no
  sharing a project between multiple accounts, and no concept of
  simultaneous editors.
- **No manual code editing.** The only way to change a page is through
  chat with the AI — there's no direct HTML/CSS editor for hand-tweaking
  the generated output.
- **Single page only.** Each project is one HTML page; there's no
  multi-page sites (e.g. separate Home/About/Contact pages linked
  together).
- **Best suited to small pages.** The chat-driven, full-document
  regeneration approach works well for small pages — a landing page, a
  simple business/intro info page — but gets slower and less reliable
  as a page grows larger or more complex.
