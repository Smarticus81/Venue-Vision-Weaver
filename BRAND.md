# Dreemer — venue sales software

Dreemer helps venue teams turn tour interest into a booking conversation through personalized AI galleries, engagement signals and a direct date-enquiry link. The business and its workflow lead the story. Weddings are the use case, not the visual identity.

Tagline: **Turn venue interest into booking intent.**
Direction: **Venue sales workspace** — solid geometric lettering, graphite, white and signal orange; confident commercial typography and rectangular controls.

## Source of truth

| Surface | Source |
| --- | --- |
| Colors, type, shape, motion and brand copy | `lib/brand/src/tokens.ts` |
| Generated CSS | `lib/brand/tokens.css` |
| Custom vector mark and wordmark | `lib/brand/src/logo.ts` |
| Email roles and mark | `lib/brand/src/email.ts` |
| Exports | `lib/brand/scripts/build-logo.ts`, `build-og.ts` |
| Product walkthrough | `lib/brand/scripts/build-product-video.ts` |
| Contrast and artwork tests | `lib/brand/src/tokens.test.ts`, `logo.test.ts` |

Web, email and reel renderers share these tokens and logo geometry. Legacy `lavender` and `coral` export names alias the orange scale for source compatibility; they are not additional brand colors.

## Color and typography

| Role | Value | Usage |
| --- | --- | --- |
| Graphite | `#152020` | Primary text, navigation, dark sections |
| White | `#FFFFFF` | Main canvas |
| Equipment grey | `#EDF0ED` | Quiet section surfaces |
| Signal orange | `#FF793D` | Action fill with graphite text |
| Deep orange | `#9B340D` | Accent text on light backgrounds |

Barlow Condensed 600/700 carries short, forceful headlines and figures. IBM Plex Sans variable carries body copy and the interface. Self-hosted WOFF2 files use `font-display: swap`; no third-party font request blocks the web app. No italic headline alternation. System monospace is reserved for IDs and operator data. Emails use the shared fallback stack; raster generators use Arial with the vector wordmark.

Use semantic color roles. Bright orange is not body text on white. Status colors retain their meaning. Shared contrast tests cover supported light/dark text and action states.

## Layout, motion and truthfulness

Lead with the venue's sales problem, show the product workflow, explain the signals, then offer a free trial. Use asymmetric headline/copy blocks, full-width product demonstrations, contrasting workflow sections and generous whitespace. Rectangular controls use small corner radii, not pill-shaped marketing boxes.

The 15-second silent H.264 walkthrough is built from labelled interface illustrations. It has a static poster, captions, inline native controls, no autoplay, and a direct-file fallback. It is **not Seedance footage**. The connected Higgsfield account had zero credits when this version was created; no trial was activated or generation submitted. Existing AI example imagery is used only inside the product demonstration, never represented as real customer results.

The interactive preview uses sample data. Real dashboard numbers come from the existing API. Do not invent conversion lift, testimonials or customer counts. The ROI calculator is explicitly a user-controlled gross-revenue scenario, not a forecast or profit promise. All AI gallery images remain labelled previews.

No scroll hijacking or automatic carousels. Reduced-motion users get immediate state changes; video starts only after user action. Preserve visible keyboard focus, touch targets and native video controls.

## Logo

The new mark is a forward-frame chevron. The wordmark is solid custom uppercase DREEMER geometry, with glyph offsets exported alongside the paths. Every renderer uses even-odd fill for counters. Do not reuse the retired lowercase monoline wordmark or arched-doorway mark.

- Color: deep-orange mark with graphite wordmark.
- Ink: monochrome graphite.
- Reversed: bright-orange mark and white wordmark.
- Small icons: the forward-frame mark with maskable safe insets.

Keep clear space at least one quarter of the mark's width. React consumers use `DreemerLogo`; email and reels use the same geometry. Never stretch the lockup or insert the tagline inside it.

## Rebuild and verify

```sh
pnpm --filter @workspace/brand run build
pnpm --filter @workspace/brand run build:logo
pnpm --filter @workspace/brand run build:og
node lib/brand/node_modules/tsx/dist/cli.mjs lib/brand/scripts/build-product-video.ts
pnpm run test:brand
pnpm run test:reel-encode
```

Commit generated assets with source. Capture product illustrations through the supported browser tooling before rebuilding video; inspect the entire captured panel. Validate desktop/tablet/mobile layouts and decode the complete video, not just its metadata.

## Deliberate legacy infrastructure names

Supabase bucket defaults `glimpse` / `glimpse-public` remain in object storage, setup scripts and environment templates because live venue photos and galleries already use them. The security smoke asserts these defaults. Renaming requires copying stored objects, updating Railway variables and verifying readiness before removing old buckets; do not change these names as part of a visual redesign. Database tables and columns never carried the old name.
