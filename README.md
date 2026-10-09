# Dreemer

Dreemer helps wedding venues turn tours into bookings. A venue signs up, loads
photos of its real spaces, and gets a QR code and link. A couple who tours the
venue scans the code, uploads a few photos of themselves, and a few minutes
later receives a private gallery: four AI-rendered stills of the two of them
married at that venue, plus a short branded motion reel. The venue pays for
this; couples never do.

The business is venue-paid and credit-based. One gallery costs one credit. New
organizations start with a small trial; after that they subscribe (Starter or
Growth) or buy credit packs.

## How the product works

1. **Venue signup** at `/create-venue`. Members sign in with Clerk; one Clerk
   Organization is the billing tenant and can own several venues. A new
   organization gets 5 free galleries and 14 days, no card.
2. **Venue setup** in the owner dashboard (`/dashboard/:slug`): upload photos of
   the ceremony space, reception space and grounds, pick gallery styles, get
   the QR code and link.
3. **Couple flow** at `/preview/:slug`: the couple uploads two or three
   reference photos of themselves, both agree to the AI preview, and they
   wait while the pipeline renders. On a tour, the coordinator can start the
   gallery from their phone in tour-day mode (`/dashboard/tour/:slug`).
4. **Rendering**: the API server builds four scenes from the venue's own photos
   and the couple's references (OpenAI gpt-image-2.5 first, Gemini as the
   fallback), runs a multimodal quality gate (likeness, venue fidelity,
   composition, hard integrity checks), and assembles the motion reel with
   ffmpeg. One credit is debited per session; failed sessions are refunded.
5. **Delivery**: the gallery is emailed to the couple automatically (or after
   the venue reviews it, if the venue turned that on) and lives at a private
   share link (`/v/:shareToken`) whose main action is "Check your date at
   {venue}". The dashboard shows which couples viewed, shared, clicked for a
   date and booked; the venue marks bookings with one click.

## Repository layout

This is a pnpm monorepo.

| Path | What it is |
| --- | --- |
| `artifacts/api-server` | Express 5 API. Serves the SPA as static files. Routes in `src/routes/`; gallery pipeline in `src/lib/`; the control plane in `src/control-plane/`. Bundled with esbuild into `dist/index.mjs`. |
| `artifacts/wedding-app` | React 19 + Vite SPA: venue site, signup, owner dashboard, couple flow, share pages, `/control`. |
| `lib/api-spec` | OpenAPI 3.1 spec (`openapi.yaml`) and Orval config. Source of truth for the API contract. |
| `lib/api-client-react` | Generated React Query hooks. Never edit `src/generated/` by hand. |
| `lib/api-zod` | Generated Zod schemas. Never edit `src/generated/` by hand. |
| `lib/db` | Drizzle ORM schema and the Postgres pool (`src/pgPool.ts`). |
| `lib/brand` | Brand tokens, logo assets and the generators that keep them in sync. |
| `lib/object-storage-web` | Uppy-based upload components. |
| `scripts` | Setup, security smoke and production verification scripts. |
| `supabase` | `bootstrap.sql` and migrations for a fresh database. |
| `docs` | Production readiness checklist, gallery QA, outreach studio notes. |

`CLAUDE.md` is the detailed guide for anyone (or any agent) changing code here;
`AGENTS.md` points to it. `DESIGN.md` and `design-notes.md` cover visual work.

## Commands

```bash
pnpm install

# Typecheck + build every package
pnpm run build

# Typecheck only (all packages) / shared libraries only
pnpm run typecheck
pnpm run typecheck:libs

# API server (Express, port 5000) and web app (Vite dev server)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/wedding-app run dev

# Regenerate API client hooks + Zod schemas after editing lib/api-spec/openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes with drizzle-kit
pnpm --filter @workspace/db run push

# Every unit test (api-server, web helpers, brand tokens); suites run alone as
# test:billing, test:sessions, test:web, test:growth, test:vetting, ... (see package.json)
pnpm run test

# Security smoke: behaviour checks plus source contracts (CI runs it)
pnpm run smoke:security

# Isolated UI fixture on 127.0.0.1:8082 (no API or Clerk needed)
pnpm --filter @workspace/wedding-app run dev:ui-fixture

# Verify production env, build artifacts, ffmpeg, and optionally the live /api/readyz
pnpm run verify:production -- --url https://your-dreemer-host.example
```

Windows users have `start.bat` and the PowerShell helpers in `scripts/`
(`Setup-Supabase.ps1`, `Deploy-Railway.ps1`).

## Environment

Copy `.env.example` to `.env` at the repo root and fill it in. The file
documents every variable; the groups that matter first:

- **Database**: `DATABASE_URL` (Supabase session pooler URI). Pin the server
  CA with `DATABASE_SSL_CA` (PEM contents) or `DATABASE_SSL_CA_PATH` (file);
  without one the connection is encrypted but not verified and the server logs
  a warning telling you how to fix it. Create the schema with
  `pnpm run setup:db`.
- **Storage**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, bucket names.
  Create the buckets with `pnpm run setup:storage`.
- **Auth**: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
  `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`. Required in
  production (the server refuses to boot without them); in development the
  app starts without them, owner routes return 503 and the web app shows a
  setup notice.
- **Billing**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`,
  and the `PRICING_*` display values.
- **Rendering**: `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, and the
  `IMAGE_MODEL` / `GALLERY_*` settings.
- **Email**: `RESEND_API_KEY`, `EMAIL_FROM`.
- **Control plane**: `XAI_API_KEY` (agents idle without it) and
  `CONTROL_PLANE_OPERATOR_EMAILS` (required in production; `/control` fails
  closed without it).
- **Outreach**: `OUTREACH_SENDER_NAME`, `OUTREACH_REPLY_TO`,
  `OUTREACH_POSTAL_ADDRESS`, `OUTREACH_UNSUBSCRIBE_MAILBOX`,
  `OUTREACH_CTA_URL`, `RESEND_WEBHOOK_SECRET`.

`pnpm run generate:secrets` prints random values for the signing secrets.

## Deploy

Production runs the `Dockerfile` (Railway picks it up through `railway.toml`).
The image is built in two stages: the builder installs all workspace
dependencies and runs `pnpm run build`; the runtime image carries Node 24,
ffmpeg, the api-server bundle, its production `node_modules`, and the built
SPA. It listens on `PORT` (5000) and runs as the unprivileged `node` user.

Readiness is `GET /api/readyz`, which reports env, auth, database schema,
row-level security, storage, AI keys, billing, email, quality gate, image
model and ffmpeg as `ok` or `degraded` (reasons only for operators or a
`READINESS_DETAIL_TOKEN` holder).
Railway's health check uses the same path. Before a launch, run
`pnpm run verify:production` against the real environment and work through
the after-deploy checklist in `docs/production-readiness.md`.

Without Docker: `pnpm run build` then `node artifacts/api-server/dist/index.mjs`
(or `pnpm start`). First-time database: `pnpm run setup:db`.

## The control plane

`artifacts/api-server/src/control-plane/` is an in-process scheduler running a
set of Grok-backed domain agents (prospecting, outreach, campaigns, support,
product repair, finance, growth, activation, governance). They read live
business data through a restricted tool belt and can only act through a
governed action catalog. Anything that contacts a real person, launches a
campaign or grants credits is a high-risk action that waits for an operator to
approve it in `/control`; the action layer also enforces daily send caps,
per-prospect contact gaps and lifetime caps, opt-out footers, and
reply/unsubscribe locks. State lives in the `control_*` and `agent_*` tables in
`lib/db`. Without `XAI_API_KEY` the control plane boots and idles.

The outreach email studio (`control-plane/outreach/`) is where prospect emails
are researched, written, reviewed and sent. Prospects are vetted first
(`control-plane/vetting/`: site reachable, domain age, archive history,
MX/SPF/DMARC, address on the site); nothing is drafted or sent to a prospect
whose vetting has not passed.
`venueResearch.ts` pulls facts and the venue's own photos from its public site;
`copywriter.ts` has Grok write a short personal note checked against
plain-words rules; `emailTemplate.ts` renders light/dark HTML and plain text.
`sender.ts` is the only delivery path and re-checks the approved action,
consent, suppression list and caps at send time. Every email carries a working
unsubscribe link and RFC 8058 one-click headers; Resend webhooks record
delivery, bounces and complaints.

## Operating the business

Operators sign in to `/control` with a Clerk account whose email is in
`CONTROL_PLANE_OPERATOR_EMAILS`. From there you approve or reject pending
agent actions, review and edit outreach emails before they send, record
prospect replies, conversions and unsubscribes in the Pipeline tab, and watch
the growth KPIs (signups, activation, trial-to-paid, deliverability).

The growth loop produces a weekly operator digest (schedule set by
`GROWTH_DIGEST_WEEKDAY` and `GROWTH_DIGEST_HOUR_UTC`) that summarizes the
week's funnel, experiments and anything that needs a decision. Read it, act on
the approvals queue, and keep `PUBLIC_FOUNDING_SLOTS_LEFT` and the `PRICING_*`
values in `.env` honest as the business changes.
