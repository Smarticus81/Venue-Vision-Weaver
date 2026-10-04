# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For landing-page, marketing-surface, or other visual design work, follow the design doctrine in `DESIGN.md` and keep `design-notes.md` up to date.

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

# Unit tests (node:test via tsx); individual suites: test:control-plane, test:outreach-studio, ...
pnpm run test

# Verify production env, build artifacts, ffmpeg, and optional live readiness
pnpm run verify:production -- --url https://your-glimpse-host.example
```

## Architecture

This is a **pnpm monorepo** for glimpse, a venue-paid wedding gallery platform. Venues buy credits; couples use venue-specific QR/links to generate a four-image AI vision gallery plus one branded motion reel at that specific venue.

### Artifacts (deployable apps)

- **`artifacts/api-server`** - Express 5 backend. Serves the wedding-app SPA as static files. Routes in `src/routes/` (venues, sessions, storage, billing/org, gallery styles). Credit-gated image generation (OpenAI gpt-image-2.5, Gemini fallback) with organization-level Stripe billing.
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
- **Owner auth**: Clerk end-to-end — members sign in to their own Clerk profile; org-scoped API routes use `requireOrg`/`requireOrgVenue` (`src/lib/orgAuth.ts`). Do not add PIN- or password-based flows.
- **Multi-tenancy**: One Clerk Organization per account is the billing tenant (`organizations` table). It owns the plan, the shared credit balance, and many venues. Members sign in with individual Clerk profiles.
- **Billing**: Stripe at the organization level — `POST /org/billing/checkout` (starter/growth subscriptions + credit packs) and `POST /org/billing/portal`, with the Stripe webhook (`/api/billing/webhook`) granting credits to the org. The Clerk webhook (`/api/webhooks/clerk`) only syncs organization names.
- **Autonomous Business Control Plane**: a multi-agent operating system in `artifacts/api-server/src/control-plane/` — nine Grok-backed domain agents run on an in-process scheduler (`grok.ts` speaks xAI's OpenAI-compatible Responses API; model via `CONTROL_PLANE_MODEL`, default `grok-4.7`). The revenue trio leads: prospecting (web-search-backed discovery, qualification, 0-100 fit scoring into `control_prospects`), outreach (personalized first-touch and follow-up drafts), and campaigns (multi-step sequences in `control_campaigns` with funnel readouts). Support, product repair, finance, experiments, activation, and governance agents keep the business healthy. Agents read live business data through a restricted tool belt and act only through a governed action catalog (low risk auto-executes; medium/high risk waits for operator approval) — every email to a real person (`send_prospect_email`, `send_venue_email`), campaign launch, and credit grant needs operator sign-off, with daily send caps, per-prospect contact gaps and lifetime caps, opt-out footers, and reply/unsubscribe locks enforced in the action layer. State lives in `lib/db` control-plane tables (`control_agents`, `agent_runs`, `agent_tasks`, `agent_actions`, `control_prospects`, `control_campaigns`, `control_experiments`, `control_metrics_snapshots`, `control_audit_events`, `control_policies`). Operators supervise it at `/control` (auth: Clerk session with email in `CONTROL_PLANE_OPERATOR_EMAILS`) via the `/api/control/*` routes, including the Pipeline tab for recording prospect replies, conversions, and unsubscribes. Without `XAI_API_KEY` the control plane boots and idles safely.
- **Outreach email studio** (`artifacts/api-server/src/control-plane/outreach/`): prospect emails are built, reviewed, and sent here. `venueResearch.ts` pulls facts and the venue's own photos from its public site (SSRF-guarded fetch, sharp sizing, copies in the public storage bucket with source URLs recorded, graceful `no_images` fallback). `copywriter.ts` has Grok write a short personal note validated against plain-words rules (2 subjects ≤ 50 chars, ≤ 120 words, real spaces named, no stats/hype) with a deterministic fallback. `emailTemplate.ts` renders the responsive light/dark HTML + plain text; brand tokens come from `lib/brand` (`@workspace/brand`). Agents call the `draft_outreach_email` tool, which creates a `control_outreach_emails` row and proposes the high-risk `send_outreach_email` action; `sender.ts` is the only delivery path and re-verifies the approved action, consent, suppression list, and caps at send time. Public unsubscribe: `GET/POST /api/outreach/unsubscribe/:token` (confirm page + RFC 8058 one-click) writes `control_email_suppressions`; `POST /api/webhooks/resend` records delivery/bounce/complaint events. Operators review desktop/mobile, light/dark previews and edit/regenerate/approve in `/control` → Outreach. New env: `OUTREACH_SENDER_NAME`, `OUTREACH_REPLY_TO`, `OUTREACH_POSTAL_ADDRESS`, `OUTREACH_UNSUBSCRIBE_MAILBOX`, `OUTREACH_CTA_URL`, `RESEND_WEBHOOK_SECRET`, `OUTREACH_SAMPLE_PREVIEWS`.

### Required environment variables

- `DATABASE_URL` - Supabase PostgreSQL URI (`pnpm run setup:db`)
- `APP_BASE_URL` - Public URL for emails and share links
- `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` - Clerk auth + org sync (optional at boot: without them the app deploys, owner/org routes return 503, and the web app shows a setup notice)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` - Organization billing
- `OPENAI_API_KEY` - gpt-image-2.5 gallery image generation (primary renderer)
- `GOOGLE_AI_API_KEY` - Gemini quality review, venue reference selection, and the image fallback
- `XAI_API_KEY` - Grok reasoning + web research for the control-plane agents (optional at boot: agents idle without it)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - file uploads (`pnpm run setup:storage`)

Deploy: `pnpm run build` then `node artifacts/api-server/dist/index.mjs`. First-time DB: `pnpm run setup:db`.
Before launch, run `pnpm run verify:production` with real production env and verify the deployed `/api/readyz` endpoint. See `docs/production-readiness.md`.

See `.env.example` for the full list.
