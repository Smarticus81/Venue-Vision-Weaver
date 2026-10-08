# Design notes

Working log of deliberate design decisions, effects killed, and directions tried.
Future passes: read this first, build on it, and append — don't repeat.

## 2026-10-08 (eighteenth pass) — Owner acquisition funnel: `/`, `/pricing`, `/privacy`, `/claim/:token`

**Conversion spine:** this page exists to get a wedding-venue owner or sales
manager to create a venue account and run their first gallery this week,
because a couple who sees themselves married at the venue before they tour
the next one is more likely to book, and the venue can finally see which
toured couples opened, shared, clicked for a date, and booked.

**Signature moment:** *the room, then the couple in the room.* The hero is
one diptych (`/brand/hero-{800,1200,1400}.webp`, 74 KB at 800w): the empty
orangery on the left, the couple in it on the right. It ships **static**. The
spec's reveal handle (one composition, `clip-path` driven by a range input)
needs a same-angle before/after pair, and none exists among the committed
assets; decision E11 forbids external generation this session, so the reveal
slipped. Fallback per spec 3.2: single hero figure, and the two halves of the
diptych as a 2-up in the compare section with no handle. The reveal stays
the required deliverable for the next pass that has a paired asset. The ROI
readout ("Do the math for your venue") is the page's only live element: three
inputs the venue already knows, bookings and money out, defaults labelled as
placeholders, the +3-point lift labelled as an assumption.

**Layout (one sentence):** an editorial two-column page where the left column
argues in short declarative sentences and the right column shows the product,
collapsing to one column at 760px with the product frame first; prices and
proof sit above the plan cards.

**Narrative order:** hero → value strip (your rooms, their faces, your date
link, you see who booked) → proof (partner mode: "Numbers, not adjectives"
plus the founding-venue offer from config, the four sample frames labelled
"Example gallery, AI preview") → how it works (ink band, tour-day first) →
ROI → pricing cards from the public config with the "Launch prices" pill →
compare (2-up + a plain table, no competitor names) → FAQ (native
`details`) → final ask.

**Prices, proof and copy are data, not strings:** every figure comes from
`<meta name="dreemer-public-config">` (server-injected) → `GET /api/public/config`
→ defaults (`lib/publicConfig.ts`). Proof flips to three real figures when the
server reports `proof.mode = "aggregate"`. Nothing on the page states a number
we did not get from config or from the visitor's own inputs.

**Coral budget:** one coral button per viewport. The header's Start free is
now **ink**, so the hero button is the single coral action above the fold;
Growth is the only coral card button; the final ask is coral. Eyebrows and the
hero `em` stay `coral.700`.

**Performance:** the landing route is in the main chunk (no "Opening Dreemer"
fallback); framer-motion's `MotionConfig` moved behind the lazy product
routes, which took 41 KB gzipped off the landing path. Fonts are self-hosted
latin subsets of the Outfit and Figtree variable faces (`public/fonts`,
preloaded, `font-display: swap`), replacing the render-blocking Google Fonts
stylesheet. The hero `<img>` carries srcset/sizes, width/height and
`fetchpriority="high"`; the box takes the image's own ratio so the diptych is
never cropped. Still in the critical path and not this pass's file:
`@clerk/clerk-react` from `main.tsx` (~100 KB gz) — flagged for WS-F/WS-I.

**Responsive:** screenshotted the built pages at 360, 768 and 1440 with
headless Chromium; no horizontal overflow on any of the four routes. Below
480px the two header anchors hide (logo, Sign in, Start free on one line), the
compare table stacks into per-row blocks that name their column, the hero
`<br>` drops. Reduced motion: no JS motion on these routes; the global rule
now keeps `.animate-spin` turning slowly instead of freezing it (the text
half of that fix, a `role=status` line, belongs to the dashboard pass).

**Tracking:** `lib/track.ts` posts funnel events to `POST /api/events` with
the browser's first touch (claim token > utm > ref > referrer > direct) so a
signup can be attributed to an outreach email. `landing_view` once per tab
per page; `cta_click` with a placement on every Start free.

**Kills:** the dashed "reserved for proof" placeholder slots; the hard-coded
plan cards without prices; the Google Fonts link; the `For couples` nav link
and the footer "Find my gallery" (the couple utility stays linked from the
footer as "Couples: find your gallery"); the pricing "prices lock for twelve
months" sentence (a policy no decision has confirmed; see open questions).

**Not done / next:** the paired reveal asset; a measured LCP on a deployed
URL (the server-side preload for `/` must point at `/brand/hero-800.webp`
with the srcset, not the spec's `hero-couple.webp`); the venue's own name in
the value strip's date-link copy once a personalised landing exists.

## 2026-10-03 (seventeenth pass) — Dreemer rebrand

Full rebrand from the old name to **Dreemer** (dreemer.co). Brief: coral
mark, ink wordmark, ivory ground; business-tool feel; venue-owner copy with
one value — more tours turn into booked dates.

**Direction (one line):** warm ivory paper, ink type, one coral action.
Geometric everything: the constructed wordmark, Outfit for display, Figtree
for body, 8/12/20px radii, squircle mark.

**Tokens:** one shared module, `lib/brand` (`BRAND.md` documents it). The web
app maps `--dm-*` into Tailwind in `index.css`; the API server imports the
same module for emails, the reel title card and the QA page. Contrast is
asserted by tests (39 pairs), not eyeballed: coral as text is `coral.700`,
never `coral.500` (2.2:1 on ivory); primary buttons are ink-on-coral
(7:1), never white-on-coral (2.7:1); the focus ring is `coral.700`
because `coral.500` fails 3:1 on ivory.

**Logo:** traced from the Midjourney render (kept at
`lib/brand/assets/logo/dreemer-logo-midjourney.png`): the left lobe of a
soft coral heart with a straight notch edge and point, a hairline that
outlines the missing right lobe, and a two-stroke spark at its peak. The
wordmark is a constructed monoline geometric lowercase (circles and stems,
stroke 22) matched to the render's weight and spacing. All variants (icon /
wordmark / lockup × color / ink / reversed), favicons, app icons and the OG
card are generated from one geometry file; the React logo reads the same
paths. The 16–32px tile swaps the hairline and spark for a solid star
because the strokes vanish at that size.

**Landing (`/`):** spine unchanged (venue owner → create account), copy
rewritten plain: "Turn tours into bookings." → how it works in four steps on
an ink band → sample gallery → **proof placeholders** (two dashed slots:
"Reserved for a venue quote", "Reserved for booking numbers") → plans
without invented prices → one closing CTA. Kills: the "a little…" /
"possibility" / "imagine" vocabulary, the serif display face, the olive
palette, the ↗ arrow CTAs, italic emphasis in headlines.

**Product screens:** no layout changes; colors, type and radii re-tokenised.
Dashboard status pills now use success/warning/danger roles instead of
Tailwind emerald/red; the control plane dropped the undefined `rose`/`grain`
classes (they were never defined in CSS) for the same roles. Owner-facing
copy de-jargoned ("Create gallery", "In progress", "Couple").

**Emails:** ivory body, card on `ivory.50`, lockup PNG header, coral button
with ink text, sea links, "Dreemer · Turn tours into bookings." footer.

**Deliberate leftovers:** the Supabase bucket defaults keep the old name
(live data). Listed with migration paths in `BRAND.md`.

**Not done / next:** real proof in the two slots; plan prices once set;
the original logo render for a side-by-side check; a dark theme (tokens
already carry the ink roles).

Merge note: the outreach email studio (below) landed on `main` in parallel
with its own flat brand constants (`BRAND`, `BRAND_COLORS`, `BRAND_TYPE`,
`BRAND_EMAIL`, `brandMarkSvg`). Those names now live in
`lib/brand/src/email.ts`, derived from the same tokens, and the studio tab,
its shared console components, and the outreach email template were mapped
onto the token classes during the merge.

## 2026-10-03 (seventeenth pass) — Outreach email studio

**Conversion spine:** this email exists to get one venue owner to reply for a
free preview (or a short call), because a personal note that shows their own
spaces earns a reply where a newsletter earns a delete.

**Direction (one line):** a handwritten note with photographs clipped to it —
the venue's own photos are the centerpiece, Dreemer is a small signature
(viewfinder mark + lowercase wordmark, muted), copy in plain words under 120
words with one ask. Tokens come from the new shared module `lib/brand`
(garden palette: canvas #faf9f5, ink #24332c, accent #325747; dark set tuned
for Gmail/Apple Mail/Outlook forced dark).

**Decisions & kills:**

- Hand-built table HTML instead of React Email/MJML. Same output class
  (600px fluid container, MSO conditionals, `role="presentation"`,
  `prefers-color-scheme` + `[data-ogsc]` dark rules), zero runtime
  dependencies in the API bundle, and the renderer is unit-tested with
  node:test. Swapping to React Email later is contained to one file.
- Hero photo first, then words; the second and third photos sit after the
  first paragraph as a two-up (stacks on mobile). More than three photos
  killed — it reads as a catalog.
- Every photo carries a one-line credit ("Photo: venue.com") — honest about
  provenance and it signals "I looked at your site" better than saying so.
- No logo header, no color bands, no social icons, no "View in browser".
  Footer is three lines: why you got this + unsubscribe, physical address,
  dreemer.co.
- Button is the only accent fill on the page; links in the body are killed so
  the one ask stays the apex.
- Preheader = the first sentence of the body, not a tagline.
- Copy guardrails are code, not vibes: 2 subjects ≤ 50 chars, 35–120 words,
  must name a real space from the site, banned-phrase list (hype/jargon),
  no percentages/multipliers/prices, no bullets, max one exclamation.
- Review screen in `/control` → Outreach: the real rendering in an iframe at
  desktop/mobile widths with a light/dark toggle (dark = the template's dark
  rules forced on, which is what a dark-mode client applies), plain-text view,
  the exact List-Unsubscribe headers, photo picker with source links, facts
  panel with the pages consulted. Approve is disabled while edits are unsaved
  so what the operator sees is what sends.

**Not done / next passes:**

- Operator sample preview (an example couple in the venue) is a stubbed hook.
- Real-venue screenshots come from the `Outreach studio samples` GitHub
  workflow because the sandbox cannot reach public venue sites.
- Pre-existing: the control console still references `text-rose`/`mono-label`
  utilities that no longer exist in `index.css`; the studio tab reuses them for
  consistency rather than fixing the console theme in this pass.

## 2026-10-02 (sixteenth pass) — Dashboard de-clutter (visual only)

Owner brief after a full review: make the owner dashboard cleaner and
sleeker, visual changes only — no behavior, data flow, or route changes.
Rendered before/after at 1440/390 via the qa fixture harness; copy-link,
QR, delete dialog, billing CTAs and uploads smoke-checked with Playwright.

- **One header pattern per section:** h2 (text-2xl) + one short muted
  line. All per-section uppercase eyebrows ("Deliveries", "New couple",
  "Coverage", "Library", "Settings", "Organization billing") killed —
  the sidebar already names the view; the uppercase noise fought the
  metric labels and form labels that legitimately use the eyebrow style.
- **Overview reduced to venue name + readiness pill + metrics.** The
  "Venue dashboard" eyebrow and "Create, review, and share a more
  personal follow-up." subtitle dropped. Metric "Approved" → "Ready"
  (matches the status badge vocabulary).
- **Top bar:** "Workspace" label, divider, and member email dropped
  (the email had crept back after being killed in pass fifteen); org
  name only.
- **Re-killed "Owner approval enabled"** (resurrected since pass 15)
  and the "Venue setup needed" twin — the overview pill already carries
  readiness on every tab.
- **Create a gallery:** description de-jargoned ("photoreal,
  venue-branded preview" gone); the three-numbered-facts strip replaced
  by one caption: "One credit per gallery · You preview everything
  before it's sent".
- **Billing:** "Plan 01 / Plan 02 / Top-up" kickers killed; section
  retitled "Plan & credits"; summary figures a step smaller; footnote
  sentence-cased ("Billing is handled securely by Stripe …"). Plan
  descriptions cut to one line each. No prices invented — still the
  open item from the review.
- **Galleries:** Delete is now an icon-only quiet button (aria-label +
  testid kept; existing CSS already guarantees 44px for
  `aria-label^="Delete"`). Settings retitled "Venue details" to match
  the nav, with one line of purpose ("Shown to couples on their
  gallery page.").

Left alone deliberately: CoupleLinkCard (already the strongest element
on the page), the mobile workspace-view select, StatusBadge, all
testids, handlers, API calls, and ControlPlanePage (owned by PR #45).

## 2026-09-03 (fifteenth pass) — Product screens: dashboard, share page, couple flow

Autonomous observe → diagnose → fix → render loop over the app surfaces
(the landing pages were left as the owner set them). Everything was
rendered headlessly at 390 / 820 / 1440 with a mock API and a Clerk stub;
functional and accessibility checks ran as a Playwright script (dialog
focus trap and return, radio arrow keys, lightbox keys, tab-stop focus
rings, 36px+ touch targets, overflow measurement).

**Dashboard (owner)** — the product's hand-off was missing: nothing on the
dashboard showed the couple link. Now the top of the page is the venue
name, readiness, three figures (credits / ready / developing) and a
**couple-link card with a QR code** (Copy, Open, QR as PNG; `qrcode`
loaded lazily). Sections reordered to the owner's real loop: galleries →
venue photos → details + billing. The five-view coverage checklist and the
photo library are one grid: missing views render as dashed upload targets
pre-tagged with that coverage. "New gallery" opens the intake inline.
Deletes confirm in a Radix dialog (focus handed back to the trash button
on close, since it opens programmatically). Per-row actions are quiet
outlines so the accent stays with the page's real CTAs; "Email couple"
flips to a green "Sent" for a few seconds. Long names/emails wrap
(`min-w-0`, `break-words`/`break-all`) — the old grid overflowed to 538px
on a 390px phone. Loading is a layout-mirroring skeleton, not a spinner.
Status vocabulary is one component (`StatusPill`: Ready / Developing /
Queued / Failed).

**Share page (couple + venue conversion)** — the fixed bottom share
toolbar sat on top of the venue's "Book a tour" card at every width;
killed. Order is now: reel hero with the names (brand `.drape` reveal) →
the venue's ask (one rose CTA) → Copy / Share / Email as a quiet row →
four stills → reel download. Stills open a lightbox (arrow keys, Escape,
download, focus return) instead of duplicating the selected still below
the grid. Landscape reels are cropped on phones (orientation read from
`loadedmetadata`); portrait reels still letterbox. The small states
(missing, failed, legacy, processing) share one layout with a logo header;
processing shows a three-stage list instead of a spinning ornament.
404s render immediately — React Query no longer retries a 404 for ~7s
before showing "not found" (same fix on the couple venue page).

**Couple flow** — the three photo roles are the upload targets (guidance,
action and preview in one tile) instead of three info cards + a drop zone
+ a preview grid. Style picker uses native radios in labels (arrow keys
work). Email and names sit in one form row; the delivery blurb is one line
under the submit. Shared step header with a 3-segment progress bar.

**Cross-page** — one radius for controls (the `Button` primitive's
`rounded-md`; tiles and photos stay square), 404 / not-found / not-ready /
failed pages on one centered layout with the logo, the old shell wrapper deleted
(unused), header email dropped, alert icons dropped from state pages.

Killed: whole-page fade on the dashboard main (a paused animation left the
page blank in capture — content must paint without JS), the processing
page's spinning rings, "Interactive preview" / "Owner approval enabled"
labels, the numbered 001–006 section eyebrows.

## 2026-08-22 (fourteenth pass) — Stable looping hero, scrub killed

Owner supplied the hero film again (byte-identical to the existing
`/brand/hero.mp4`) with the direction: no scroll effect — just a nice
stable looping background; remove the other video.

- **`CinematicHero` deleted, `VideoHero` in its place:** one 100svh
  section, `/brand/hero.mp4` autoplay/muted/loop/playsinline behind the
  editorial lockup, poster = `/brand/hero-atmosphere.webp` so first
  paint never waits on the video. No 450vh pin, no scroll→currentTime
  timeline, no rAF scrub loop, no final "Make the tour unforgettable"
  lockup, no scroll cue — the page scrolls normally past the hero.
- Copy is the full opening lockup (headline, lede incl. the
  portraits-and-reel sentence from the reduced-motion variant, CTA,
  sign-in, credits line) with the same veil gradient and text-shadows.
- **Reduced motion:** identical layout, poster still instead of the
  playing video.
- **Media removed:** all the old transformation media files
  (original + web mp4/webm derivatives + poster/final stills, ~19MB).
- **Media added:** `/brand/hero.webm` (VP9 crf34, no audio, 2.0MB)
  listed before the mp4 — Chromium builds without licensed H.264
  (incl. the test sandbox) decode only VP9; mp4 stays the Safari path.
- Verified in-browser: webm source selected, playing/looping (t=5.3s →
  8.9s across a 10s loop), copy legible over the veil, scroll exits the
  hero normally into the follow-up sections.

## 2026-08-17 (thirteenth pass) — The transformation hero

Owner supplied an 8s portrait film (couple tours the undecorated venue
in day clothes → dissolve ~3.0–4.5s → full candlelit wedding with
guests) and a detailed brief: this becomes the scroll-scrubbed
cinematic hero; the mountain concept is abandoned entirely.

- **Removed the whole mountain arc:** FlightBackdrop, DescentJourney,
  journey.ts, MoodDial, moods.ts, and all descent-* media. The mood
  system is gone with it — data-mood pinned to "candlelit" so the
  accent tokens hold. Nav loses "The descent".
- **New `CinematicHero`:** 450vh section, sticky 100svh viewport,
  full-bleed cover video (portrait source, object-position 50% 42%).
  Scroll drives a piecewise timeline with holds: 0–8% first frame,
  8–42% the walk (→0.36), 42–74% the transformation dissolve
  (→0.60, widest scroll band), 74–92% into the wedding, 92–100%
  hold the finale. RAF loop (IO-gated) eases currentTime toward the
  scroll target (0.12/frame); zero React re-renders during scrub
  (MotionValue opacities for copy; one state flip at 0.86 for CTA
  pointer-events).
- **Copy choreography:** opening editorial lockup bottom-left ("Turn
  tours into bookings." / "Let couples see themselves here." / CTA)
  fades by 48%; final lockup ("Make the tour unforgettable." + "See
  how it works →") settles in from 86%; scroll cue dies at 6%.
  Light text-shadows only — no panels, no heavy scrims; the veil is
  the brief's 0.16/0.02/0.14 gradient.
- **Media:** original kept as the old transformation media mp4;
  web derivatives per the brief's recipe (H.264 crf17 g12 faststart
  7.9MB + VP9 crf30 g12 5.5MB for Chrome/Firefox — sandbox Chromium
  decodes only VP9), poster + final-frame stills (webp q88).
  Muted/playsinline/preload=auto, play-then-pause prime for iOS frame
  rendering.
- **Reduced motion:** no 450vh — a 100svh hero on the completed-wedding
  still with all copy/CTAs present.
- Verified in-browser: scrub lands 0.03s→1.84→3.81→4.52→6.68→7.91s at
  the mapped scroll points, reverse scroll returns exactly, desktop +
  mobile shots at every phase, later sections sit on the solid #0d0b09
  base. Final lockup moved bottom-left after the centered version
  covered the couple.

## 2026-08-17 (twelfth pass) — Kill the low-poly ceremony

Owner verdict on the WebGL ceremony at the threshold: "if that is here
it's a failure" — the stylized low-poly world clashed with the
photoreal footage. Removed entirely; the footage is the only scene.

- `ceremonyScene.ts` deleted; `three` + `@types/three` dropped from the
  package (the whole 3D chunk is gone from the bundle).
- The descent no longer crossfades to a canvas at the threshold — the
  film simply holds its final candlelit-altar frame. Chapters, the
  elevation/cam HUD, the progress rail, and the scroll cue all remain.
- With the 3D world gone, the Aisle/Altar/Aerial presets, orbit, and
  the arrival control bar are gone too. The mood dial remains in the
  hero only, as the accent-system control.
- Reduced motion now shows a real still of the altar
  (`descent-altar.webp`, extracted from the last frame) instead of the
  3D panel.
- Nav label "The ceremony" → "The descent" (same `#ceremony` anchor).

## 2026-08-17 (eleventh pass) — The footage IS the page

Owner directive: no remnants of the old backdrop anywhere; the flight
video must be the true full-bleed background with the interface over
it, photorealism untouched.

- Killed the entire old background stack: `.lp-sky` mood gradients,
  `.lp-vignette`, and the hero particle scene (`venueScene.ts` +
  `SceneCanvas.tsx` deleted). The only remaining flat color is a
  `#070b14` base that exists solely for the instant before the poster
  paints.
- New `FlightBackdrop`: `position:fixed; inset:0; object-fit:cover`
  video behind everything (`z-0`, content `z-10`), scrubbed by GLOBAL
  scroll — video time maps from page top to 90% through
  `#descent-track`, so: hero = night sky, problem/gallery = ridge and
  landscape drifting by, descent chapters = the approach, post-descent
  sections = the held candlelit-altar frame. Poster =
  `descent-flight-poster.webp` (real frame 0, 1280w). Reduced motion
  renders that frame as a static full-bleed image.
- The descent's WebGL ceremony now crossfades IN (progress 0.8→0.93)
  above the footage instead of the footage fading out inside the
  section — same arrival handoff, but the film is the page background
  everywhere, edge to edge.
- No scrims added: the footage is dark enough that porcelain type and
  the existing ink-glass chapter cards carry legibility on their own.
- Mood-dial scope note: with the gradients gone, moods now re-light the
  ceremony scene + accent system only (the footage is fixed night —
  matches the default candlelit read).

## 2026-08-17 (tenth pass) — Real flight footage, scrubbed by scroll

Owner supplied an 8s aerial video (night ridge → candlelit hilltop
altar with string lights) that mirrors the descent narrative. It now
carries the flight:

- Encoded for scrubbing per the doctrine: all-keyframe (`-g 1`), muted,
  1280w — `descent-flight.webm` (VP9, ~2.4MB) + `descent-flight.mp4`
  (H.264, ~2.1MB) dual sources. Sandbox Chromium has no H.264 decoder
  (canPlayType returned "" — how the missing-video bug was found), so
  webm leads and mp4 covers Safari.
- The video sits between the WebGL canvas and the HUD in the sticky
  viewport; a rAF loop lerps `currentTime` toward scroll progress
  (mapped over the first 90% of the journey) and only runs while the
  section is on screen. Opacity dissolves 1→0 over progress 0.82–0.94,
  so the film hands off to the live, re-lightable WebGL ceremony right
  at the arrival unlock — "the film becomes live."
- Reduced motion: video not mounted at all (static WebGL panel stands).
- The WebGL world remains the arrival/explore surface and the moods
  still re-light it; the footage is fixed night, which matches the
  default candlelit approach.

## 2026-08-17 (ninth pass) — The descent

Owner supplied a second prototype ("The Mountain Threshold"): a
scroll-driven aerial flight — fixed canvas, 500vh scroll, waypoint
camera descending from 12,400 FT through clouds to the altar, chapter
cards, elevation/cam HUD, progress rail. Integrated as the evolution of
the `#ceremony` section.

- The ceremony section is now a 480vh sticky journey: scroll flies the
  camera through four smoothstep waypoints (aerial → mist → valley →
  altar) with double-lerp smoothing. At `ARRIVAL_THRESHOLD` (0.94) the
  scene hands off to explore mode — orbit, Aisle/Altar/Aerial presets,
  and the compact mood dial fade in. Scrolling back up re-takes the
  camera.
- Scene additions: 18 drifting cloud clusters (mood-tinted + opacity
  lerped), the mountain ring widened to 12 peaks on a 90–120u arc so
  the aerial approach has scenery, ground plane 300u.
- HUD: live-interpolated elevation readout (12,400→9,800 FT) and cam
  state, rendered from MotionValues so scroll doesn't re-render React;
  chapter cards crossfade at fixed progress ranges; accent progress
  rail right.
- `journey.ts` is three-free (page reads labels, scene builds vectors).
  MoodDial extracted to its own module (hero + arrival bar share it).
- Reduced motion: no tall scroll — static altar panel with presets,
  dial, and the four chapters as a text grid.
- Fixes found via screenshots: chapter card was shrink-to-fit (one word
  per line) → explicit `w-[min(26rem,82vw)]`; final HUD stage never
  read "Altar threshold" → last waypoint reached at the arrival
  threshold.

## 2026-08-17 (eighth pass) — The explorable ceremony

Owner supplied a standalone three.js prototype (daylight mountain
wedding ceremony: deck stage + aisle, folding chairs with blankets,
autumn floral arc, pines/aspens, displaced-cone mountains, OrbitControls
+ camera preset buttons). Integrated it as a new `#ceremony` section
("Stand where they'll stand.") between the gallery and how-it-works.

- `venue-landing/ceremonyScene.ts`: the prototype's world, re-built to
  the page's craft bar — florals instanced per material, plank seams
  clamped to the semicircle stage, ACES tone mapping, shadows off +
  DPR 1.5 on mobile.
- Art-directed into the mood system: full lighting rig (bg/fog, ambient,
  hemi, sun pos/color) lerps per mood, plus flickering candle sprites
  along the aisle and arch (full in candlelit, off in golden, dim in
  moonlit). A compact mood dial sits in the section header, wired to the
  same page-level state as the hero dial.
- Views: Aisle / Altar / Aerial with eased 1.1s camera flights. Altar
  re-aimed vs the prototype (its numbers put the camera inside the
  floral arc) — now stands at the arch looking back down the aisle.
- UX discipline: three-per-section lazy import via IntersectionObserver
  (rootMargin 260px), RAF paused when the panel scrolls away or the tab
  hides, orbit is desktop-only (touch keeps one-finger page scroll;
  presets drive the camera), autoRotate 0.25 until first drag,
  reduced-motion renders static frames with jump-cut presets.
- Lighting brightened ~1.4x over first pass after screenshots — night
  moods were murky silhouettes at the prototype's intensities.

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
literally what the product does for couples. The reference video's "theme /
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
  "Frames from sample galleries" under the contact sheet. Future fix:
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

**Logo:** the old bold-sans wordmark with gold period is gone. New mark:
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
