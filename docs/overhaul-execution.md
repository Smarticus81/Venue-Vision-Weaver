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
