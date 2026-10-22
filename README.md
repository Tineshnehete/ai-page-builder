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
