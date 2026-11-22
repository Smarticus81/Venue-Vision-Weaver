# Dreemer — venue sales software

Dreemer helps venue teams turn tour interest into a booking conversation through personalized AI galleries, engagement signals and a direct date-enquiry link. The business and its workflow lead the story. Weddings are the use case, not the visual identity.

Tagline: **Turn venue interest into booking intent.**
Direction: **Possibility lens** — glacial light, deep blue ink, a refractive photographic lens, wide upright typography and an open, spatial narrative. This supersedes the rejected graphite/orange workspace direction.

## Source of truth

| Surface | Source |
| --- | --- |
| Colors, type, shape, motion and brand copy | `lib/brand/src/tokens.ts` |
| Generated CSS | `lib/brand/tokens.css` |
| Custom vector mark and wordmark | `lib/brand/src/logo.ts` |
| Email roles and mark | `lib/brand/src/email.ts` |
| Exports | `lib/brand/scripts/build-logo.ts`, `build-og.ts` |
| Motion-design film | `lib/brand/scripts/build-lens-film.ts` |
| Contrast and artwork tests | `lib/brand/src/tokens.test.ts`, `logo.test.ts` |

Web, email and reel renderers share these tokens and logo geometry. Legacy `orange`, `lavender` and `coral` export names alias the new `prism` scale for source compatibility; they are not additional brand colors.

## Color and typography

| Role | Value | Usage |
| --- | --- | --- |
| Deep blue ink | `#092C39` | Primary text and immersive story section |
| Glacial canvas | `#EFF5F5` | Main canvas |
| White | `#FFFFFF` | Raised surfaces and action text |
| Prism blue | `#2A4FDC` | Primary action fill |
| Deep prism | `#1639B6` | Accent text on light surfaces |
| Refracted light | `#CBEAF0` | Lens atmosphere and accents on dark surfaces |

Syne variable carries broad, sculptural headlines. Manrope variable carries body copy and the interface. Self-hosted WOFF2 files use `font-display: swap`; no third-party font request blocks the web app. No italic headline alternation. System monospace is reserved for IDs and operator data. Emails use the shared fallback stack; raster generators use Arial with the vector wordmark.

Use semantic color roles. Pale cyan is not body text on white. Status colors retain their meaning. Shared contrast tests cover supported light/dark text and action states.

## Layout, motion and truthfulness

Lead with the venue's sales problem, show the mechanism, explain engagement signals, then offer a free trial. The signature is one interactive photographic lens. Use open compositions, oversized type, image overlap, a three-chapter story, ruled feature lines and one selectable pricing detail. No feature-card or pricing-card grid. Text links and a separate circular action mark replace pill CTAs.

The 15-second silent H.264 motion-design film uses newly generated AI concept imagery. It has a static poster, captions, inline native controls, no autoplay, and a direct-file fallback. It is **not Seedance footage**. The connected Higgsfield account had zero credits when this version was created; no trial was activated or generation submitted. Asset prompts and provenance are in `docs/possibility-lens-assets.md`.

The interactive story uses labelled examples, not live customer activity. Real dashboard numbers come from the existing API. Do not invent conversion lift, testimonials or customer counts. A date-link click is interest, not a confirmed booking. All AI gallery images remain labelled previews.

No scroll hijacking or automatic carousels. Desktop story chapters follow ordinary page scroll and also have buttons. Mobile and reduced-motion users get manual chapter controls without pinning. The dynamically imported WebGL lens renders only on input, resize or reveal transitions; it stops off-screen and in hidden tabs. Coarse pointers, reduced motion and unavailable WebGL use ordinary images. Preserve visible keyboard focus, touch targets and native video controls.

## Logo

The new mark is a split circular lens. The wordmark is wide custom uppercase DREEMER geometry, with glyph offsets exported alongside the paths. Every renderer uses even-odd fill for counters. Do not reuse the retired lowercase monoline wordmark, arched-doorway mark or forward-frame chevron.

- Color: deep-prism mark with blue-ink wordmark.
- Ink: monochrome blue ink.
- Reversed: pale-blue mark and white wordmark.
- Small icons: the split lens in white with maskable safe insets.

Keep clear space at least one quarter of the mark's width. React consumers use `DreemerLogo`; email and reels use the same geometry. Never stretch the lockup or insert the tagline inside it.

## Rebuild and verify

```sh
pnpm --filter @workspace/brand run build
pnpm --filter @workspace/brand run build:logo
pnpm --filter @workspace/brand run build:og
node lib/brand/node_modules/tsx/dist/cli.mjs lib/brand/scripts/build-lens-film.ts
pnpm run test:brand
pnpm run test:reel-encode
```

Commit generated assets with source. Validate desktop/tablet/mobile layouts and decode the complete video, not just its metadata. Older product-tour media remain compatibility assets but are not the current landing-page direction.

## Deliberate legacy infrastructure names

Supabase bucket defaults `glimpse` / `glimpse-public` remain in object storage, setup scripts and environment templates because live venue photos and galleries already use them. The security smoke asserts these defaults. Renaming requires copying stored objects, updating Railway variables and verifying readiness before removing old buckets; do not change these names as part of a visual redesign. Database tables and columns never carried the old name.
