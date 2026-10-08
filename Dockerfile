# syntax=docker/dockerfile:1
#
# Two stages: `builder` installs every workspace dependency and runs the full
# build; `runtime` carries only what `node artifacts/api-server/dist/index.mjs`
# needs at run time. The api-server bundle is a single ESM file (esbuild) that
# externalizes native/ file-reading packages (sharp, @google-cloud/*), so the
# runtime stage ships the api-server's production node_modules via
# `pnpm deploy`, the bundle, and the built SPA that the bundle serves from
# `../../../artifacts/wedding-app/dist/public` relative to the dist file.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder

RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json .npmrc ./
COPY artifacts ./artifacts
COPY lib ./lib
COPY scripts ./scripts
COPY supabase ./supabase

# lib/brand depends on playwright for the OG-image generator; the browser
# itself is never needed in this image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN pnpm install --frozen-lockfile

# Optional: bake the (public) Clerk publishable key into the SPA bundle.
# Railway passes service variables as build args when declared here. The
# server also injects the key at runtime, so this is best-effort only.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN pnpm run build

# Production-only dependency tree for the api-server (its workspace packages
# are already bundled into dist, but pnpm still links them; they are small).
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /out/api-server

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=5000

WORKDIR /app

# Keep the monorepo layout so the bundle's relative frontend path resolves:
#   /app/artifacts/api-server/dist/index.mjs
#   /app/artifacts/wedding-app/dist/public/index.html
COPY --from=builder --chown=node:node /out/api-server/package.json ./artifacts/api-server/package.json
COPY --from=builder --chown=node:node /out/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=builder --chown=node:node /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder --chown=node:node /app/artifacts/wedding-app/dist/public ./artifacts/wedding-app/dist/public

USER node

EXPOSE 5000

# Railway uses healthcheckPath = /api/readyz from railway.toml; this mirrors it
# for plain `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
