# Dreemer overhaul: execution and acceptance

## Objective

Rebuild the public identity, website, venue workflow, couple experience and
rendering pipeline; deploy a functioning application with excellent output
quality and measurable unit economics. A passing build alone is not completion.

## Authoritative starting point — 2026-11-21

- GitHub main: `5ec3bb043c9b7d21394b6a466d2ba1cc8074e4ed`.
- Fresh checkout: `Venue-Vision-Weaver/overhaul`; branch `agent/dreemer-overhaul`.
- Production Railway project: `b88f1950-3428-46ec-a770-a6f9395dea5f`.
- Service: `37a49029-d6bb-424e-b201-1e6c2099a29a` (`dreamweever`).
- Environment: `fa576937-1a19-46e2-9423-c3adcdccc33c`.
- Domains: `www.dreemer.co`, `dreemer.co`.
- Latest deployment `fba391d9-6200-4056-b58f-02b9510c35de` failed at startup.
  Railway diagnosis identifies placeholder EMAIL_FROM and missing
  RESEND_WEBHOOK_SECRET with the control plane enabled. Verify original logs
  and provider configuration before changing deployment settings.
- Existing app includes Clerk organization billing, Stripe credits, OpenAI
  image edits, Gemini judging/fallback, render telemetry and a growth console.
  Validate those contracts rather than assuming the older July code is current.

## Work and evidence required

1. Brand: new vector mark and custom wordmark; favicon, app icons, email,
   social card and reel branding agree. Visually inspect small and large sizes.
2. Marketing: mobile-first product demonstration, honest output examples,
   clear venue benefit, pricing tied to billing configuration, accessible CTA.
3. Onboarding: sign-in, organization creation, venue setup, reference-photo
   quality feedback, sample workflow, QR/tour flow and credit purchase work.
4. Rendering: confirm actual provider/model access and supported parameters;
   preserve each partner and the exact venue, evaluate real consented reference
   sets, bounded retries/deadlines, output review and safe refunds.
5. Economics: record actual attempts and estimated spend per successful gallery;
   expose margins with explicit assumptions; never claim maximum profit from
   unmeasured conversion rates. Keep outgoing communications within authority.
6. Gallery: complete stills, mobile reel play/seek, downloads, sharing, venue
   contact, review holds and recovery verified at mobile and desktop sizes.
7. Deployment: production sender and webhook configured, schema and storage
   validated, build/tests/security smoke/codegen pass, deployment healthy and
   real HTTPS routes verified. No goal completion until the end-to-end product
   is proven in the deployed environment.

## Current work

### November 21 checkpoint: verified email domain

- Recovered native Chrome input and used the existing signed-in GoDaddy session.
  Reviewed all 16 existing DNS records before adding only the three Resend
  records: TXT `resend._domainkey` with Resend's public DKIM value, CNAME `rsend`
  to `rsend.forge.rmta.net`, and CNAME `send` to `send.forge.rmta.net`. New records
  use GoDaddy's 30-minute TTL. Existing A, NS, Clerk, www, DMARC and verification
  records were not edited or deleted.
- GoDaddy confirmed the save. Both authoritative nameservers (ns33 and ns34)
  return the expected records. Resend reports the domain **Verified**, Forge
  **Ready**, and "Your domain is ready to send emails". This resolves the DNS
  setup blocker; it is not an end-to-end email-delivery test.
- Restricted the already-created `Dreemer production sending` API key from all
  domains to `dreemer.co`, retaining sending-only permission. No new key was
  created and no older key was changed. Resend shows zero uses/no activity.
- Railway confirms exactly two staged, non-destructive variable changes:
  RESEND_API_KEY and RESEND_WEBHOOK_SECRET. They are still staged, not applied
  to the running service. No deployment or email was triggered.
- Local evidence (ignored): `qa-output/resend-domain-verified.jpg` and
  `qa-output/resend-key-domain-scope.jpg`. Remaining launch gates include
  applying those secrets with the release, consented real-reference gallery
  QA, deployment/runtime checks and live Clerk/billing/mobile workflows.

### November 21 checkpoint: non-destructive venue photo workflow

- Replaced the delete/re-upload retag workflow with OpenAPI-first
  `PATCH /venues/{slug}/media/{mediaId}`. The existing Clerk organization and
  mutation-origin guard authorizes the venue; the SQL update also matches both
  venue and photo IDs. Only coverage can change. No storage calls, migration,
  public grants, RLS changes or new credentials are required.
- HTTP tests cover valid/repeated edits, unknown fields, invalid IDs/categories,
  authorization refusal, missing/foreign IDs and failed writes. A separate
  SQL-shape assertion checks the actual Drizzle update predicate. A PostgreSQL
  transaction using a temporary LIKE-table and synthetic rows confirmed the
  scoped write and preservation of reference metadata; the transaction was
  rolled back and no production photo rows or objects were modified.
- Browser fixture confirms category changes and failure retention. Moved photo
  actions below images, made touch targets 44px and fixed the logo/picker overlap
  found at phone width. Inspected 375/768/1440px with no horizontal overflow.
- Fresh codegen/no-drift and build/typecheck passed in session 29987 after the
  final CSS adjustments; full tests and security smoke passed in session 89746.
  Commit `8bdaaf8` is pushed and GitHub CI run `44987867367` passed every step,
  including actual reel encoding/decoding. Real Clerk authorization and deployed
  workflow checks remain launch gates.
- Production recheck: Railway still lists the October 9 failed deployment as
  its latest attempt. Public DNS still returns NXDOMAIN for resend._domainkey,
  rsend and send under dreemer.co. No deployment or email was triggered.

### November 21 checkpoint: real motion-reel encoding

- Added `pnpm run test:reel-encode`, using geometric fixtures rather than any
  customer images. It runs the production title-card, frame-composition, clip
  encoder and concatenation path, then probes and fully decodes the result.
- The first real encode exposed full-range `yuvj420p` output despite the
  requested `yuv420p`. Explicitly convert JPEG sample range to limited-range
  video and tag it consistently. The regression verifies decoded lavender,
  black and white pixels, not just the container's color-range metadata.
- Replaced the second lossy encode during concatenation with stream copying.
  This is limited to internally generated, codec/time-base-matched clips; it
  is not a generic arbitrary-video concatenator. Fast-start MP4 is retained.
- Latest local integration check passes H.264/avc1, yuv420p/tv, 1280x720,
  square pixels, 30 fps, all 120 frames with continuous timestamps, four-second
  duration, moov-before-mdat and complete error-checked decode. The final
  synthetic fixture encoded to 471,377 bytes in 1,532 ms on this workstation;
  this is not a production throughput, visual-quality or cost benchmark.
- Added an explicit ffmpeg/ffprobe installation and integration-test step to
  GitHub CI. Full unit tests, security smoke and build/typecheck exited 0 in
  local session 17676. Physical iOS/Android and live HTTPS playback remain
  unverified; the overhaul is not yet deployed.

### November 21 checkpoint: payment-risk handling

- Updated Stripe Node to 23.2.0 and added refund, dispute and early-fraud-warning
  handling. Stripe object relationships map payments to organizations; unknown,
  conflicting and unmapped-subscription cases require human review. No automatic
  refunds, cancellations, credit changes or messages are authorized by these events.
- The risk event, operator task and audit entry commit in one database transaction.
  Regression tests cover duplicate delivery, simulated failed writes, lookup
  retries, partial refunds and modern multi-invoice payments. These are fake-store
  tests, not proof of live PostgreSQL transaction behavior or Stripe delivery.
- Fresh full tests, security smoke, codegen/drift check and build/typecheck exited
  0 in terminal session 56967. The risk subscriptions are intentionally not yet
  enabled on the live endpoint: deploy the handlers before subscribing to them.
- Rechecked DNS: all three Resend verification records still return NXDOMAIN.
  Railway still reports the failed main deployment as latest; this branch has
  not replaced the old running application. Tax configuration, live checkout,
  webhook signatures, email and real-reference quality remain launch gates.

### November 21 checkpoint: schema reconciliation and email/TLS setup

- Added the ten missing billing, gallery, telemetry and growth tables plus the
  missing columns and indexes with the additive migration
  `20261122043110_reconcile_application_schema.sql`. Ran it first in a rolled-back
  transaction, then committed the reviewed SQL through execute_sql. Like the
  earlier RLS migration, this is not a Supabase migration-history entry; do not
  assume the CLI history reflects the live changes.
- Readiness now derives every table, column and NOT NULL requirement from the
  exported Drizzle schema instead of a hand-maintained subset. Live metadata
  satisfies all 33 application tables, 419 columns and the critical-index checks.
  Legacy owner-auth tables remain intact and are not application requirements.
- Post-migration counts are unchanged: 14 venues, 6 organizations, 7 sessions,
  35 assets, 110 credit transactions, and 95 organization credits. All 36 public
  tables have RLS enabled; anon/authenticated have zero table grants. Advisors
  report only intentional server-only RLS-without-policy notices, not an
  application-tenant-isolation guarantee for the privileged backend role.
- Full tests (session 13302) and production build/typecheck (92193) exited 0.
  The new readiness regression covers billing/growth tables and previously
  omitted ORM columns.
- User approved a new sending-only Resend key and delivery webhook. Created
  `Dreemer production sending`, retaining all prior keys. The UI currently
  offers only `All domains` for sending access; domain restriction is not yet
  configured. Added dreemer.co and the seven supported delivery events at
  https://www.dreemer.co/api/webhooks/resend. No emails were sent.
- RESEND_API_KEY and RESEND_WEBHOOK_SECRET are staged in Railway, not deployed.
  EMAIL_FROM is saved as `Dreemer <notifications@dreemer.co>` and
  CONTROL_PLANE_ENABLED=off is saved for the next deployment. These values do
  not imply a change to the old container's running environment. DNS remains
  unverified: the user has been asked to add the three exact Resend records
  in GoDaddy after native browser controls failed. No existing DNS was changed.
- Downloaded the public CA certificate linked by this project's Supabase
  Database Settings and saved DATABASE_SSL_CA in Railway without deployment.
  A fresh node-postgres connection using the saved CA and
  rejectUnauthorized=true verifies the client-to-session-pooler TLS connection
  (encrypted=true, authorized=true). pg_stat_ssl describes the pooler-to-DB
  hop, not this client connection; do not conflate the two.
- Remaining launch gates include DNS verification, applying staged email
  secrets, deployed runtime checks, billing/Clerk workflow validation and
  consented real-reference image-quality/cost benchmarks. Consented reference
  sets have been requested; existing customer photos are not authorized QA
  fixtures. The goal is not complete.
- Stripe read-only verification confirms charges/payouts enabled, no currently
  due account requirements, and all three configured live prices active.
  Detected a display mismatch: live USD charges are 149/month, 399/month and
  49/pack, whereas app defaults were 129/279/59. Saved matching PRICING_*
  values in Railway without deploying or changing any Stripe price. Renamed
  the three mapped products to Dreemer Starter, Dreemer Growth and Dreemer
  Credit Pack; existing prices, subscriptions and balances are untouched.
- The active Dreemer Stripe endpoint is on
  dreamweever-production.up.railway.app, not the custom domain. Added the
  missing invoice.payment_failed, customer.subscription.updated and
  customer.subscription.resumed event subscriptions to that exact endpoint
  (`we_1TkbZ0KCLfkT6EM1nDoPbu3h`), preserving its other subscriptions and API
  version. The unrelated workspaceapi-server endpoint was left unchanged.
  Default customer portal is active and enables payment-method updates,
  invoices, cancellation and price switching. Live signature delivery,
  checkout, tax setup, and refund/dispute/fraud-event handling remain unproven;
  no payment, refund or live checkout was initiated during these checks.

### November 21 checkpoint: brand, marketing and production audit

- Implemented the blue-hour album landing, contact-sheet interaction, shared
  lavender/midnight palette, deterministic illustrated social card, corrected
  raster-logo proportions, and editable revenue scenarios with capped uplift
  and required top-up costs. See BRAND.md and design-notes.md.
- Full test/security/build run 75235 exited 0; follow-up codegen + build 83395
  exited 0 after the tablet layout fix. Generated API outputs have no drift.
  Browser checks at 375/768/1440 pass the inspected layouts and calculator
  scenarios. No production performance or physical-device claim is implied.
- Railway CLI authentication is restored. Local checkout linked explicitly to
  the project, production environment and dreamweever service listed above.
  Variable values were inspected only in memory, never saved or printed.
- APP_BASE_URL is correctly https://www.dreemer.co. Boot still rejects the
  placeholder EMAIL_FROM and absent RESEND_WEBHOOK_SECRET. Read-only Resend
  domains/webhooks requests return HTTP 400, "API key is invalid"; the configured
  key is only six characters. Resend browser sign-in is now awaiting the user
  so the actual sender, key and webhook can be recovered/configured.
- Read-only model retrieval returns HTTP 200 for gpt-image-2.5-sunburst using
  the configured OpenAI credential and gemini-2.5-pro using the Google key.
  This verifies credential/model visibility, NOT image generation permission,
  quota, output quality or cost. No paid generation or email was triggered.
- Supabase project brtghcerldjsjqduqvvj is the configured dreamweever database.
  Existing configured buckets venue-vision (private) and venue-vision-public
  (public) exist. No bucket contents or permissions were changed.
- Security audit found all 26 public tables had RLS disabled and broad grants
  to anon/authenticated. No public views, functions or policies existed. The
  configured backend role is postgres, with bypassrls, matching the documented
  Clerk-protected/server-only access model.
- Applied the repository's server-only access contract with the idempotent SQL
  in supabase/migrations/20261122042650_protect_server_only_tables.sql through
  execute_sql (not a recorded Supabase migration-history entry). Enabled RLS
  on the 26 audited tables, revoked anon/authenticated table privileges, and
  revoked their future default table privileges for postgres. No rows or
  tables were deleted. Legacy credentials remain pending a separate retirement
  and exposure review; do not infer that historical access did not occur.
- Verification: 26 tables, zero without RLS, zero public-role table privileges,
  backend SELECT access retained. Actual SELECT probes as anon and authenticated
  return 42501 permission denied. Security advisors now report only expected
  INFO "RLS Enabled No Policy", appropriate to server-only access:
  https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Read-only schema snapshot (qa-output/production-schema-snapshot.json, ignored)
  evaluated against the application readiness contract reports 28 violations:
  three missing tables (gallery_events, render_attempts, funnel_events), their
  columns, couple_sessions.delivery_hold_reason, and the partial unique trial
  grantee index. Further full schema reconciliation is needed: this minimum
  contract is not proof that every billing/growth table is present.
- Control-plane agents/outreach policies are enabled in production; no
  autonomous_mode override exists (default is true). Before starting a repaired
  service, keep automated outbound activity disabled until launch authority
  and integration safety are verified. No policy was changed during this audit.
- Still outstanding: production email configuration, remaining schema migration,
  verified DB TLS configuration, full workflow/provider benchmarks, deployed
  end-to-end checks, and performance/economics evidence. Goal remains active.

### Earlier checkpoint

- Repository and production target recovered; locked dependencies installed.
- New architectural D/aperture identity being implemented in shared geometry.
- Generated logo assets and brand checks pass. Full production build passes
  after resolving the pre-existing Windows Billing/billing import collision by
  naming the non-component module billingModel.ts.
- The old test run (session 11418) was confirmed live, then its identified
  test child was stopped after isolating a Windows-path assertion in the last
  readiness test. The assertion now compares normalized paths. The readiness
  suite passes all 36 tests; the fresh full test run (81248) exits successfully.
- `pnpm run test`, `pnpm run smoke:security`, and `pnpm run build` (including
  all-package typecheck) pass on November 21. `git diff --check` is clean.
- Mobile reel component now handles rejected autoplay, explicit tap-to-play,
  retry/open-video errors, reduced motion and data-saving preferences; hidden
  tabs pause. Native inline playback and controls remain available. Three new
  helper/markup tests pass. Browser checks at 360/375, 768 and 1440px show
  responsive layouts, decoded H.264 playback, tap-to-resume and error recovery
  UI. Physical iOS/Android and production storage playback are still unverified.
- Dev-only `/v/reel` and `/v/reel-error` fixtures use a generated synthetic test
  pattern, not customer photos or an output-quality claim. Screenshot evidence:
  `qa-output/mobile-reel-playback.jpg` (local, ignored). Fixture server is in
  terminal session 97858 on 127.0.0.1:8082.
- Railway still reports the same failed deployment. Historical runtime logs
  were unavailable even with the explicit October 9 time range. The connected
  OAuth tool exposes variable names only; local `railway whoami --json` says
  Unauthorized. User has been asked to reauthenticate with `railway login`.
  No production settings have been changed or safety validation bypassed.
- Official OpenAI docs confirm the existing gpt-image-2.5-sunburst model is
  documented (not an invented repository identifier). Provider account access
  and actual output quality remain unproven; do not switch models solely on a
  documentation claim. See https://developers.openai.com/api/docs/guides/image-generation
  and https://developers.openai.com/api/reference/resources/images/methods/edit.
- Production configuration, provider benchmarks, full visual overhaul and
  end-to-end live verification remain outstanding.
