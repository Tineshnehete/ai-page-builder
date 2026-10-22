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

Note: Workers AI always runs against your Cloudflare account, even under
`wrangler dev`, so chat needs a logged-in wrangler and incurs usage.

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
