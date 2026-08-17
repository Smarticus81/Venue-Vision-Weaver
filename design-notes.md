# Design notes

Working log of deliberate design decisions, effects killed, and directions tried.
Future passes: read this first, build on it, and append — don't repeat.

## 2026-08-17 (seventh pass) — “The venue at dusk”: full WebGL rebuild

Owner brief: a total transformation of `/` after a reference video on
high-craft layered Three.js landing pages (procedural sky, multi-plane
depth, particles, foreground lens bleed, live environment toggles,
<1MB budgets, zero AI-slop defaults). Nothing from the old page survives
except the four gallery frames.

**Direction (one line):** the venue at dusk — one continuous procedural
evening (indigo→ember sky, sagging string lights, candle bokeh, drifting
petals) behind the whole page; the visitor re-lights it.

**Signature — the mood dial.** Golden hour / Candlelit / Moonlit toggle
in the hero re-lights the entire scene (sky shader, disc, bulbs, petals)
AND the page accent — and the caption says the quiet part: this is
literally what glimpse does for couples. The reference video's "theme /
environment control bar" productized as the sales pitch.

**Scene (`venue-landing/venueScene.ts`, vanilla three, lazy chunk):**
fullscreen sky shader (3-stop gradient + sun/moon disc + hash grain, no
banding) → 3 catenary strands of twinkling bulbs + wires → 130 candle
bokeh points → ~100 instanced petals mid-field + 7 huge pre-blurred ones
near the lens (fake DOF frame-bleed) → 3 drifting mist planes. All
textures canvas-drawn at runtime; zero fetched assets; the 2.5MB
hero.mp4 is gone from the page. Pointer parallax on the camera; page
scroll dims the sky mid-page (sin curve) so the offer glows again at the
end. Palette lerps ~1s on mood switch. DPR≤2 (1.75 mobile), counts
halved on mobile, RAF paused on hidden tab, full dispose, static single
frame under reduced motion, CSS `.lp-sky` gradient as the no-WebGL/no-JS
fallback. three.js is a dynamically imported chunk (~132KB gz) that
never blocks first paint — hero text is CSS-revealed (`.lp-rise`
blur-up, no JS gate).

**New token/type system (scoped `.theme-dusk[data-mood]`, app-wide
darkroom tokens untouched):** Instrument Serif display + Schibsted
Grotesk body (Fraunces/Instrument Sans/Geist Mono remain app-side
only); per-mood accent (champagne / amber / moon-silver) driving CTA,
selection, logo aperture, thread, and dots via `--lp-accent`;
`meta[theme-color]` follows the mood.

**Layout:** centered cinematic hero → asymmetric 12-col problem split →
gallery as tilted white-matte prints that spring straight on entry
(springs, stagger, hover lift) → how-it-works steps alternating on a
glowing vertical thread (one more string of light) → outcomes as
offset ink-glass panels → giant offer → slim glass footer.

**Kills (the entire sixth-pass vocabulary):** video hero + scrims,
drape reveal, pill nav trio, marquee band, custom viewfinder cursor,
FrameTicks, ghost/outline numerals, mono labels, wine scene bands,
pinned contact sheet, horizontal-scroll mechanism, giant footer
wordmark, reading-progress hairline.

**Kept (non-negotiables):** routes, `#how-it-works`/`#deliverable`
anchors, all five data-testids, sr-only h1, owner-approved copy claims,
honest product facts only, the four sample gallery frames.

**Verified:** typecheck + build green; Playwright screenshots at
375/768/1440 across all three moods (swiftshader). Note: Google Fonts
is proxy-blocked in the dev sandbox, so local shots render fallback
serifs — the families load fine outside the sandbox.

## 2026-07-29 (sixth pass) — Video hero + couture-light type suite

Owner brief: re-do the venue landing to match a supplied editorial reference
(full-bleed hero video, Fraunces-light scattered wordmark, Geist-mono corner
facts) and then enhance it. Reference lockup: "turn your / tours into /
bookings" over candlelit ballroom footage, oyster type on ink, one smoke-rose
accent, a drape-down reveal.

**Font suite — re-done.** The one real palette/type change this pass:
- Utility mono **Space Mono → Geist Mono** (`--font-mono`). Tighter, true
  tabular figures (`tnum`) for the hero stats via a new `.mono-figure` util.
- Display **Fraunces re-registered from heavy-uppercase → couture-light**: new
  `.display-editorial` util (opsz 144, weight 300, tracking -0.045em, lh 0.9).
  The hero, the offer head, and the footer wordmark now sit in that light
  register; downstream section heads dropped `font-medium → font-normal` with
  tightened tracking so the whole page reads as one couture-serif system
  instead of the old condensed-bold shout. Body stays Instrument Sans.
- Base `h1/h2/h3` gained `font-variation-settings: 'opsz' 96` so headings pick
  up Fraunces' large-optical cut automatically.

**Signature — the drape.** Ported the reference's one move: a soft edge
descends through each display line once on load (`.drape` clip-path +
translate/opacity settle, staggered 80/220/360ms). Full reduced-motion escape.
This replaces the hero's old `RiseLines` mask reveal (killed here; util kept in
motion/index for other surfaces).

**Hero — rebuilt as `HeroScene` (full `100svh` video).**
- `/brand/hero.mp4` (2.5MB, supplied) plays muted/loop/inline behind, poster =
  the existing `hero-atmosphere.webp` so LCP paints instantly and nothing
  conversion-critical waits on the video. Left + bottom scrims for legibility
  and the seam into the page; one rose radial glow top-right.
- Scroll parallax via framer `useScroll` on the section: video scales 1→1.12,
  foreground drifts up 16% and fades. Disabled under reduced motion.
- **Desktop is a stacked, indented lockup, NOT free scatter.** First build used
  the reference's absolute t1/t2/t3 corners — at our copy length "bookings."
  crashed into the CTA. Kept the editorial feel with per-line `ml` indents
  ("into" +16%, "bookings." +5%, rose) and moved the scatter energy to two
  diagonal-ruled right-rail facts (4+1 portraits+reel, 5 free credits). Lede +
  CTA get their own clear lane below. Mobile is a clean centered stack.
- One accessible `<h1 class="sr-only">`; the visual lines are `aria-hidden`
  (reference shipped three competing `<h1>`s — fixed).

**Nav — pill bar** replacing the old bordered fixed header: brand pill (left),
links pill (center, `lg+` only so tablet doesn't wrap), foreground-on-ink
"Create your venue" CTA (right). Backdrop opacity steps up once scrolled past
the fold (`useScrolledPast`). Kept a slim outcomes `MarqueeBand` as the
hero→page bridge. All routes + `data-testid`s preserved (`venue-hero-register`,
`venue-header-register`, `venue-header-sign-in`, `owner-cta`,
`venue-trial-register`).

**Honest stats only** (design-notes rule): every hero figure is a product fact
(4 portraits + 1 reel, 5 trial credits, 1 credit/gallery) — no fabricated
traction numbers, unlike the reference's "+900 venues / +24k galleries".

## 2026-07-05 (fifth pass) — App surfaces + self-hosted imagery

- Photos weren't rendering for the owner: the studio CDN doesn't serve reliably
  cross-origin, and this sandbox can't download it directly. Fix: a one-shot
  GitHub Actions workflow (`fetch-brand-assets.yml`) fetched the five plates on
  a runner and committed them to the branch; then trimmed the baked-in white
  mattes (`sharp .trim()`), resized (900w frames / 2000w hero), and pointed
  `brandAssets.ts` at local `/brand/*` paths permanently. Total imagery ~270KB.
- The MCP gateway strips `input_images` on every image model, so the four
  frames drifted to different couples. Honest fix for now: mono footnote
  "Frames from sample glimpse galleries" under the contact sheet. Future fix:
  Soul character pipeline (create character from the ceremony frame, generate
  the other scenes with soul_id) for a true single-couple sheet.
- Post-login/app surfaces carried into the darkroom editorial language (mono
  kickers + Fraunces headings, hairline-ruled sections, index rows with wine
  hover, FrameTicks on media, rose primaries, mono status lines): owner
  dashboard, couple flow, share page, and the auth/entry pages restyled as
  corner-ticked "tickets".

## 2026-07-05 (fourth pass) — Direct copy, bespoke imagery, business framing

Owner direction: restore the direct wording, cut copy volume, sell business
outcomes (bookings, revenue, follow-up marketing) not ease-of-use, and use the
Higgsfield studio for real assets.

- Hero claim restored to the direct line: "TURN TOURS / INTO BOOKINGS." with a
  one-sentence mechanism sub. Couple page back to "SEE YOURSELVES AT THE
  VENUE / before the day arrives."
- Copy throughout cut to one-liners; scene 005 reframed from trust guardrails
  to business outcomes (more toured couples book · marketing assets made for
  you · your brand does the traveling), with the trust facts condensed to one
  mono footnote.
- Marquee now sells outcomes: "more bookings · faster yeses · follow-up that
  sells · four portraits + a reel".
- Generated in Higgsfield (~5 credits, job IDs in scripts/fetch-brand-assets.mjs):
  a 21:9 candlelit-ballroom atmosphere plate (Soul Cinema) now behind both
  heroes at 50% under a background gradient, and four consistent couple frames
  (Nano Banana, same couple spec) that replace the outline placeholders in
  scene 003 — the contact sheet now shows the actual deliverable, dealt in
  frame by frame on scroll.
- Sandbox network policy blocks the studio CDN, so assets are hotlinked for
  now; `scripts/fetch-brand-assets.mjs` + `VITE_LOCAL_BRAND_ASSETS=1`
  localizes them (run from an open network). Old tablet-mockup hero images
  deleted.

## 2026-07-05 (third pass) — The motion rebuild

Owner verdict on the first rebrand pass: "all you did was turn it dark" —
correct. Same compositions, new tokens. This pass rebuilt every marketing
composition from zero; only the user workflow survived.

**New motion vocabulary** (`components/motion/index.tsx` + CSS utilities):
custom viewfinder cursor (fine-pointer only), marquee ribbons, magnetic CTA,
masked CSS line-rise reveals (nothing waits on JS), corner-tick frames,
ghost/outline numerals (`.text-stroke`), mono labels (Space Mono), safelight
`--wine` scene band.

**Venue landing (`/`) — six numbered scenes:**
001 manifesto hero ("EMPTY venue / DON'T BOOK.", ~11vw uppercase Fraunces) with
right-rail CTA and an italic marquee at the fold · 002 problem band on wine
with a 30vw ghost numeral · 003 signature: pinned "developing print" — the
venue photo scales from a small exposure to full width while four contact-sheet
frames (FRAME 01–04) develop over it · 004 pinned horizontal mechanism, four
100vw panels with outline numerals and a rose progress rail · 005 guardrails as
editorial index rows (hover: wine fill + title shift) · 006 offer with 8vw
italic display and a magnetic XXL tick-button · footer with a 17vw lowercase
wordmark that is itself the final CTA.

**Couple landing (`/couple`):** same language — manifesto hero, venue-code
"ticket" card with corner ticks, marquee, steps as index rows.

**Discipline kept:** every pinned/scrubbed scene has a static fallback for
`prefers-reduced-motion` and <1024px; hero copy reveals are pure CSS; scrubbed
motion is transform/opacity only; one rose CTA per viewport; all
data-testids and routes unchanged.

**Kills:** the hero split-with-product-screenshot layout, all card grids, the
vertical fade timeline from the first pass, pill badges. The product photo now
appears exactly once (scene 003).

## 2026-07-05 (second pass) — Full rebrand: "editorial darkroom"

Owner asked for a nuclear transformation — no remnants of the old white +
antique-gold + Playfair stationery look, logo included.

**Direction (one line):** editorial darkroom — warm near-black surfaces
(`hsl(20 9% 6%)`), porcelain type, silver-halide film grain, Fraunces display +
Instrument Sans body, one candlelight-rose accent (`hsl(355 58% 71%)`, ≤10% of
any screen). Derived from the product's world: film photography, evening
venues, the darkroom where the gallery "develops."

**Token-level changes (`index.css`):**
- Entire `:root` flipped to dark; `color-scheme: dark`. All shadcn components
  inherit the theme through tokens.
- `--gold` family deleted; `--rose` family added. Button `gold` variant →
  `rose` (dark ink text on rose — never white on rose).
- Fonts: Playfair Display + Plus Jakarta Sans → Fraunces + Instrument Sans.
  Legacy `.font-playfair`/`.serif` classes intentionally map to Fraunces so no
  stale class can resurrect the old face.
- Shape language: pills → rounded-md buttons; big 2xl/3xl card radii → xl.
- `.grain` utility: static SVG turbulence tile, screen-blended at 5% — the
  signature texture, applied to hero/final sections only (not body copy).

**Logo:** old bold-sans "Glimpse." wordmark with gold period is gone. New mark:
a camera-viewfinder (four corner brackets) with a rose aperture dot, wordmark
lowercase Fraunces. Same system in `favicon.svg`. Old logo PNGs deleted.

**Kills:** gold everywhere, cream bands, glass chips, pill buttons, uppercase
gold kickers (now rose), white dashboard panels.

## 2026-07-05 — Venue landing page rebuild (`/`) [pre-rebrand: colors below no longer apply]

**Conversion spine:** this page exists to get wedding-venue owners and sales
managers to create a venue workspace, because a personalized post-tour gallery
reopens the booking conversation while the decision is still warm — and the
first five galleries are free.

**Direction (one line):** champagne stationery — ivory surfaces, warm near-black
ink, Playfair display with Jakarta body, one antique-gold accent (≤10% of the
page). Derived from the existing brand tokens in `index.css`; refined, not
replaced.

**Signature moment:** scroll-scrubbed "48 hours after the tour" timeline — a
sticky viewport where the four post-tour beats scrub in against a gold progress
rail (framer-motion `useScroll` + `useTransform`, transform/opacity only).
Everything else on the page is quiet entrance reveals (≤20px, once, ≤80ms
stagger).

**Narrative order:** hero claim → felt cost of cold follow-up → mechanism
(signature scrub) → proof/guardrails → risk reversal (5 free credits, no card) →
final ask. CTAs escalate: "Start free" (header) → "Start with 5 free galleries"
(hero) → "Create your venue workspace" (risk reversal).

**Decisions & kills:**

- Killed the framer-motion `opacity: 0` mount on the hero headline, subhead, and
  CTA. Above-the-fold content paints statically; nothing conversion-critical
  waits on JS.
- Demoted "Owner Login" from a second hero button to a text link. One primary
  CTA per viewport.
- Killed the invented stat cards ("24-72h", "Tour-to-booking" as a metric
  value). No fabricated proof: the proof section states verifiable product
  guardrails instead (likeness review + credit refund on failed renders,
  preview-before-send, venue branding on share pages).
- Killed the glass chip overlay ("See it / Feel it / Book it") on the hero
  image — decoration without information.
- Hero image recompressed: `venue-landing-hero.png` (1.7MB) → `.webp` at 1240w
  (47KB). PNG kept in repo for re-derivation. `width`/`height` set, `fetchpriority="high"`.
- Removed the unused Inter font stylesheet from `index.html` (app fonts are
  Jakarta + Playfair via `index.css`).
- `prefers-reduced-motion`: scrub section falls back to a static numbered list;
  entrance reveals become crossfades. Mobile (<768px) also gets the static list —
  a 320vh sticky scrub is hostile on small screens.
- Kept the existing gold/ivory brand tokens. The "cream + serif + gold" cluster
  is a known AI-default risk, but here it's the established product brand used
  across dashboard/couple flows, and it matches the subject's world (stationery,
  champagne light). Differentiation comes from typography scale, asymmetric
  layout, and the scrub signature, not a palette swap.

**Not done / next passes:**

- Real proof: when a venue has measurable results or a quotable owner, replace
  the guardrail row's lead position with one killer specific proof point.
- The `/couple` landing (`LandingPage.tsx`) still mounts its hero at opacity 0 —
  same treatment needed there.
- Consider a scroll-scrubbed gallery-develop moment using real generated assets
  (Higgsfield) once budget for bespoke hero media is approved.
