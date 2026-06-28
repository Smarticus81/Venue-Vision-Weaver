---
name: multi-page mockup sites in mockup-sandbox
description: how to build a browsable multi-page site as canvas mockups
---

The mockup-sandbox `mockupPreviewPlugin` auto-discovers every `.tsx` under `src/components/mockups/**` via chokidar and writes the registry to `src/.generated/mockup-components.ts`. Each file is previewable at `/__mockup/preview/<group>/<Component>`.

**Shared parts:** files/dirs whose name starts with `_` (e.g. `_shared.tsx`, `_group.css`) are excluded from preview routes but can still be imported normally by sibling page files. Put reusable Nav/Footer/primitives in `_shared.tsx`.

**Browsable navigation:** inside a page, use RELATIVE hrefs (e.g. `href="Pricing"`, `href="Landing"`) so links resolve to sibling preview URLs within the same iframe. No need for the absolute base path.

**Picking up new files:** the watcher usually auto-regenerates, but restart the "artifacts/mockup-sandbox: Component Preview Server" workflow after adding files to be safe before screenshotting.

**Canvas layout:** place each page as its own `iframe` shape via `applyCanvasActions` `create` with explicit x/y (1920x1080 each, ~200px gap in a row), then `presentArtifact({ artifactId: "artifacts/mockup-sandbox", shapeIds })`.

**How to apply:** when a user asks to apply an aesthetic "to every page" of a mockup, build sibling page components reusing `_shared`, then lay them out as separate iframes.
