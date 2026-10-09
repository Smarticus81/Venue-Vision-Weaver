# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For landing-page, marketing-surface, or other visual design work, follow the design doctrine in `DESIGN.md` and keep `design-notes.md` up to date.

## Commands

```bash
# Full typecheck + build all packages
pnpm run build

# Typecheck only (all packages) / shared libraries only
pnpm run typecheck
pnpm run typecheck:libs

# API server (Express, port 5000) and wedding web app (Vite, port 8081, proxies /api to 5000)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/wedding-app run dev

# Isolated UI fixture (no API, no Clerk; every /api call is a local fixture) on 127.0.0.1:8082
pnpm --filter @workspace/wedding-app run dev:ui-fixture

# Regenerate API client hooks + Zod schemas from the OpenAPI spec (CI fails on drift)
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes (drizzle-kit); supabase/bootstrap.sql is the SQL-editor equivalent
pnpm --filter @workspace/db run push

# Every unit test (node:test via tsx): api-server, web helpers, brand tokens
pnpm run test
# Individual suites
pnpm run test:billing          # Stripe webhook core, credits, org provisioning
pnpm run test:sessions         # session-create guards, recovery, venue setup routes
pnpm run test:funnel           # public config, gallery + funnel events, trial clock
pnpm run test:pipeline         # gallery generation, quality judge, OpenAI client
pnpm run test:readiness        # readiness contract, env validation, operator auth, grok
pnpm run test:control-plane    # control-plane actions, tools, scheduler
pnpm run test:control-console  # /control route helpers
pnpm run test:outreach-studio  # outreach studio, sender, webhooks
pnpm run test:vetting          # prospect vetting
pnpm run test:growth           # growth loop (KPIs, attribution, experiments, adaptation, digest)
pnpm run test:governance       # governance + metrics
pnpm run test:web              # every artifacts/wedding-app/src/**/*.test.ts
pnpm run test:brand            # lib/brand contrast and token tests

# Source-contract + behaviour security smoke (run in CI and by verify:production)
pnpm run smoke:security

# Verify production env, build artifacts, ffmpeg, gallery QA evidence and optional live readiness
pnpm run verify:production -- --url https://your-dreemer-host.example
```

CI (`.github/workflows/ci.yml`, Node 24) runs: BOM check, typecheck, `pnpm run test`, `pnpm run smoke:security`, codegen drift, build, brand tokens drift. Local Node is 22+.

## Architecture

This is a **pnpm monorepo** for Dreemer, a venue-paid wedding gallery platform. Venues buy credits; a couple who tours a venue scans its QR card or link, uploads two or three photos, and gets a private gallery: four AI stills of the two of them at that venue plus one branded motion reel. The gallery's apex action sends them back to the venue to check their date.

### Artifacts (deployable apps)

- **`artifacts/api-server`** - Express 5 backend, bundled with esbuild into `dist/index.mjs`; serves the SPA and injects `<meta name="dreemer-public-config">` (prices, trial, founding offer, proof mode) into every shell response. Routes in `src/routes/`: `venues.ts`, `sessions.ts`, `storage.ts`, `billing.ts` (org + Stripe/Clerk webhooks), `events.ts`, `publicConfig.ts`, `galleryStyles.ts`, `health.ts`, `outreach.ts` (unsubscribe + claim), and the operator routes `controlPlane.ts`, `controlProspects.ts`, `controlGrowth.ts`. Gallery pipeline in `src/lib/` (OpenAI gpt-image-2.5 first, Gemini fallback, Gemini quality judge, ffmpeg reel); control plane in `src/control-plane/`.
- **`artifacts/wedding-app`** - React 19 SPA (Vite). `/` landing, `/pricing`, `/privacy`, `/claim/:token` (outreach claim into signup), `/create-venue`, `/dashboard/:slug` owner dashboard (`pages/dashboard/**`), `/dashboard/tour/:slug` tour-day mode, `/preview/:slug` couple flow, `/v/:shareToken` shared gallery, `/find-my-gallery`, `/control` operator console (`pages/control/**`). Couple-only styles in `src/styles/couple.css`, dashboard styles in `src/styles/dashboard.css`.

### Shared libraries (`lib/`)

- **`lib/api-spec`** - OpenAPI 3.1 spec (`openapi.yaml`) + Orval config. Source of truth for the API contract.
- **`lib/api-client-react`** - Auto-generated React Query hooks. Do not edit `src/generated/` manually.
- **`lib/api-zod`** - Auto-generated Zod schemas; `src/index.ts` holds the curated re-exports. Do not edit `src/generated/` manually.
- **`lib/db`** - Drizzle schema (`organizations`, `venues`, `venue_media`, `upload_intents`, `couple_sessions`, `couple_media`, `generated_assets`, `gallery_events`, `render_attempts`, `credit_transactions`, `stripe_events`, `billing_events`, `funnel_events`, and the `control_*` / `agent_*` tables). Every table has RLS enabled. `src/pgPool.ts` handles TLS and CA pinning.
- **`lib/brand`** (`@workspace/brand`) - brand tokens, logo geometry, email constants; `BRAND.md` documents it.
- **`lib/object-storage-web`** - Uppy-based file upload components.

### Key patterns

- **OpenAPI-first**: edit `lib/api-spec/openapi.yaml`, run codegen, update `lib/api-zod/src/index.ts` re-exports if you add schemas the server parses.
- **Owner auth**: Clerk end to end. Members sign in to their own Clerk profile; org-scoped routes use `requireOrg` / `requireOrgVenue` / `requireOrgVenueContext` and `requireOrgAdmin` for admin-only actions (checkout, portal, website import, deletes) in `src/lib/orgAuth.ts`, plus `requireOwnerMutationOrigin` on mutations. Do not add PIN-, password-, magic-link- or cookie-session flows. Clerk is required in production (boot refuses without it); outside production the app starts and owner routes answer 503.
- **Multi-tenancy**: one Clerk Organization per account is the billing tenant (`organizations`). It owns the plan, the shared credit balance and many venues.
- **Trial and credits** (`src/lib/trial.ts`, `src/lib/credits.ts`): a new organization gets 5 credits once per Clerk user (`trial_granted_by_clerk_user_id`) and a 14-day clock (`trial_ends_at`, `TRIAL_DAYS`), no card. After expiry, spending answers `402 trial_expired` (credits are kept; any purchase lifts the block); an empty balance answers `402 insufficient_credits`. A couple gallery costs 1 credit; failed sessions are refunded through the guarded refund path; sample galleries (`kind=sample`) cost nothing and are never emailed.
- **Billing**: Stripe at the organization level. `POST /org/billing/checkout` (starter/growth subscriptions, credit packs; `409 subscription_exists` with a portal URL when the org already subscribes) and `POST /org/billing/portal`. The webhook (`/api/billing/webhook`) verifies the signature, records the event id in `stripe_events` before acting (replays answer 200 and do nothing; a failed handler releases the id and answers 500 so Stripe retries), and only ever adds credits: renewals grant the plan quota clipped by `PLAN_CREDIT_ROLLOVER_CAP` (default 3x), packs are never clipped, no webhook SETs a balance. Paid means `first_paid_at` is set (first subscription or pack). A pack on a trial/none org sets plan `payg`; a subscription deletion sets `churned_at` and plan `none` (or `payg` if pack credits remain). `billing_events` records the money-side history. The Clerk webhook (`/api/webhooks/clerk`) only syncs organization names.
- **Session creation** (`routes/sessions.ts`): `runSessionCreateGuards` runs every check before a photo is downloaded or a credit is touched, in cost order: per-IP rate limit, venue readiness (5+ photos covering every coverage role, `isVenueReady`), daily/hourly venue caps, trial clock and balance, optional Turnstile (only when `TURNSTILE_SECRET_KEY` is set), upload-intent and photo validation. Then one transaction debits, consumes the couple upload intents, inserts the session and writes the ledger row. Couple sessions require consent from both partners.
- **Upload intents**: every upload URL is bound to a venue and purpose (`upload_intents`); couple uploads need a short-lived HMAC upload token (`lib/uploadToken.ts`) bound to the venue slug; intents are capped per venue and swept when expired.
- **Delivery**: a ready gallery is emailed to the couple automatically unless `venues.review_before_send` (Settings -> Sending galleries); a gallery with a frame the judge could not score waits for the owner either way. The owner always gets the dashboard entry.
- **Gallery and funnel events**: `gallery_events` (`lib/galleryEvents.ts`: sent, viewed, shared, cta_click, download, booked, unbooked; views de-duplicated by hashed IP) feed the dashboard's viewed / clicked / booked columns; owners mark a couple booked with `POST /venues/{slug}/sessions/{id}/booked`. `funnel_events` (`lib/funnelEvents.ts`, never throws; `POST /api/events` from the web with first-touch attribution) record the owner funnel: landing_view through checkout and credits_exhausted. The growth attribution sweep links new organizations to outreach prospects by exact contact email, then website host, then a non-free-mail email domain (`control-plane/growth/attribution.ts`); the per-email claim link (`/claim/:token`) pre-fills signup and rides along as the first touch.
- **Couple privacy**: source photos are deleted `COUPLE_PHOTO_RETENTION_DAYS` after delivery; every image is labelled "AI preview, imagined at {venue}"; gallery recovery (`POST /sessions/recover`) matches the email exactly, is rate limited per IP and per inbox, and never says whether the address exists.
- **Readiness**: `GET /api/readyz` reports env, auth, database (schema contract in `lib/databaseReadiness.ts`), rls, storage, ai, billing, email, qualityGate, imageModel, ffmpeg. The reasons are only returned to operators or to a caller sending `x-readiness-token: $READINESS_DETAIL_TOKEN`.

### Autonomous Business Control Plane

`artifacts/api-server/src/control-plane/` is a multi-agent operating system on an in-process scheduler. Nine Grok-backed agents (`agents.ts`): prospecting, outreach, campaigns, activation, support, product repair, finance, growth and governance. `grok.ts` speaks xAI's OpenAI-compatible Responses API (model `CONTROL_PLANE_MODEL`, default `grok-4.7`; per-request `GROK_TIMEOUT_MS`, per-run budget `CONTROL_PLANE_RUN_BUDGET_MS`). Agents read live data through a restricted tool belt (`tools.ts`, `growth/tools.ts`, `vetting/tools.ts`) and act only through the governed action catalog (`actions.ts`, `growth/actions.ts`): each agent has an action allowlist, low risk auto-executes when the `auto_execute_low_risk` policy is on, medium/high risk waits for an operator. Actions are claimed atomically (`executing`) so none runs twice. Every email to a real person, campaign launch and credit grant needs operator sign-off. Retired actions (`send_prospect_email`, `resume_agent`) are refused, and on boot the scheduler rejects any pending/approved rows of them with the note "superseded by outreach studio". Kill switches and limits are policies (`policies.ts`, editable in `/control`): `agents_enabled`, `outreach_sends_enabled`, `max_daily_ai_usd`, send caps, contact gaps, lifetime contact caps, vetting thresholds, `lifecycle_email_auto_send`, `max_lifecycle_emails_per_day`. State lives in the `control_*` / `agent_*` tables. Without `XAI_API_KEY` the control plane boots and idles safely.

- **Vetting before any draft or send** (`control-plane/vetting/`): every prospect is checked (site reachable and not parked, TLS, domain age via RDAP, Wayback history, MX/SPF/DMARC on the contact domain, mailbox class, address/phone on the site, marketplace and social presence; optional Google Places). Scored 0-100 with hard fails into `control_prospect_vetting`; sourced facts go to `control_prospect_facts`. `upsert_prospect`, drafting and sending all refuse a prospect whose vetting has not passed or has gone stale (`VETTING_TTL_DAYS`); operators can override with a note.
- **Outreach email studio** (`control-plane/outreach/`): `venueResearch.ts` pulls facts and the venue's own photos from its public site (SSRF-guarded, pinned-IP fetch); `copywriter.ts` has Grok write a short note that must cite two verified facts and pass the plain-words rules (2 subjects <= 50 chars, <= 120 words, real spaces named, no stats/hype), with a deterministic fallback; `emailTemplate.ts` renders light/dark HTML + text from `@workspace/brand`. Agents call `draft_outreach_email`, which creates a `control_outreach_emails` row (with a per-email claim token) and proposes the high-risk `send_outreach_email`. `sender.ts` is the only delivery path: it re-verifies the approved action, vetting, consent, suppression list, daily cap (under an advisory lock), postal address and reply-to at send time. Approving a send requires review in the studio (`reviewed: true`, else 409). Public unsubscribe: `GET/POST /api/outreach/unsubscribe/:token` (confirm page + RFC 8058 one-click) writes `control_email_suppressions`; `POST /api/webhooks/resend` records delivery, opens, clicks, bounces and complaints.
- **Growth loop** (`control-plane/growth/`): outcome KPIs (signups, activation, trial-to-paid, outbound by segment, deliverability, MRR) computed in `kpi.ts` and snapshotted in `control_metrics_snapshots` with 7-day deltas; the signup attribution sweep; the trial clock with fixed-template lifecycle emails (gallery 3, day 10, credits out, trial ended; governed, approval-gated until `lifecycle_email_auto_send`); typed experiments with a deterministic evaluator (`control_experiments`); bounded adaptation rules that reweight copy variants and throttle sends when deliverability slips, each written to `control_adaptations`; the copy-variant registry (`control_copy_variants`); segments; the weekly operator digest (`control_digests`, `GROWTH_DIGEST_WEEKDAY` / `GROWTH_DIGEST_HOUR_UTC`) and a daily aging-approvals nudge; nightly retention of transcripts and audit rows. `GROWTH_LOOP_ENABLED=off` stops everything but the KPI snapshots.
- **Operator console** at `/control` (auth: Clerk session whose email is in `CONTROL_PLANE_OPERATOR_EMAILS`; fails closed when unset, `CONTROL_PLANE_DEV_OPEN=true` opens it only outside production). Tabs: Overview (owner and prospect funnels, KPI sparklines, kill switches, editable policy cards, agent cards with run/pause/resume), Growth, Pipeline (paging, search, vetting badges, evidence panel; record replies, conversions and unsubscribes), Outreach (desktop/mobile, light/dark previews; edit, regenerate, approve, retry), Approvals, Tasks, Runs, Experiments, Audit. Every `/api/control/*` handler calls `requireOperator` (the smoke checks each one).

### Environment variables

`.env.example` documents every variable and `railway.env.template` carries the same keys with production values (the security smoke fails if the two drift). Highlights:

- `DATABASE_URL` (Supabase session pooler URI; `pnpm run setup:db`), `DATABASE_SSL_CA` / `DATABASE_SSL_CA_PATH` to verify the server certificate
- `APP_BASE_URL`, `UPLOAD_TOKEN_SECRET`, `TRUST_PROXY`, `READINESS_DETAIL_TOKEN`
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET` - required in production
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_GROWTH_MONTHLY`, `STRIPE_PRICE_CREDIT_PACK_10`, `PLAN_CREDIT_ROLLOVER_CAP`
- `PRICING_*` (display prices; Stripe charges what `STRIPE_PRICE_*` say), `TRIAL_DAYS`, `PUBLIC_FOUNDING_SLOTS_*`, `PUBLIC_PROOF_MIN_*`, `PUBLIC_CONTACT_EMAIL`, `COUPLE_PHOTO_RETENTION_DAYS`, `DEMO_COUPLE_DIR` (photos for "Render a sample"; without them the route answers `409 demo_not_configured`)
- `OPENAI_API_KEY` + `IMAGE_MODEL` / `IMAGE_FALLBACK_MODELS` (chain must start with `gpt-image-2.5-sunburst`), `GOOGLE_AI_API_KEY` (quality judge, venue reference selector, image fallback), `GALLERY_*` quality floors, `SESSION_DEADLINE_MS`, `GALLERY_MAX_CONCURRENT`, `GALLERY_RENDER_CONCURRENCY`, `RENDER_PRICE_*` (per-image COGS)
- `RESEND_API_KEY`, `EMAIL_FROM` (verified domain)
- `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` (optional bot check on the couple form)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket names (`pnpm run setup:storage`)
- `XAI_API_KEY` (agents idle without it), `CONTROL_PLANE_OPERATOR_EMAILS` (required in production), `CONTROL_PLANE_*` tuning
- Outreach: `OUTREACH_SENDER_NAME`, `OUTREACH_REPLY_TO`, `OUTREACH_POSTAL_ADDRESS` (sends are refused without it), `OUTREACH_UNSUBSCRIBE_MAILBOX`, `OUTREACH_CTA_URL`, `RESEND_WEBHOOK_SECRET` (required in production when `XAI_API_KEY` is set)
- Vetting and growth: `GOOGLE_PLACES_API_KEY`, `VETTING_*`, `GROWTH_*`

`NODE_ENV=production` turns on strict boot validation (`src/lib/envValidation.ts`): the server refuses to start with missing or placeholder production config.

Deploy: the `Dockerfile` (Railway via `railway.toml`), or `pnpm run build` then `node artifacts/api-server/dist/index.mjs`. First-time DB: `pnpm run setup:db`. Before launch, run `pnpm run verify:production` with real production env and check the deployed `/api/readyz`; the after-deploy steps (schema migration, RLS, dropping the retired owner-auth tables, legacy approvals, outreach and DNS setup) are in `docs/production-readiness.md`.
