# Outreach email studio

Prospect emails are vetted, built, reviewed, and sent from the control
plane's Pipeline and Outreach tabs (`/control`). Two rules are enforced in
code, not just in agent prompts:

1. **No email goes to an unvetted venue.** Drafting, approving and sending
   all require a fresh `passed` verdict in `control_prospect_vetting`.
2. **Every email is about that venue.** The copy must cite at least two
   verified facts (a named space, the town, a stated guest count, or the
   owner's published name), each with the page it was found on.

## Pipeline

1. **Vetting** (`control-plane/vetting/`): runs automatically when the
   prospecting agent saves a prospect (`upsert_prospect`), before every draft,
   and again at send time when the stored verdict has expired. Tier A checks
   are free: the site is reachable and not parked, TLS, domain age (RDAP),
   archive history (Wayback CDX), MX/SPF/DMARC on the contact domain,
   disposable/free-mail and role-mailbox classification, the email and the
   contact's name published on the site, name/address/phone, marketplace
   badges, social links, wedding vocabulary, and blocked regions (Canada by
   default, `vetting_blocked_countries`). Tier B adds a Google Places listing
   when `GOOGLE_PLACES_API_KEY` is set (daily-capped). The checks become a
   0-100 score and a verdict: `passed` (>= `vetting_pass_score`, default 60),
   `review` (an operator decides), `failed` (any hard fail, or below
   `vetting_review_score`), or `error` (the site blocked us or lookups timed
   out; nothing changes until a re-run succeeds). A failed prospect is
   disqualified; a qualified prospect needing review goes back to `new`.
   Every check keeps its evidence URL and timestamp.
2. **Facts** (`vetting/facts.ts`): `control_prospect_facts` holds every fact
   with its source URL. Agents must cite where they found an email
   (`emailSourceUrl`) and a contact name (`contactNameSourceUrl`); those start
   `unverified`. Vetting and research verify facts against the pages they
   actually fetched. Operators can add or remove facts in Pipeline → Evidence.
3. **Research** (`outreach/venueResearch.ts`): fetches the venue's own site
   through a pinned-IP fetch (every redirect hop re-validated, private and
   reserved IPv4/IPv6 ranges refused, 45 s total deadline), extracts and
   sanitizes facts, attributes each one to the page it appears on, and picks
   up to three of the venue's own photos (share cards and logos are
   down-weighted). Failed research is retried after 24 hours, not on every
   draft.
4. **Copy** (`outreach/copywriter.ts`): Grok writes as a real person at
   Dreemer from the verified facts only. The validator enforces two subject
   options of at most 50 characters, 35-120 words, at least two cited facts
   (and a real space when one is verified), no invented space names, no hype,
   statistics or prices, and one ask. The greeting uses the owner's first
   name only when the name is verified on their site; otherwise "Hi there,".
   After two failed attempts a deterministic template built from the same
   facts is used and the draft notes say so.
5. **Template** (`outreach/emailTemplate.ts`): 600px table layout, light and
   dark, plain-text twin, the venue's photos with credits, a postal address,
   and a footer that says why this address is receiving the note ("…publicly
   lists this address for event inquiries. We write at most three times…").
   The renderer also builds the `List-Unsubscribe` and
   `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.
6. **Claim link**: each draft gets a random claim token; the call to action is
   `APP_BASE_URL/claim/<token>` with UTM parameters (campaign or first touch,
   variant or step) unless `OUTREACH_CTA_URL` overrides it. The public
   `GET /api/outreach/claim/{token}` returns the venue name, website, region
   and the photos the email showed, so signup is pre-filled; the first
   resolution stamps the email's `clicked_at` and records a `cta_click`
   funnel event. Only sent emails resolve.
7. **Approval**: `draft_outreach_email` (agent tool) or Pipeline → Draft email
   creates the `control_outreach_emails` row (with `cited_facts` and a
   `vetting_snapshot`) and proposes the high-risk `send_outreach_email`
   action. The Outreach review shows every cited fact with its source;
   `approvable` is false (and Approve is disabled) whenever a send would be
   refused. Edits that leave fewer than two verified facts are rejected.
8. **Send** (`outreach/sender.ts`): the only delivery path. Under a Postgres
   advisory lock it re-checks the approved action, consent and suppression,
   the daily cap (counted from emails actually sent today), the deliverability
   guard, the `outreach_sends_enabled` kill switch, vetting (re-running it
   once if expired), the two cited facts, the subject, a real postal address,
   a monitored non-free-mail reply-to, a non-sandbox sender, Resend
   configuration, and the campaign's status.
   - Fixable preconditions (cap reached, contact gap, guard paused, missing
     configuration, vetting needing a decision, too few facts) **keep the
     draft**: the email stays `draft` with `last_error` set and the action
     returns to `pending` for a later approval.
   - Blocked recipients (suppressed, unsubscribed/replied/disqualified, at the
     lifetime cap, an existing customer, a failed vetting, a completed
     campaign) and provider rejections mark the email and the action
     `failed`.
   Approved actions are claimed atomically (`approved` → `executing`), so the
   scheduler and an inline approval can never send the same email twice.
9. **After send**: `/api/outreach/unsubscribe/:token` (confirm page and
   one-click POST) writes `control_email_suppressions` and locks the
   prospect. `/api/webhooks/resend` records delivered, bounced, complained,
   opened and clicked (status only moves forward: a late "delivered" never
   overwrites a bounce or complaint). Bounces and complaints on studio emails
   suppress the address and feed the deliverability guard: the first
   complaint, or two bounces at 4% or more over 14 days, pauses all prospect
   sending until an operator resets it in Outreach. An inbound reply
   (`email.received`, when an inbound domain is configured in Resend) from a
   prospect's address marks it `replied`, which stops automated contact.

## Operator controls

- Pipeline → Evidence: every check with its evidence link and time, every
  fact with its source. **Vet** re-runs vetting; **Override** records a
  pass/fail decision with a note; facts can be added (with a source URL) or
  removed.
- Prospect status moves follow `PROSPECT_TRANSITIONS`. Qualifying requires a
  passed vetting (409 otherwise). Recording "unsubscribed" adds the address to
  the suppression list. Converted and unsubscribed are final.
- Outreach → Sending: the guard state, today's sends against the cap, and
  14-day bounce/complaint health; pause or reset with a note.

## Vetting and legacy actions

`send_prospect_email` (plain text, no vetting, no footer) is retired: new
proposals are refused, pending ones cannot be approved, and executing one
throws. `resume_agent` is retired too; operators resume agents from
`/control` → Agents.

Runbook for the rows that were pending when this shipped:

1. Approvals → filter pending → for each `send_prospect_email` row click
   Reject with the note `retired: re-draft via studio`.
2. Pipeline → the same prospects → **Vet** → **Draft email**.
3. While the sending domain is new, set `max_prospect_emails_per_day` and
   `max_prospect_emails_per_day_base` to 5-10 and raise them weekly.
4. Before the first real send, set `OUTREACH_POSTAL_ADDRESS`,
   `OUTREACH_REPLY_TO` (a monitored mailbox on the sending domain),
   `EMAIL_FROM` on a verified domain, `RESEND_API_KEY` and
   `RESEND_WEBHOOK_SECRET`, and subscribe the Resend webhook to
   `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained`, `email.opened`, `email.clicked`
   (and `email.received` if inbound replies are routed through Resend).

## Local demo

`pnpm run outreach:demo -- --out qa-output/outreach-demo --site <url> …` runs
research, fact attribution, copy and the template against real sites with no
database, storage, or mail provider, and prints the verified facts the copy
was allowed to cite. `local-fixture/` holds the same pipeline run against an
offline fixture site.
