# Dreemer — venue sales software

**Turn tours into bookings.** Show couples themselves at a venue using personalized previews and a private gallery. Give venue teams views, shares and date-link clicks to inform follow-up. Do not promise a conversion increase or guaranteed bookings.

## Messaging rule

Lead with the product and the venue's business outcome, never "AI" or "AI-powered". Use personalized previews, private galleries, motion reels and follow-up. This applies to landing copy, pricing, metadata, social cards, tour cards and outreach. Keep plain-language disclosures that previews are digitally generated, not photographs of an actual event, and preserve both partners' consent. Internal provider names, technical settings and asset provenance remain accurate.

## Direction: the venue, in focus

Real architecture fills the frame. Upright oversized type says what the software does. The interactive comparison demonstrates the product; a clearly labelled sample workspace explains the business value. No lens ornaments, italic headline alternation, floating pills or feature-card grid.

This replaces the rejected possibility-lens direction. Its old files are compatibility/history assets, not the current landing page.

## Identity

The logo is the actual OpenAI-generated artwork: overlapping photographic frames form a D, with a check-shaped detail for a booking. The lowercase wordmark is part of that artwork, not live text or a font substitution. The canonical source is `lib/brand/assets/logo/dreemer-openai-source.png`. `build-logo.ts` crops the original pixels and preserves alpha; the reversed version changes only color. SVG exports embed the raster artwork; they are not claimed to be original vector art.

Use `DreemerLogo` for React. Use generated self-contained SVG or an inline PNG data URI for offline image rendering. Never stretch the wide lockup. Email and reel consumers use the same generated artwork. Maskable icons keep the mark inside the safe circle.

## Shared tokens

- Ink `#101116`: text and dark surfaces.
- White `#FFFFFF`: landing canvas and reversed text.
- Neutral `#F5F5F7`: app canvas; `#EEEEF1`: app bands.
- Grey `#5D6068`: secondary text.
- Blue `#2A4FDC`: application actions; `#1639B6`: links and selection signals.
- Manrope, upright: display and interface. Self-hosted, swap, one critical font preload.

`lib/brand/src/tokens.ts` is the source of shared web/email/reel roles. `tokens.css` is generated. Legacy orange/lavender/coral identifiers alias blue for API compatibility. Status colors remain semantic and contrast-tested. Landing CSS uses local neutral/photo-overlay colors; no new palette dependencies.

## Media and behavior

Knotting Hill Place is an example venue, not a claimed customer or partner. The user confirmed permission for public use of the official photos and AI video derived from them. Credits remain visible; sources, prompts and generation status are in `docs/venue-cinema-assets.md`.

The before/after couple is an OpenAI-generated fictional example, not a captured customer result. The sales workspace uses labelled sample data. A branded customer motion reel is assembled from the generated gallery stills; do not describe that existing product feature as premium generative video.

The landing-film player is muted, inline, poster-first, pausable, and stops off-screen/in hidden tabs. Reduced-motion and data-saving users are not auto-played. A generated film is not enabled until its actual file has passed visual inspection. Never substitute an animated slideshow and label it premium generated video.

## Dusk scene direction — November 22, 2026

The public landing now uses architectural dusk: deep plum `#241039`, scene surface `#382052`, lilac `#ded1f0`, amber `#ffc786` and peach `#ffbca3`. Upright Manrope remains readable; no italic headline pairing, technology branding or invented customer proof. The original venue photo is available alongside its clearly disclosed lighting visualization. The interactive comparison is the primary product demonstration; no decorative continuous animation or scroll hijacking. Pricing, privacy and signup inherit quiet lilac/plum surfaces.

## Rebuild and verify

```sh
pnpm --filter @workspace/brand run build
pnpm --filter @workspace/brand run build:logo
pnpm --filter @workspace/brand run build:og
pnpm run typecheck
pnpm run test
pnpm run test:reel-encode
pnpm run smoke:security
pnpm run build
```

Check 360, 375, 768 and 1440px layouts, keyboard comparison control, plan selection and CTA routes. Decode the whole video and check actual browser playback. Do not claim physical mobile or field performance verification from a desktop viewport test.

Supabase bucket names and all customer-data/auth/outreach safeguards are outside this visual redesign. Do not rename buckets or relax guards to ship the page.
