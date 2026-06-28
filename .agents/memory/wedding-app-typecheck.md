---
name: wedding-app typecheck false errors
description: why `tsc -p` on wedding-app reports TS6305 + implicit-any that are not real build failures
---

Running `tsc -p tsconfig.json --noEmit` (or the package's `typecheck` script) inside `artifacts/wedding-app` reports `TS6305: Output file .../lib/api-client-react/dist/index.d.ts has not been built from source` plus a cascade of `TS7006` implicit-`any` errors on callbacks that consume api-client hooks (e.g. `(session) =>`, `(item) =>`, `.map`/`.filter` params).

**Why:** `@workspace/api-client-react` is a TS project reference. Standalone `tsc -p ... --noEmit` does not build referenced projects, so its declaration types resolve to stale/any, which makes every hook return `any` and every downstream callback param implicitly `any`. These same errors exist at HEAD — they are pre-existing tooling artifacts, NOT regressions.

**How to apply:** Do not "fix" these by sprinkling type annotations after editing pages. The deploy/build path is `vite build` (esbuild, no typecheck), so they never block the build or runtime. To get a clean typecheck, build the referenced lib first / use `tsc -b`. When verifying page edits, rely on the Vite dev server compiling + screenshots, not standalone `tsc -p`.
