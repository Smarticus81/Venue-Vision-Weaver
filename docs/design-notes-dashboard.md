# Design notes: owner dashboard, signup and tour-day mode (WS-E2)

To be merged into `design-notes.md` by WS-I as the next pass entry.

## Conversion spine

The dashboard exists to get a venue from "signed up" to "first couple gallery sent" in one sitting, then to make the renewal decision obvious: every gallery shows what the couple did with it (sent, viewed, clicked for a date, booked). Booked dates are the unit a venue renews on, so "Mark as booked" is one click on every ready gallery and the count sits in the overview header.

## Signature moment

**Tour-day mode** (`/dashboard/tour/:slug`). The coordinator's phone at the end of a tour: take two photos of the couple, type their email, pick their wedding month, tick that both agreed, and one thumb-reach button starts their gallery before they reach the car park. It is the only screen in the product built for one hand. Sessions are created with `createdVia: "tour_day"`, so the gallery list (and the growth loop) can tell tour-day galleries from link galleries.

## Layout

- Shell: a 232px ivory rail (sections, short count badges, tour-day link) and a content column capped at 1180px. Below 760px the rail becomes a section select at the top; nothing scrolls sideways at 390px (checked with a fixture at 1440 and 390).
- Every section opens with the overview header: venue name and readiness, credits (the one coral number), plan with the trial clock bar, galleries, booked dates.
- One nudge at a time under the header: the booking link while it is missing (it is where "Check your date" lands), else the trial clock in its last three days.
- Home is "Couple galleries": the activation checklist (five photos, booking link, tour card, first gallery, plan) until it is done, the proof strip (galleries, sent, viewed, clicked for a date, booked), the gallery rows, then the couple link with its QR.

## Decisions

- **One coral action per view.** The checklist's next step owns coral on the home tab, so the empty-state "Create a gallery" is outlined. Billing gives coral to the recommended plan only.
- **Prices are never constants.** Plan cards, the upgrade panel and the pack button ("Add 10 credits") read the public config (meta tag, then `GET /public/config`, then launch defaults). Per-gallery cost shows cents ($5.16), not rounded tenths.
- **Plan changes go through the Stripe portal.** A subscribed org sees "Switch plan"; the checkout endpoint's 409 `subscription_exists` url is followed, so no org ever holds two subscriptions.
- **Honest return from Stripe.** Before leaving for checkout we keep a snapshot of plan, credits and period end in sessionStorage. On `?billing=success` the dashboard compares, polls `GET /org` every 3s for 30s, and says "Payment confirmed" only when something changed; otherwise it says Stripe has not confirmed yet.
- **Out of credits is a sale, not an error.** Create a gallery and tour-day mode check spend locally (trial expired, then balance) and show the upgrade panel in place with checkout one click away; a server 402 swaps in the same panel. A Starter org that runs dry is offered a pack and the step up to Growth, never its own plan.
- **Venue photos are five labelled views.** Multi-file drops are spread over the missing views; each queued file has a view picker; uploaded photos can be retagged, replaced and deleted (with confirmation). "Import from website" uses the venue's site; signup passes `?import=1` when a website was given.
- **Failure explains itself.** Failed rows open their detail by default with the owner-only `failureDetail` and the refund note; ready rows show the quality flag when the pipeline marked one below target.
- **Admin-only controls mirror the server** (`orgRole === "org:admin"`): checkout, portal, gallery delete, add venue, organization settings. Members see the reason under a disabled control.
- **Consent on the couple's behalf** is a sentence the coordinator can read aloud: an AI preview of their wedding at {venue}, made from these photos, photos deleted {retentionDays} days after delivery.
- **HEIC is not offered.** The upload API accepts JPG, PNG and WebP; leaving HEIC out of the file input makes iOS hand over a JPEG.

## Copy rules applied

Sentence case; buttons say what happens ("Mark as booked", "Make their gallery", "Add 10 credits", "Switch plan"); "booked dates" not "conversions"; no statistics the venue did not produce; "Recommended" rather than claims about what most venues pick.

## Known gaps (server side, outside this workstream)

- `POST /venues/{slug}/sessions/{id}/booked`, `POST /venues/{slug}/media/import-website`, `POST /venues/{slug}/sample-gallery` and `POST /venues/{slug}/tour-card-downloaded` are in the contract but not mounted in the API at this base; the UI degrades with a plain note on the catch-all 404.
- `PATCH /venues/{slug}` ignores `incentiveText`; Settings detects the mismatch and says so.
- Review-before-send has a column but no API field, so there is no toggle yet.
