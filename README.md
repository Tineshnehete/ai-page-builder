# AI Page Builder

Chat with an AI to build a single-page website, preview it live, and
publish it to Cloudflare Pages — multi-user, minimal by design.

Full design (architecture, data model, auth, publish flow, streaming):
[`docs/superpowers/specs/2026-10-22-ai-page-builder-design.md`](docs/superpowers/specs/2026-10-22-ai-page-builder-design.md)

## Project layout

```
worker/   Cloudflare Worker — API (auth, chat/generate, publish, delete)
          + the UserDO Durable Object (per-user data)
web/      Static frontend, deployed to Cloudflare Pages
docs/     Design docs
```

## Stack

- **Cloudflare Workers** — API backend
- **Durable Objects** — one `UserDO` per user, storing that user's
  projects (HTML, chat history, publish state)
- **Workers AI** — chat-driven HTML generation, streamed to the client
- **Cloudflare Pages** — hosts the static frontend, and each user
  project gets its own Pages project on publish

## Setup (not yet run)

```sh
cd worker
npm install
npx wrangler dev          # local dev
npx wrangler deploy       # deploy the Worker

# secrets (not committed):
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
```

```sh
cd web
npx wrangler pages deploy . --project-name=ai-page-builder-web
```

## Status

Scaffold only — routes, auth, chat/generate, publish, and the actual
editor UI are not yet implemented. See the design doc's "What's Left
to the Builder" section.
