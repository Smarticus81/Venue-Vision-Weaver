# glimpse Production Readiness

Use this checklist before calling a glimpse deployment production-ready.

## Build Gate

```bash
pnpm install
pnpm run smoke:security
pnpm run typecheck
pnpm run build
```

## Runtime Gate

For an existing database, first run `supabase/production-v1-preflight.sql` in
the Supabase SQL editor. Every `row_count` should be `0` before applying the V1
schema contract because production now requires venue owner emails, couple
emails, share tokens, venue media coverage metadata, and unique generated
gallery asset slots.

Set real production environment variables, then run:

```bash
pnpm run verify:production
```

The command checks:

- production environment policy with `NODE_ENV=production`
- generated API and web app build artifacts
- source-contract smoke tests for gallery-only flow, owner auth, protected
  storage, billing-event idempotency, quality thresholds, and generated asset visibility
- ffmpeg availability for the branded motion reel, either locally or through the
  Railway Dockerfile deployment image
- saved live gallery QA evidence from real consented references, including an
  automated passing `quality-report.json` with input SHA-256 fingerprints and
  manual acceptance marker
- migrated database tables, columns, non-null constraints, and critical unique
  indexes for uploads, owner sessions, generated gallery metadata, and billing
  webhook idempotency

After deployment, verify the live app:

```bash
pnpm run verify:production -- --url https://your-glimpse-host.example
```

The deployed `/api/readyz` endpoint must return `200` with every check set to
`ok`: env, database, storage, AI, billing, email, quality gate, image model, and
ffmpeg.

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
test. It degrades if launch-critical schema items are missing or nullable,
including owner magic-link/session columns, generated-asset quality metadata
columns, venue media coverage metadata, venue slug and share-token uniqueness,
upload intent uniqueness, owner auth token/session uniqueness, and the partial
unique `stripe_event_id` index that prevents billing webhook replay (Clerk svix message ids) from
duplicating credits.

Railway is configured to use `/api/readyz` as the deploy health check, so a
deployment with missing DB/storage/Gemini/Stripe/Clerk/email/ffmpeg readiness should
not be treated as healthy.

## Gallery Quality Gate

Before Gemini generation, the server prepares in-memory copies of every couple
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

- image model chains that do not start with `gemini-3-pro-image`
- image model chains that include non-Gemini-3 image models, because every
  production frame must preserve all couple references and strong venue context
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

The default image model chain uses Gemini 3 Pro Image (Nano Banana Pro) first
and Gemini 3.1 Flash Image (Nano Banana 2) as the fallback, matching the current
Gemini native image generation guidance for professional asset production,
high-resolution output, and multi-reference workflows. If Google reports a
temporary resolution-specific quality incident, keep the AI quality gate enabled
and use
`GEMINI_IMAGE_SIZE=1K` only as a temporary operational mitigation after running
the gallery QA harness with real references.
