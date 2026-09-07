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

All names, email addresses, balances, and dates are fixtures. Gallery images reuse the generated public sample; no fixture video is included. The sign-in widget itself is not exercised. This preview provides layout and interaction checks, not end-to-end verification of production services.
