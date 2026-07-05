# Design notes

Working log of deliberate design decisions, effects killed, and directions tried.
Future passes: read this first, build on it, and append — don't repeat.

## 2026-07-05 — Venue landing page rebuild (`/`)

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
