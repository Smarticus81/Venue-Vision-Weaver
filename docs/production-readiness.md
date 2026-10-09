# Dreemer Production Readiness

Use this checklist before calling a Dreemer deployment production-ready. The
order is: build gate, database preflight, runtime gate, deploy, then the
after-deploy checklist. Nothing here is optional for a launch that takes real
money or emails real people.

## Build Gate

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run smoke:security
pnpm run build
```

CI runs the same steps on Node 24 plus a codegen drift check and a UTF-8 BOM
check (`.github/workflows/ci.yml`).

## Runtime Gate

For an existing database, first run `supabase/production-v1-preflight.sql` in
the Supabase SQL editor. Every `row_count` should be `0` before applying the V1
schema contract because production now requires venue owner emails, couple
emails, share tokens, venue media coverage metadata, and unique generated
gallery asset slots.

Set real production environment variables (`railway.env.template` lists every
key; `.env.example` explains each one), then run:

```bash
pnpm run verify:production
```

The command checks:

- production environment policy with `NODE_ENV=production`: Clerk keys and
  webhook secret, `CONTROL_PLANE_OPERATOR_EMAILS`, live Stripe keys and price
  ids, Resend, storage, the image model chain, quality floors, and
  `RESEND_WEBHOOK_SECRET` whenever `XAI_API_KEY` switches the control plane on
- generated API and web app build artifacts
- source-contract smoke tests for gallery-only flow, owner auth, protected
  storage, billing-event idempotency, quality thresholds, generated asset
  visibility, operator gating and env template parity
- ffmpeg availability for the branded motion reel, either locally or through the
  Railway Dockerfile deployment image
- saved live gallery QA evidence from real consented references, including an
  automated passing `quality-report.json` with input SHA-256 fingerprints and
  manual acceptance marker
- migrated database tables, columns, non-null constraints, and critical unique
  indexes for uploads, organizations, generated gallery metadata, gallery and
  funnel events, the outreach studio, and billing webhook idempotency

After deployment, verify the live app:

```bash
pnpm run verify:production -- --url https://your-dreemer-host.example
```

The deployed `/api/readyz` endpoint must return `200` with every check set to
`ok`: env, auth, database, rls, storage, AI, billing, email, quality gate, image
model, and ffmpeg. The public response only says ok or degraded; to see the
reasons, sign in to `/control` as an operator or send the header
`x-readiness-token: <READINESS_DETAIL_TOKEN>` (16+ characters).

When running the verifier on a workstation without ffmpeg, the local ffmpeg
check can still pass if `railway.toml` deploys the Dockerfile and the Dockerfile
installs ffmpeg. The post-deploy `--url` readiness check remains mandatory
because it proves the actual running container can execute ffmpeg.

Motion reels are encoded as fast-start H.264 MP4 files and the protected storage
route must preserve `Range` requests as `206 Partial Content` responses for
mobile Safari and other mobile players. After changing storage delivery or the
gallery video player, run:

```bash
pnpm run test:mobile-reel
```

The `database` readiness check is intentionally stricter than a connection
test. It degrades if launch-critical schema items are missing or nullable:
organizations (unique `clerk_org_id`), venue and ledger `organization_id`
columns, generated-asset quality metadata, venue media coverage metadata,
venue slug and share-token uniqueness, upload intent uniqueness, gallery and
funnel event tables, render telemetry, the control-plane and outreach studio
tables (unique prospect email, suppression email and unsubscribe token), and
the partial unique `stripe_event_id` index that stops a replayed Stripe
webhook from granting credits twice. The `rls` check degrades while any public
table has row-level security off (see the after-deploy checklist).

Railway is configured to use `/api/readyz` as the deploy health check, so a
deployment with missing DB/storage/Gemini/Stripe/Clerk/email/ffmpeg readiness
should not be treated as healthy.

## After-Deploy Checklist

Do these in order on the first deploy of this build (2026-10 viability
overhaul) and tick each one off.

1. **Apply the additive schema migration.** Run `supabase/bootstrap.sql` in
   the Supabase SQL editor (idempotent: `CREATE TABLE / INDEX IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`) or `pnpm --filter @workspace/db run push`. It
   adds the trial clock, `first_paid_at` / `churned_at` / attribution columns,
   `review_before_send`, incentive text, gallery and funnel events, render
   telemetry, `stripe_events` / `billing_events`, the vetting, facts, copy
   variant, adaptation and digest tables, and the partial unique index
   `organizations_trial_grantee_unique` (trial once per Clerk user). Nothing
   is dropped. `/api/readyz`
   `database` must read `ok` afterwards.
2. **Decide RLS.** Production tables were created with row-level security off.
   The server connects as the table owner and is not affected by RLS; RLS only
   closes the Supabase PostgREST surface (the anon and authenticated keys).
   `bootstrap.sql` ends by enabling RLS on every table and revoking all table
   grants from `anon` and `authenticated`. Keep that (recommended: no browser
   ever talks to Postgres directly, and the anon key must never ship to a
   browser), or, if something outside this app reads these tables through
   PostgREST, write policies for it first. Until every table has RLS on,
   `/api/readyz` reports `rls: degraded` and answers 503.
3. **Drop the retired owner-auth tables, after the new build is live.** Run
   `supabase/migrations/2026-10-08-drop-owner-auth.sql` (drops
   `owner_sessions`, `owner_login_tokens`, `owner_credentials`). Not before:
   the previous build still reads them at startup. Destructive; export
   `owner_credentials` first if you want an archive.
4. **Clear legacy approvals.** The old `send_prospect_email` action bypassed
   the outreach studio and is retired. Reject any pending
   `send_prospect_email`, `resume_agent` or other retired rows in `/control` ->
   Approvals, or let the scheduler do it: on boot it marks every
   pending/approved row of a retired action type `rejected` with the note
   "superseded by outreach studio" (decided by `system:retirement`). Check the
   queue is clean after the first boot.
5. **Set the operator and contact values.** `CONTROL_PLANE_OPERATOR_EMAILS`
   (required; the console fails closed without it), `PUBLIC_CONTACT_EMAIL`
   (the "Email us" and founding-venue address), `PRICING_CURRENCY`,
   `PRICING_STARTER_MONTHLY`, `PRICING_GROWTH_MONTHLY`, `PRICING_CREDIT_PACK`,
   `PRICING_LABEL`, `TRIAL_DAYS`, and `PUBLIC_FOUNDING_SLOTS_LEFT` /
   `PUBLIC_FOUNDING_SLOTS_TOTAL`. Prices are display values: keep them equal
   to what the Stripe prices charge.
6. **Stripe.** Create the Starter and Growth monthly prices and the 10-credit
   pack in the live Dashboard and set `STRIPE_PRICE_STARTER_MONTHLY`,
   `STRIPE_PRICE_GROWTH_MONTHLY`, `STRIPE_PRICE_CREDIT_PACK_10` to those exact
   ids. An invoice for a price the server cannot map answers 500 and Stripe
   retries until the ids are fixed. Point a webhook endpoint at
   `https://<host>/api/billing/webhook`, put its signing secret in
   `STRIPE_WEBHOOK_SECRET`, and subscribe it to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `customer.subscription.deleted`

   Renewals add the plan quota, clipped so plan credits never exceed
   `PLAN_CREDIT_ROLLOVER_CAP` (default 3) months of quota; pack credits are
   never clipped. Enable the customer portal with plan switching (the
   dashboard sends subscribed organizations there to change plans).
7. **Clerk.** Use production keys issued for the domain the site is served
   from (a `pk_live_` key on another host makes sign-in fail; readiness
   `auth` says so). Point a webhook at `https://<host>/api/webhooks/clerk`
   with `organization.created` and `organization.updated`, and set
   `CLERK_WEBHOOK_SIGNING_SECRET`.
8. **Sending domain.** Send from a dedicated subdomain (for example
   `mail.yourdomain.com`) verified in Resend, with SPF, DKIM and a DMARC
   record (start at `p=none` with reporting, tighten once reports are clean).
   `EMAIL_FROM` must use that verified domain, never `onboarding@resend.dev`.
9. **Outreach preconditions.** Every outreach send is refused until these are
   real: `OUTREACH_POSTAL_ADDRESS` (a physical mailing address printed in
   every footer), `OUTREACH_REPLY_TO` (a monitored mailbox on your own domain,
   not free mail), `EMAIL_FROM` on the verified domain. Then point a Resend
   webhook at `https://<host>/api/webhooks/resend`, set
   `RESEND_WEBHOOK_SECRET`, and subscribe it to `email.sent`,
   `email.delivered`, `email.delivery_delayed`, `email.bounced`,
   `email.complained`, `email.opened` and `email.clicked`. Bounces and
   complaints suppress the address and feed the deliverability guard that
   throttles or pauses sending.
10. **Replies.** Set up Resend inbound routing (an MX record on a reply
    subdomain, or forward `OUTREACH_REPLY_TO` into it) and add
    `email.received` to the Resend webhook, so prospect replies lock the
    prospect as replied and stop follow-ups. Until then, record replies by
    hand in `/control` -> Pipeline.
11. **Ramp.** Start outreach at 5-10 sends a day per mailbox
    (`max_prospect_emails_per_day` in `/control` policies) and keep an eye on
    the deliverability numbers on the Growth tab (bounce rate under 4%,
    complaints under 0.08%). Lifecycle emails to trial venues wait for
    approval until the `lifecycle_email_auto_send` policy is switched on.
12. **Demo couple photos (optional).** "Render a sample" answers
    `409 demo_not_configured` until two or three consented demo couple photos
    are in `lib/brand/assets/demo-couple` or `DEMO_COUPLE_DIR`.
13. **Database TLS.** Download the Supabase CA certificate and set
    `DATABASE_SSL_CA` (PEM text) or `DATABASE_SSL_CA_PATH` so the connection
    is verified, not only encrypted.
14. **Final check.** `pnpm run verify:production -- --url https://<host>` and
    a signed-in walk through signup, venue photos, a tour-day gallery, the
    shared gallery and a test checkout.

## Gallery Quality Gate

Before image generation, the server prepares in-memory copies of every couple
and venue reference with deterministic Lanczos resampling. References whose
shortest edge is below 1024px are upscaled to that minimum, while large images
are reduced when possible without dropping below it. Exposure normalization and
mild sharpening are then applied. Stored originals are never modified, and no
generative face restoration is used because invented facial detail would weaken
identity fidelity.

Run the focused preprocessing check after changing this path:

```bash
pnpm run test:reference-upscaler
```

Before changing model, prompt, scene, or reference-selection logic, run the live
gallery QA harness with real consented couple and venue references:

```bash
pnpm run gallery:qa -- --couple ./samples/couple --venue ./samples/venue --out ./qa-output/live-gallery --style cinematic-editorial --couple-name "Avery & Morgan" --consent-confirmed
```

After inspecting `qa-output/live-gallery/review.html`, create
`qa-output/live-gallery/manual-acceptance.json`:

```json
{
  "accepted": true,
  "reviewedBy": "Your Name",
  "reviewedAt": "2026-06-20T00:00:00.000Z",
  "notes": "Both partners are recognizable in all four stills; venue and motion reel approved."
}
```

`pnpm run verify:production` requires this QA evidence by default. Use
`--qa-report` and `--qa-acceptance` for a different QA output folder, or
`--skip-qa` only for local plumbing checks that are not claiming production
readiness.

Production startup refuses:

- image model chains that do not start with `gpt-image-2.5-sunburst`, or that use models outside the supported gpt-image-2.5 / Gemini 3 set
- a missing `OPENAI_API_KEY` when the chain renders with gpt-image models
- unsupported `OPENAI_IMAGE_QUALITY` or `OPENAI_IMAGE_SIZE` values, because
  every production frame must preserve all couple references and strong venue
  context at a deliverable resolution
- disabled gallery quality review
- lowered likeness, per-partner likeness, venue, or composition thresholds
  (targets that retries aim for), or lowered best-effort acceptance floors
  (the minimum a delivered frame may score when no retry reaches the targets;
  frames between floor and target ship for owner review instead of failing
  the session, but integrity checks - two distinct real partners, visible
  faces, no extra people or text - are never waived)
- fewer than 4 frame attempts
- generated image minimum edge below 1024px
- generated image local contrast or sharpness floors below the production
  defaults
- non-Pro quality judge models
- Gemini `v1` API base URLs (image generation config requires `v1beta`)

Manual review is still required before launch: both partners must be instantly
recognizable as two distinct real identities in all four stills, the venue must
remain the uploaded venue, and the motion reel must be suitable for venue sales
follow-up.

The default image model chain leads with `gpt-image-2.5-sunburst`, OpenAI's
precision image model, then `gpt-image-2.5-flare` for speed, then
`gemini-3-pro-image` as a last-resort fallback. Sunburst is chosen because a
gallery still is a multi-reference composite that has to keep both partners'
faces and the real venue architecture intact, which is exactly the editing
precision it is built for. Renders go to the OpenAI image edits endpoint with
`input_fidelity=high`, up to 16 ordered references, and a per-scene render size
derived from the scene aspect ratio.

`OPENAI_API_KEY` is required in production whenever the chain contains a
gpt-image model, and boot refuses a chain that does not start with
`gpt-image-2.5-sunburst`. `GOOGLE_AI_API_KEY` stays required as well: the
multimodal quality judge and the venue reference selector still run on Gemini.
The Autonomous Business Control Plane reasons with Grok instead and needs
`XAI_API_KEY`; without it the server boots normally and the control-plane
agents simply stay idle (approvals and metrics snapshots keep running).

Quality steps run low, medium, high, xhigh, max, and auto; production uses
`high` via `OPENAI_IMAGE_QUALITY`. Cost and latency climb steeply above it. If a
provider reports a temporary resolution-specific quality incident, keep the AI
quality gate enabled and lower `OPENAI_IMAGE_QUALITY` (or `GEMINI_IMAGE_SIZE=1K`
on the Gemini fallback) only as a temporary operational mitigation, after
running the gallery QA harness with real references.
