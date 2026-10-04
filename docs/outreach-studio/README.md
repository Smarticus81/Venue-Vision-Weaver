# Outreach email studio

Prospect emails are built, reviewed, and sent from the control plane's
Outreach tab (`/control#outreach`). The pipeline, in order:

1. **Research** (`artifacts/api-server/src/control-plane/outreach/venueResearch.ts`):
   fetch the prospect's own public website (homepage plus up to three
   wedding/venue/gallery subpages, SSRF-guarded, size- and time-capped), pull
   facts the copy may truthfully use (name, location, named spaces, style,
   public capacity — heuristics, optionally tightened by Grok but only with
   claims present in the page text), and discover photos (og:image, hero,
   gallery, JSON-LD, background images). Photos are downloaded, sized with
   sharp (1200px wide JPEG for retina at 600px), de-duplicated, scored, and
   stored in the public bucket under `outreach/<prospectId>/` with the exact
   source URL and page recorded. The top three are preselected; up to six are
   kept so operators can swap. No usable photo → `no_images`, a flag for the
   operator, and a text-only note.
2. **Copy** (`copywriter.ts`): Grok writes as a real person at Dreemer. The
   validator enforces two subject options ≤ 50 characters, 35–120 words, a
   real space named, no hype/jargon, no statistics or prices, one ask. Two
   attempts, then a deterministic fallback built from the same facts.
3. **Template** (`emailTemplate.ts`): 600px table layout, fluid on mobile,
   light and dark (`prefers-color-scheme` + Outlook `[data-ogsc]`), MSO
   conditionals, alt text and photo credits, plain-text twin, physical
   address footer, unsubscribe link, and `List-Unsubscribe` +
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Brand tokens
   come from `lib/brand`.
4. **Approval**: `draft_outreach_email` (agent tool) or “Draft email” in
   Pipeline creates a `control_outreach_emails` row and proposes the high-risk
   `send_outreach_email` action. Operators edit, swap photos, regenerate, and
   approve or reject in Outreach; approval executes the action.
5. **Send** (`sender.ts`): the only delivery path. It re-checks that the
   action is approved, the prospect is contactable (status, lifetime cap,
   contact gap, not an existing customer), the address is not suppressed, and
   the daily cap holds, then sends through Resend and snapshots the exact
   HTML/text.
6. **After send**: `/api/outreach/unsubscribe/:token` (confirm page +
   one-click POST) writes `control_email_suppressions` and locks the
   prospect; `/api/webhooks/resend` records delivered/bounced/complained and
   suppresses bounces and complaints.

## Samples

`pnpm run outreach:demo -- --out docs/outreach-studio/samples --site <url> …`
runs steps 1–3 against real venue sites with no database, storage, or mail
provider, then `pnpm run outreach:screenshots docs/outreach-studio/samples`
captures desktop/mobile × light/dark with headless Chrome. The
`Outreach studio samples` GitHub workflow does both and commits the result,
because the authoring sandbox cannot reach public venue sites.
`local-fixture/` holds the same pipeline run against an offline fixture site
plus the `/control` review screen from the UI fixture harness.
