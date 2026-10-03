---
name: Glimpse real product workflow
description: the actual B2B2C venue workflow — easy to get wrong as a generic SaaS flow
---

Glimpse (artifacts/wedding-app + artifacts/api-server) is a B2B2C tool for wedding/event venues, NOT a generic consumer photo app. The real flow:
1. A VENUE OWNER signs up and uploads 5+ reference photos of their real venue (ceremony, reception, exterior, etc.).
2. A prospective COUPLE enters one of two ways: (a) the owner photographs them (2-3 photos) during an in-person tour and enters their email from the owner dashboard `/dashboard`, OR (b) the couple self-serves via the venue's public link `/preview/:slug` (venue showcase → upload their photos → pick editorial style + email).
3. AI generates a private gallery (4 editorial stills + 1 motion reel) placing the couple's likeness into the venue's REAL photos.
4. The couple gets an emailed link to a private gallery at `/v/:shareToken` with a prominent "Book a tour" CTA to convert into a booking.

**Why:** An earlier marketing mockup described a generic "couple uploads photos / browse gallery" SaaS story, which the user flagged as the wrong workflow. The venue-led, conversion-follow-up framing is the correct one.

**How to apply:** When writing copy or designing pages, keep the venue-as-customer, gallery-as-tour-follow-up framing. Do not introduce pricing/"how it works" marketing pages or flows that contradict the above.
