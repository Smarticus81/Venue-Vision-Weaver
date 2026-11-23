# Dreemer generated identity

Canonical source: `dreemer-openai-source.png` (2172 × 724, transparent PNG), generated with the OpenAI image model at the user's explicit request. Generation artifact: `exec-4c715552-d5a7-4ea3-983d-1ecb4f28d154.png`.

The mark combines a photo frame, a lowercase D, and a booking check. The lowercase wordmark is part of the generated image, not a substituted font.

`scripts/build-logo.ts` crops the original raster into lockup, mark and wordmark; exports the unchanged ink pixels; and creates a white reversed version preserving the exact alpha channel. It produces PNGs, raster-containing SVG wrappers, email artwork and app icons. It does not trace, redraw, or generate replacement geometry. All standalone SVGs embed their PNG for offline rendering.

Source crop rectangles (x, y, width, height): lockup `(56,148,2069,450)`, mark `(56,148,485,450)`, wordmark `(578,226,1547,307)`.

React uses resized `/brand/dreemer-{lockup|mark|wordmark}-{ink|reversed}.png` (960, 384 and 768 pixels wide respectively) to keep image bytes out of JavaScript and reduce mobile transfer. Server renderers should load the standalone SVGs or supply a full-resolution PNG data URI to `lockupSvg(variant, { imageHref })`. URL-backed wrappers alone are not suitable for offline Sharp rendering.
