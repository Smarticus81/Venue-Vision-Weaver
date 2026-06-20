# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
# Full typecheck + build all packages
pnpm run build

# Typecheck only (all packages)
pnpm run typecheck

# Typecheck shared libraries only
pnpm run typecheck:libs

# API server (Express, port 5000)
pnpm --filter @workspace/api-server run dev

# Wedding web app (Vite/React)
pnpm --filter @workspace/wedding-app run dev

# Regenerate API client hooks + Zod schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes
pnpm --filter @workspace/db run push

# Verify production env, build artifacts, ffmpeg, and optional live readiness
pnpm run verify:production -- --url https://your-glimpse-host.example
```

## Architecture

This is a **pnpm monorepo** for glimpse, a venue-paid wedding gallery platform. Venues buy credits; couples use venue-specific QR/links to generate a four-image AI vision gallery plus one branded motion reel at that specific venue.

### Artifacts (deployable apps)

- **`artifacts/api-server`** - Express 5 backend. Serves the wedding-app SPA as static files. Routes in `src/routes/` (venues, sessions, storage, billing, gallery styles). Credit-gated Gemini image generation with Stripe billing.
- **`artifacts/wedding-app`** - React 19 SPA (Vite). Venue main site at `/`, signup at `/create-venue`, owner dashboard at `/dashboard/:slug`, couple flow at `/preview/:slug`, share links at `/v/:shareToken`.

### Shared libraries (`lib/`)

- **`lib/api-spec`** - OpenAPI 3.1 spec (`openapi.yaml`) + Orval config. Source of truth for the API contract.
- **`lib/api-client-react`** - Auto-generated React Query hooks. Do not edit `src/generated/` manually.
- **`lib/api-zod`** - Auto-generated Zod validation schemas. Do not edit `src/generated/` manually.
- **`lib/db`** - Drizzle ORM schema (`venues`, `venue_media`, `couple_sessions`, `couple_media`, `generated_assets`, `credit_transactions`, owner auth tables).
- **`lib/object-storage-web`** - Uppy-based file upload components.

### Key patterns

- **OpenAPI-first**: Edit `lib/api-spec/openapi.yaml`, then run codegen.
- **Credits**: Gallery session = 1 credit. Trial venues get 5 credits on create.
- **Owner auth**: Venue owners sign in with email magic links and an httpOnly cookie session. Do not add PIN-based flows.
- **Billing**: Stripe Checkout + webhooks in `artifacts/api-server/src/routes/billing.ts`.

### Required environment variables

- `DATABASE_URL` - Supabase PostgreSQL URI (`pnpm run setup:db`)
- `APP_BASE_URL` - Public URL for emails and Stripe redirects
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` - Billing
- `GOOGLE_AI_API_KEY` - Gemini gallery generation and quality review
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - file uploads (`pnpm run setup:storage`)

Deploy: `pnpm run build` then `node artifacts/api-server/dist/index.mjs`. First-time DB: `pnpm run setup:db`.
Before launch, run `pnpm run verify:production` with real production env and verify the deployed `/api/readyz` endpoint. See `docs/production-readiness.md`.

See `.env.example` for the full list.
