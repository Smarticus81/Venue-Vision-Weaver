---
name: mockup-sandbox first-run setup
description: mockup-sandbox artifact needs npm install before its dev server can start
---

After `createArtifact({ artifactType: "mockup-sandbox" })`, the Component Preview Server workflow fails on first restart with `sh: vite: command not found` — dependencies are NOT auto-installed.

**Fix:** run `npm install` inside `artifacts/mockup-sandbox/` (not the repo root — it has its own package.json/node_modules), THEN restart the "artifacts/mockup-sandbox: Component Preview Server" workflow.

**How to apply:** do the install right after createArtifact and before the first restart_workflow, otherwise the first restart attempt always fails.
