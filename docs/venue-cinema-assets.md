# Venue cinema asset provenance

Date: 2026-11-22. The user explicitly confirmed permission to use Knotting Hill Place's official photos and AI video derived from them on Dreemer's public website. No partnership or customer relationship is claimed. Visible credits link to https://www.knottinghillplace.com/gallery.

## Official photography

Source gallery: https://www.knottinghillplace.com/gallery

- Exterior: https://images.squarespace-cdn.com/content/v1/5a33ee134c0dbffac2f77e32/1635825679230-HAJ0RI3T5P7UAI8TRJ40/WOP_3791-HDR+%281%29.jpg — embedded creator Debora Conn / rights White Orchid Photography. Optimized exports: `artifacts/wedding-app/public/brand/khp-exterior-{1920,800}.webp`.
- Entryway: https://images.squarespace-cdn.com/content/v1/5a33ee134c0dbffac2f77e32/1635825704515-9VAUXKC2C3YIESVVQQRV/WOP_3835-HDR+%281%29.jpg — same embedded credit. Export: `khp-entryway-1536.webp`.
- Event lawn: https://images.squarespace-cdn.com/content/v1/5a33ee134c0dbffac2f77e32/1577738346967-0PXK26IG0B6KBW329QV9/rear+view.jpg — embedded credit D. Lacy Photo / D. Lacy. Export: `khp-lawn-1920.webp`.

Web exports use Sharp WebP quality 85. Source files had no visible watermark; the separate watermarked cathedral candidate was rejected, not cleaned. Public accessibility alone was not treated as a license.

## OpenAI logo

Mode: built-in OpenAI image generation, transparent background. Source retained at `lib/brand/assets/logo/dreemer-openai-source.png`. Production crops and alpha-preserving reversed variants are in the same directory and public `/brand/` assets. No substitute font, traced replacement or invented vector geometry.

Final prompt:

> Use case: logo-brand. Create the final production logo for Dreemer, a business-to-business software platform that turns venue photos and couple portraits into personal AI galleries, then helps the venue follow up and win bookings. One horizontal logo lockup only, on a genuinely transparent background. The symbol must have a clear idea: two overlapping photographic frames resolve into a bold, simple letter D, with a small decisive check-shaped negative-space cut that represents a confirmed booking. Make it a beautifully balanced, ownable graphic mark, strong at favicon size, not a generic camera, sparkle, wedding arch, lens, power button or infinity sign. Pair the symbol with an exceptionally well-kerned custom lowercase wordmark spelling exactly "dreemer" (d-r-e-e-m-e-r). Upright confident contemporary sans-serif lettering, slightly condensed but highly readable, subtle bespoke letter detail; no italics, no script, no serif. Single solid near-black #101116 throughout, crisp flat vector-like edges, no gradients, no shadows, no 3D, no mockup, no textures, no other words or slogans, no extra variants. Wide horizontal composition with symbol on the left and wordmark to its right; balanced spacing, logo fills most of the width with generous clear margin. This is a serious software brand for venue businesses, not a bridal brand. Deliver one polished usable identity, not a presentation sheet.

## Couple demonstration

Mode: built-in OpenAI image editing, official entryway photo as edit target. Output: `artifacts/wedding-app/public/brand/khp-couple-1536.webp`. Fictional people, visibly labelled AI example, not a customer gallery. Architecture remains visually consistent with the reference; the image is not asserted to be pixel-identical beyond the added people.

Final prompt:

> Use case: compositing. Asset type: clearly labelled AI example in a venue-sales software demonstration. Edit target: the supplied photograph of the entrance hall at Knotting Hill Place, used with permission. Add one fictional adult couple standing together on the marble floor in the middle foreground, naturally facing one another, holding hands, full length, elegant but relaxed. One person in a beautifully tailored black dinner suit, one in a minimal ivory silk wedding dress with a light flowing train, both around age 30, warm natural expressions, realistic skin and hands, documentary editorial wedding photography. Their size must be correct for the doorway and ceiling. Match the daylight, shadows and marble reflections exactly. Preserve the photograph's entire architecture, camera position, framing, balcony ironwork, fireplace, candles, staircase and glass doors, without redesigning, removing, cropping or moving anything. No new furniture or flowers, no additional people, no extra words, no logo, no watermark. This should look like a restrained high-end photograph of real people in the actual supplied space, not a fantasy illustration. Landscape 3:2 composition identical to source.

## Dusk exterior lighting treatment

Mode: built-in OpenAI image edit; source is the licensed exterior photograph above. Visually reviewed for facade, fountain, roof, windows and composition. This is a lighting visualization, not an actual dusk photograph; the original is available via the scene selector. Public files: `brand/khp-dusk-1536.webp` (344106 bytes) and `brand/khp-dusk-800.webp` (97278 bytes), Sharp WebP quality 85. Source generation: `exec-1f407f1d-d9a9-4d78-8ab5-9a4115fdc830.png`.

Final prompt:

> Use case: lighting-weather. Edit target: the supplied licensed photograph of Knotting Hill Place. Create a cinematic architectural dusk lighting visualization for a full-bleed venue software website. Change only time of day, lighting, sky and color atmosphere. Preserve the exact building, fountain, windows, stonework, towers, roof geometry, lawn, stairs, camera position and composition. Rich violet-blue twilight sky with soft peach horizon, warm amber illumination glowing from existing windows and subtle warm architectural lighting grazing the stone. Fountain water catches the amber light. Deep natural emerald lawn, realistic dark slate roof, extraordinary but believable architectural photography, detailed stone and water, subtle atmospheric depth. A premium warm-versus-cool cinema grade, no grey washed-out look, no neon lights, no purple-painted building, no fantasy architecture. Keep facade bright enough to see every detail. No people, no vehicles, no new objects, no new signage or text, no logos, no added towers or windows. Keep source framing, landscape 3:2. The output should feel like an actual beautiful twilight architectural photograph, not an illustration or a computer game.

## Premium video — pending access

Higgsfield balance was zero; no paid generation or trial activation was submitted there. Sora model lookup returned a catalog entry but actual generation returned HTTP 404; official OpenAI documentation confirms its API retired on 2026-09-24. No Sora output exists.

The existing Google connection exposes Gemini Omni 1.2 Flash. One image-to-video request returned HTTP 402. The user is enabling that connection. `scripts/media/generate-venue-film.mjs` is an authoring-only helper using the documented Interactions API; it reads the key from process environment, never logs it, and refuses to overwrite an output. No premium video is yet enabled on the landing page.

Planned shot: eight seconds, 16:9, 1080p delivered resolution (the provider's upscaled tier, not claimed native). One slow lateral architectural dolly, natural fountain water, exact facade preserved, no people, text, invented architecture or morphing. Final prompt and validated output details must be recorded here after successful generation.
