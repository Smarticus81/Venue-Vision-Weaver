---
name: Replit DB SSL fix
description: How to handle Replit's internal PostgreSQL DATABASE_URL which adds ?ssl but doesn't support SSL connections.
---

Replit's built-in PostgreSQL injects `?ssl` into `DATABASE_URL` (host is `helium`), but the server does not support SSL connections. The pgPool normalization must detect the `@helium` internal host and skip SSL even when `?ssl` appears in the URL.

**Why:** Without this fix, pg Pool attempts SSL and throws "The server does not support SSL connections", crashing the API server on startup.

**How to apply:** In `lib/db/src/pgPool.ts`, detect `isReplitInternal` (URL contains `@helium`, `@localhost`, or `@127.0.0.1`) and only enable SSL when the host is Supabase or explicitly requires `sslmode=require` on a non-Replit-internal host. Also strip the bare `?ssl` parameter from the URL string.
