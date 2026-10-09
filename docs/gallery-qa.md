# Dreemer Gallery QA

Use the gallery QA harness before calling a model/prompt change production-ready. It runs the same production gallery renderer used by real sessions:

- 4 gallery scenes
- all 2-3 couple references in each generation
- scene-selected venue references from the venue upload set
- OpenAI gpt-image-2.5 image generation (Gemini fallback)
- automated quality gate for aggregate likeness, per-partner likeness, distinct partner identity preservation, venue preservation, exactly-two-partner checks, face visibility, text artifacts, extra people, and composition
- adaptive frame retries that feed quality-gate failure reasons back into the next prompt
- judge retries kept separate from render attempts: a judge outage or malformed verdict is retried on the same frame and never buys another render
- blocked content stops a scene after one attempt (the same photos would be blocked again)
- branded still polish
- branded motion reel: portrait and 4:3 stills are letterboxed over a blurred copy of themselves (never cropped), and the title card letters the venue name as paths

## Inputs

Prepare two folders:

```text
samples/couple/
  01-together-face-forward.jpg
  02-partner-a-clear-face.jpg
  03-partner-b-clear-face.jpg

samples/venue/
  01-exterior-facade.jpg
  02-ceremony-space.jpg
  03-reception-space.jpg
  04-architectural-detail.jpg
  05-natural-light-view.jpg
```

Couple inputs must be 2-3 clear, well-lit images. For best likeness, use this order when possible: photo 1 both partners together, photo 2 Partner A face-forward, and photo 3 Partner B face-forward. Venue inputs must include at least 5 images covering exterior/facade, ceremony, reception, architectural detail, and natural-light views. The harness applies the same production reference validation as live sessions: JPG/PNG/WebP images must be at least 256px on each side, sufficiently bright, sufficiently sharp, and couple references must not be near-duplicates. Live venue profiles store explicit coverage metadata for each uploaded photo; the local QA harness uses the filename/order convention above to mirror those coverage slots.

## Command

```bash
pnpm run gallery:qa -- --couple ./samples/couple --venue ./samples/venue --out ./qa-output/live-gallery --style cinematic-editorial --venue-name "Willow & Stone"
```

For production-gated QA, include `--consent-confirmed`. This records in
`quality-report.json` that the couple and venue references are authorized for
the QA run. The harness allows omitting this flag only with `--allow-nonpassing`
for local plumbing checks.

The same report records SHA-256 fingerprints for every couple and venue
reference. Agentic reviewers and the production verifier use those hashes to
confirm the QA evidence refers to the exact consented images that were reviewed.

Required environment:

```bash
OPENAI_API_KEY=...
IMAGE_MODEL=gpt-image-2.5-sunburst
IMAGE_FALLBACK_MODELS=gpt-image-2.5-flare,gemini-3-pro-image
OPENAI_IMAGE_QUALITY=high
GOOGLE_AI_API_KEY=...
GEMINI_IMAGE_SIZE=2K
GENERATED_IMAGE_MIN_CONTRAST=8
GENERATED_IMAGE_MIN_SHARPNESS=6
GALLERY_FRAME_ATTEMPTS=4
GEMINI_QUALITY_MODEL=gemini-2.5-pro
GALLERY_QUALITY_GATE=on
GALLERY_MIN_LIKENESS_SCORE=0.82
GALLERY_MIN_PARTNER_LIKENESS_SCORE=0.78
GALLERY_MIN_VENUE_SCORE=0.80
GALLERY_MIN_COMPOSITION_SCORE=0.74
```

Production QA should stay on the default chain: gpt-image-2.5-sunburst first,
then gpt-image-2.5-flare, with Gemini 3 Pro Image as the last-resort fallback.
Sunburst is OpenAI's precision image model and is the one to review against,
because it is the model that preserves reference subjects and structures most
faithfully. Renders go to the OpenAI image edits endpoint with
`input_fidelity=high` and up to 16 ordered reference images. Older image
fallbacks can reduce reference capacity and should not be used for production
likeness QA.

Quality steps run low, medium, high, xhigh, max, and auto. Production uses
`high`; cost and latency climb steeply above it, so raise it only for a
deliberate QA comparison and record the setting in the report.

## Output

The output folder contains:

- `01-*.raw.jpg` through `04-*.raw.jpg` - unbranded model outputs
- `01-*.jpg` through `04-*.jpg` - polished gallery stills
- `dreemer-motion-reel.mp4` - branded motion reel
- `quality-report.json` - model settings, input files with SHA-256 fingerprints, automated summary, scene venue refs, attempts, judge scores, each frame's judge status (`passed`, `below_target`, `unjudged`, `gate_off`), whether a fallback model rendered it, and the per-attempt log production stores in `render_attempts`
- `review.html` - contact sheet with references, raw frames, polished frames, scores, used venue refs, and operator checklist

The automated summary is a gate, not final approval. It reports:

- whether all four frames passed the judge
- whether the motion reel was produced
- total attempts and max attempts on any frame
- minimum aggregate likeness, per-partner likeness, venue, and composition scores
- distinct partner identity preservation on every frame
- warnings for missing frames, missing reel, failed generation, failed judge results, frames that shipped below target or unjudged, and frames rendered by a fallback model

## How live sessions differ

The harness renders scenes one after another and keeps its attempt log in the
report. Live sessions use the same renderer with production plumbing around it:

- Scenes render concurrently, bounded by a process-wide render semaphore
  (`GALLERY_RENDER_CONCURRENCY`, default 4); sessions per worker are capped by
  `GALLERY_MAX_CONCURRENT` (default 2).
- Every session ends ready or refunded within `SESSION_DEADLINE_MS` (default
  15 minutes): the deadline aborts in-flight provider calls and ffmpeg, marks the
  session failed and refunds the credit, and a reaper fails anything left in
  processing past the deadline plus one minute.
- When a scene fails, the accepted frames stay stored, so a retry renders only
  the failed scene.
- Every render attempt lands in `render_attempts` (model, fallback, size,
  quality, tokens, latency, judge verdict, outcome). `sessionCostSummary()` in
  `renderTelemetry.ts` turns those rows into measured cost per gallery using the
  optional `RENDER_PRICE_<MODEL>` per-image prices; with no price configured the
  cost is reported as unknown, never estimated.
- A frame rendered by a model other than the primary is flagged
  (`fallback_used`) and audited once per session as `image_model_fallback`. Only
  explicit model-not-found codes, 404, 429, 5xx or no answer before the timeout
  move the chain to the next model; a plain 400 fails loudly instead.
- The couple sees one of a few fixed sentences when a session fails; the raw
  cause goes to `failure_detail` for owners and operators.
- On ready the gallery is emailed to the couple with the venue's "Check your
  date" link, unless the venue turned on review before send, a frame could not
  be judged, or the session is an owner sample.

## Manual Acceptance

Automated scores are a gate, not the final word. Before release, inspect the output and confirm:

- Both couple faces are instantly recognizable in every still.
- The venue is the uploaded venue, not a generic replacement.
- Scale, lighting, shadows, and perspective feel natural.
- There are no extra people, visible text artifacts, logos, watermarks, or warped faces/hands.
- The motion reel is suitable for venue sales follow-up.

If any item fails, tune prompts, reference selection, or thresholds and rerun the harness with the same inputs.

When the manual review passes, save `manual-acceptance.json` beside
`quality-report.json` so the production verifier has auditable launch evidence:

```json
{
  "accepted": true,
  "reviewedBy": "Your Name",
  "reviewedAt": "2026-06-20T00:00:00.000Z",
  "notes": "Both partners are recognizable in all four stills; venue and motion reel approved."
}
```

The production verifier expects the QA report to pass automatically and the
manual acceptance file to be present, and it rejects reports where
`inputs.consentConfirmed` is not `true` or the input references are missing
valid SHA-256 fingerprints, unless `--skip-qa` is used for local plumbing
checks.
