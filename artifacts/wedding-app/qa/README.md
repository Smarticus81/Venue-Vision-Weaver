# Isolated UI review

Run from the repository root:

```sh
pnpm --filter @workspace/wedding-app run dev:ui-fixture
```

Open `http://127.0.0.1:8082`. This development-only Vite configuration substitutes a local Clerk fixture and handles every `/api` request locally. It clears the normal API proxy and rejects non-GET operations with a simulated error. It cannot be built for deployment. The ordinary dev and build commands never load this configuration.

Useful routes:

- `/dashboard`: all owner workspace views; save errors can be inspected without writing anything.
- `/create-venue`: signed-in venue form.
- `/preview/willow`: venue welcome, photo selection, style selection and entered-data persistence.
- `/v/demo`: sample portrait viewer and sharing layout.
- `/v/processing`: waiting state.
- `/v/failed`: failed generation recovery.
- `/find-my-gallery`: simulated recovery request failure.
- `/control`: operator console overview: revenue funnel (owners and prospects), KPI sparklines with 7-day deltas, kill switches in the header, editable guardrail cards (saves are rejected by the fixture, so the error toast is the expected result).
- `/control#growth`: growth loop KPIs, activation funnel, weekly cohorts, segments, copy variants, experiment board, adaptations and the weekly digest.
- `/control#pipeline`: 72 fixture prospects with paging, search, status and vetting filters; open Evidence on a row for checks and sourced facts.
- `/control#approvals`: pending queue with a studio email (Review in Outreach link), a retired legacy send and a readable venue email; history shows an executing row.
- `/control#outreach/2`: a draft held by the daily cap with a broken copy rule, so Retry send stays disabled until an override note is typed.
- `/control#outreach`: the outreach email studio review screen. Run `pnpm run outreach:demo -- --out qa-output/outreach-demo --site <venue url>` first and the fixture renders those real samples (photos are swapped for the local sample image).

All names, email addresses, balances, and dates are fixtures. Gallery images reuse the generated public sample; no fixture video is included. The sign-in widget itself is not exercised. This preview provides layout and interaction checks, not end-to-end verification of production services.
