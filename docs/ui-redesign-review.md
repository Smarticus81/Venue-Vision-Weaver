# Glimpse UI replacement — review

The interface has been rebuilt around three jobs: a venue team sets up and runs its workspace; couples create their wedding vision; couples return to, save, and share their gallery.

## Major UX changes

| Journey | Before | Now |
| --- | --- | --- |
| Venue discovery | Full-screen manifesto, marquee, pinned scroll sequences | Photo-led introduction, visible action, sample gallery, ordinary scrolling |
| Owner workspace | Settings, creation, photos, deliveries, and billing in one long page | Five task views with persistent venue context and a compact metrics strip |
| Couple creation | Full-screen rotating venue scene followed by large centered steps | User-controlled venue photos and a three-step workspace with focus/scroll management |
| Gallery | Autoplay reel, overlay title, floating toolbar, portraits lower down | Portrait viewer and thumbnails beside sharing, optional reel, and venue contact action |
| Recovery | Centered decorative form | Labeled email form with persistent input and nearby error feedback |

## Visual language and design system

Warm white canvas, botanical green actions, light olive secondary surfaces, DM Sans for controls, and DM Serif Display for expressive public headings. Shared SiteHeader, SiteFooter, and FormLayout replace the old shell. Buttons, fields, Clerk appearance, notifications, favicon, and social preview use the new system. The custom cursor, marquee, frame ticks, pinned-scroll scenes, old fonts/tokens, and obsolete shell/motion module were removed. Existing sample gallery photography and the viewfinder brand mark are intentionally retained as assets, not layout direction.

The hero was generated through Higgsfield: job `9d6bf43d-32da-4f4d-8dd1-a92697e06169`. The returned model was `nano_banana_2`. The source was converted to a self-hosted 1400px WebP (354,662 bytes). It is labeled as an AI illustration.

## Responsive behavior

Public layouts reflow to one column on phones. The sample gallery becomes two columns. The owner sidebar becomes a labeled native view selector. Creation guidance becomes a compact row and forms flow vertically. Gallery controls stay in document flow rather than covering content.

## Accessibility

Visible focus outlines, 44px primary controls, input labels, selected-state ARIA, skip links, step focus management, touch-visible image actions, and an accessible notification dismiss control. Removed the viewport zoom restriction. CSS and Framer Motion respect reduced-motion preferences. Corrected duplicate onboarding headings and added explicit recovery/retry controls.

Baseline guidance consulted: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds). This is not an accessibility conformance certification; screen-reader testing and a full automated contrast audit remain outstanding.

## Performance

No new production dependencies. Public landing pages no longer depend on the decorative motion module or scroll-position animation. Route splitting remains. Hero dimensions reserve its space, gallery imagery has a stable frame, and the reel loads metadata on demand with native controls rather than autoplay. Font preconnects and swap behavior remain. Field LCP, INP, and CLS were not measured; no Core Web Vitals claim is made.

## Verification performed

- `pnpm run build`: passed, including shared-library, API, SPA, and scripts typechecks.
- `pnpm --filter @workspace/wedding-app exec tsc --noEmit --noUnusedLocals --noUnusedParameters`: passed.
- `git diff --check`: passed.
- Browser inspections at 390px, 768px, 1440px, and 1920px; original landing screenshot compared with the new composition.
- Public home, couple entry, recovery, missing-page, and unavailable-sign-in screens inspected. Phone route checks found no horizontal overflow or unnamed buttons on those routes.
- Isolated fixtures used to inspect all five owner views, venue creation, couple welcome/upload/style, gallery, processing, and failed-generation states.
- Generated local sample selected in the upload step; continuation became enabled. Photo, selected style, and entered names persisted across back/forward step navigation.
- Venue-save and recovery request failures showed feedback and retained entered input.
- Gallery thumbnail selection changed the hero image and download URL together.
- Mobile workspace selector exposed all five views.

Screenshots are stored in the task's local visualization directory: `C:/Users/tmuso/.codex/visualizations/2026/09/07/01a07a2b-5a63-7872-b8a3-16b007e4cfab` (landing desktop/mobile, workspace, onboarding, processing, recovery).

## Review locally

Normal frontend: `pnpm --filter @workspace/wedding-app run dev` (port 8081).

Isolated sample-data UI: `pnpm --filter @workspace/wedding-app run dev:ui-fixture` (127.0.0.1:8082). See `artifacts/wedding-app/qa/README.md`. These fixtures do not validate authentication or external integrations.

## Main files

`src/index.css`, `src/components/layout/SiteChrome.tsx`, shared button/input/toast components, `src/lib/clerk.ts`, every primary page, `index.html`, and public brand assets, all inside `artifacts/wedding-app`. The API contracts, generated client, credit operations, storage paths, and authentication flow are preserved. The redesign itself does not alter backend or database behavior. The synchronization merge includes upstream backend fixes, generated readiness contracts, and its updated lockfile.

## Remaining verification

A configured environment is needed for real Clerk sign-in and organization creation, uploads to storage, AI generation, successful email delivery, Stripe checkout/webhooks, and native reel playback with a real video. Those operations were not exercised against live services. The fixture is deliberately unable to send messages, buy credits, save records, or delete data. No deployment was performed.

## GitHub synchronization

Integrated origin/main at `00d3054`. Retained the garden layouts while carrying forward Clerk loading/failure and domain handling, stale-chunk recovery, immediate 404 handling, API-authoritative couple readiness, dashboard QR export, and an accessible gallery deletion dialog. Upstream image preparation and byte-range delivery changes are included unchanged. Superseded dark dashboard and video-hero components are omitted.

Post-merge validation: frozen installation with pnpm 10.26.1; full build/typecheck; strict frontend unused-code checks; 4 byte-range tests and 3 reference-upscaler tests all passed. Browser fixtures verified mobile dashboard/QR export, accessible delete confirmation/cancel, and successful entry for a ready venue with one reference photo. Live integrations remain unverified as described above.
