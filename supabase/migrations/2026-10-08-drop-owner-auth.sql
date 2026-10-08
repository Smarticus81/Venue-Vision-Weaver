-- Retire the legacy owner-auth stack (magic-link tokens, password credentials,
-- server-side owner sessions). Owner sign-in is Clerk end to end; no code path
-- reads these tables after the 2026-10-08 build.
--
-- RUN AFTER THE NEW BUILD IS DEPLOYED: the previous build still references
-- these tables at startup (cleanupExpiredOwnerAuth) and in its readiness
-- contract, so dropping them while it is live would fail /api/readyz.
-- Destructive and not reversible: owner_credentials holds 3 legacy rows that
-- nothing reads (Clerk owns passwords); export first if you want an archive.

DROP TABLE IF EXISTS owner_sessions;
DROP TABLE IF EXISTS owner_login_tokens;
DROP TABLE IF EXISTS owner_credentials;
