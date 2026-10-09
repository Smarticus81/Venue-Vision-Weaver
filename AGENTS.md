# AGENTS.md

Read `CLAUDE.md`. It is the single guide for working in this repository:
commands, architecture, key patterns and required environment variables. This
file only restates the three rules that coding agents most often get wrong.

1. **OpenAPI-first, then codegen.** The API contract lives in
   `lib/api-spec/openapi.yaml`. Change it there, then run
   `pnpm --filter @workspace/api-spec run codegen`. Never hand-edit
   `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/`; CI
   fails when the committed output differs from a fresh codegen run.
2. **Clerk is the only auth.** Members sign in with their own Clerk profile and
   one Clerk Organization is the billing tenant. Do not add PIN, password,
   magic-link or cookie-session flows, and use `requireOrg` /
   `requireOrgVenue` (`artifacts/api-server/src/lib/orgAuth.ts`) for
   org-scoped routes.
3. **Every email to a real person goes through the guarded send path.** The
   control plane is autonomous by default (`autonomous_mode` policy): outreach
   is drafted in the studio (`artifacts/api-server/src/control-plane/outreach/`),
   proposed as a high-risk action, and leaves only via `sender.ts`, which
   re-checks vetting, consent, suppression, caps and unsubscribe at send time.
   Those checks are the only gate in autonomous mode, so keep them intact.
   `update_policy` must keep `alwaysRequiresApproval` so agents cannot loosen
   their own guardrails.

Before finishing: `pnpm run typecheck`, `pnpm run test`, `pnpm run smoke:security`,
`pnpm run build`.
