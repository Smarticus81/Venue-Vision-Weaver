import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, coupleSessionsTable, venuesTable, generatedAssetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clerkMiddleware } from "@clerk/express";
import { clerkDomainMismatch } from "./lib/clerkEnv.js";
import router from "./routes";
import { handleClerkWebhook, handleStripeWebhook } from "./routes/billing.js";
import { handleResendWebhook } from "./control-plane/outreach/resendWebhook.js";
import { logger, redactUrlForLog } from "./lib/logger";
import { logStripeMissing } from "./lib/stripe.js";
import { clerkEnabled, clerkPublishableKey } from "./lib/orgAuth.js";
import { corsOptions, securityHeaders } from "./lib/httpSecurity.js";
import { forwardedForIgnored, trustProxySetting } from "./lib/trustProxy.js";
import { canExposeGeneratedAssetsToSharePage, hasCompletePublicGalleryAssets } from "./lib/sessionVisibility.js";
import { absoluteUrl, getAppBaseUrl } from "./lib/appUrl.js";
import { buildPublicConfig, publicConfigMetaTag } from "./lib/publicConfig.js";
import {
  escapeHtml,
  galleryOpenGraphTags,
  isNoindexPath,
  renderNoscriptShell,
  renderShellHtml,
} from "./lib/noscriptShell.js";
import { clientKey, rateLimit } from "./lib/rateLimit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
const trustProxy = trustProxySetting();
app.set("trust proxy", trustProxy);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Share, upload, unsubscribe and claim tokens travel in the path;
          // never write them to logs.
          url: redactUrlForLog(req.url),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders);
app.use(cors(corsOptions()));
app.use(cookieParser());
logStripeMissing();

// Behind an unknown proxy with trust proxy off, every caller shares one IP
// and the per-IP limits lock everyone out together. Say so once.
let warnedForwardedFor = false;
app.use((req, _res, next) => {
  if (!warnedForwardedFor && forwardedForIgnored(req.headers, trustProxy)) {
    warnedForwardedFor = true;
    logger.warn(
      "Requests carry X-Forwarded-For but trust proxy is off; set TRUST_PROXY=1 (or the hop count) so rate limits and IP hashing see the real client address",
    );
  }
  next();
});

/**
 * Webhooks come from Stripe, Clerk and Resend servers, never from a browser
 * session: they are registered BEFORE clerkMiddleware so a Clerk outage or a
 * handshake redirect can never swallow a payment event. They read the raw body
 * for signature verification, and a thrown handler is answered rather than
 * leaking as an unhandled rejection (Stripe retries on 5xx).
 */
function webhook(
  name: string,
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    handler(req, res).catch((err: unknown) => {
      logger.error({ err, webhook: name }, "Webhook handler failed");
      if (!res.headersSent) res.status(500).json({ error: "Webhook handler failed" });
    });
  };
}

// Stripe billing webhooks (org subscriptions + credit packs).
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  webhook("stripe", handleStripeWebhook),
);

// Clerk webhooks (organization name sync). svix signature.
app.post(
  "/api/webhooks/clerk",
  express.raw({ type: "application/json" }),
  webhook("clerk", handleClerkWebhook),
);

// Resend delivery webhooks (outreach studio bounces/complaints). svix signature.
app.post(
  "/api/webhooks/resend",
  express.raw({ type: "application/json" }),
  webhook("resend", handleResendWebhook),
);

if (clerkEnabled()) {
  // Verifies the Clerk session (cookie or Authorization header) and exposes
  // getAuth(req) to every API route. Does not itself reject unauthenticated
  // requests — org-scoped routes enforce that via requireOrg. Keys are passed
  // explicitly so VITE_CLERK_PUBLISHABLE_KEY alone also satisfies the SDK.
  // Scoped to /api on purpose: mounted globally it 307-redirects browser
  // page navigations to Clerk's handshake endpoint, so if Clerk is slow,
  // unreachable, or rejects the origin, pages never render at all. The SPA
  // authenticates via clerk-js in the browser; only the API needs getAuth.
  app.use(
    "/api",
    clerkMiddleware({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: clerkPublishableKey(),
    }),
  );
  const expectedDomain = clerkDomainMismatch();
  if (expectedDomain) {
    logger.warn(
      `The Clerk production key is locked to "${expectedDomain}" but APP_BASE_URL is ` +
        `${process.env.APP_BASE_URL} — owner sign-in will fail in the browser unless the site ` +
        `is served from ${expectedDomain} (or a subdomain), or a pk_test_ development key is used`,
    );
  }
} else {
  const missing = [
    !process.env.CLERK_SECRET_KEY?.trim() && "CLERK_SECRET_KEY",
    !clerkPublishableKey() && "CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY)",
  ]
    .filter(Boolean)
    .join(" and ");
  logger.warn(
    `${missing} not set — owner/organization routes will refuse requests until Clerk is configured`,
  );
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// RFC 8058 one-click unsubscribe posts `List-Unsubscribe=One-Click` as text/plain.
app.use("/api/outreach/unsubscribe", express.text({ type: "text/plain" }));

app.use("/api", router);

// Any unmatched /api/* path returns a structured JSON 404 instead of falling
// through to the SPA HTML. This avoids accidentally leaking the existence of
// deprecated endpoints and keeps API responses machine-readable.
app.use("/api/{*splat}", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const frontendDist = path.resolve(__dirname, "../../../artifacts/wedding-app/dist/public");

let cachedIndexHtml: string | null = null;
function indexHtml(): string | null {
  if (cachedIndexHtml !== null) return cachedIndexHtml;
  const htmlPath = path.join(frontendDist, "index.html");
  if (!fs.existsSync(htmlPath)) return null;
  cachedIndexHtml = fs.readFileSync(htmlPath, "utf-8");
  return cachedIndexHtml;
}

// The landing hero is the LCP element; preload it only when the built asset
// exists so a missing file never costs a wasted request.
const HERO_IMAGE_PATH = "/brand/hero-couple.webp";
let heroPreloadTag: string | null = null;
function heroPreload(): string {
  if (heroPreloadTag === null) {
    heroPreloadTag = fs.existsSync(path.join(frontendDist, HERO_IMAGE_PATH))
      ? `<link rel="preload" as="image" href="${HERO_IMAGE_PATH}" fetchpriority="high" />`
      : "";
  }
  return heroPreloadTag;
}

interface ShellOptions {
  /** Request path, used for noindex and the noscript variant. */
  path: string;
  /** Page-specific title/description/og/twitter tags replacing the shell's. */
  replaceMetaWith?: string;
}

/**
 * Serve the SPA shell with runtime configuration injected as meta tags: the
 * Clerk publishable key (VITE_ vars are baked at build time, so a container
 * built without the key would otherwise ship a bundle where owner sign-in is
 * permanently disabled) and the public config (prices, trial, contact) so the
 * landing page and dashboard render real numbers on first paint without a
 * fetch. Private paths get noindex in the HTML and in X-Robots-Tag; every
 * shell carries the <noscript> pitch or gallery notice.
 */
async function serveIndexHtml(res: Response, options: ShellOptions): Promise<void> {
  const html = indexHtml();
  if (html === null) {
    res.status(404).send("Frontend build not found");
    return;
  }
  const key = clerkPublishableKey();
  const config = await buildPublicConfig();
  const noindex = isNoindexPath(options.path);
  const headTags =
    (key ? `<meta name="clerk-publishable-key" content="${escapeHtml(key)}" />` : "") +
    publicConfigMetaTag(config) +
    (options.path === "/" ? heroPreload() : "");

  // The shell references hashed chunk filenames that change every deploy, so
  // it must always be revalidated — a cached stale shell means 404s on lazy
  // route chunks and a blank page.
  res.setHeader("Cache-Control", "no-cache");
  if (noindex) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.type("html").send(
    renderShellHtml({
      html,
      headTags,
      replaceMetaWith: options.replaceMetaWith,
      noindex,
      noscript: renderNoscriptShell(config, options.path),
      assetBaseUrl: getAppBaseUrl(),
    }),
  );
}

/* ————— Shared gallery pages: Open Graph for link previews ————— */

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const OG_RATE_LIMIT = { limit: 120, windowMs: 10 * 60 * 1000 };
const OG_CACHE_TTL_MS = 60 * 1000;
const OG_CACHE_MAX = 500;
const ogTagCache = new Map<string, { at: number; tags: string | null }>();

async function galleryMetaTags(shareToken: string): Promise<string | null> {
  const now = Date.now();
  const cached = ogTagCache.get(shareToken);
  if (cached && now - cached.at < OG_CACHE_TTL_MS) return cached.tags;

  const [session] = await db
    .select()
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.shareToken, shareToken));

  let tags: string | null = null;
  if (session) {
    const [venue] = await db
      .select({ name: venuesTable.name })
      .from(venuesTable)
      .where(eq(venuesTable.id, session.venueId));

    const generatedAssets = await db
      .select({
        objectKey: generatedAssetsTable.objectKey,
        assetType: generatedAssetsTable.assetType,
        displayOrder: generatedAssetsTable.displayOrder,
      })
      .from(generatedAssetsTable)
      .where(eq(generatedAssetsTable.sessionId, session.id))
      .orderBy(generatedAssetsTable.displayOrder);

    const publicGeneratedAssets =
      canExposeGeneratedAssetsToSharePage(session.status, session.deliveryHoldReason) &&
      hasCompletePublicGalleryAssets(generatedAssets)
        ? generatedAssets
        : [];
    const thumbnailAsset = publicGeneratedAssets.find(
      (asset) => asset.assetType === "image" && asset.displayOrder === 1,
    );

    const coupleName = session.coupleName || "The couple";
    const venueName = venue ? venue.name : "the venue";
    const title = `${coupleName} at ${venueName} · Dreemer`;
    const description = `AI preview: ${coupleName} imagined at ${venueName}, made with Dreemer.`;

    tags = galleryOpenGraphTags({
      title,
      description,
      pageUrl: absoluteUrl(`/v/${shareToken}`),
      ...(thumbnailAsset
        ? {
            imageUrl: absoluteUrl(
              `/api/storage${thumbnailAsset.objectKey}?shareToken=${encodeURIComponent(shareToken)}`,
            ),
          }
        : { imageUrl: absoluteUrl("/og-image.png"), imageWidth: 1200, imageHeight: 630 }),
    });
  }

  if (ogTagCache.size >= OG_CACHE_MAX) {
    const oldest = ogTagCache.keys().next().value;
    if (oldest !== undefined) ogTagCache.delete(oldest);
  }
  ogTagCache.set(shareToken, { at: now, tags });
  return tags;
}

app.get("/v/:shareToken", async (req, res): Promise<void> => {
  const { shareToken } = req.params;
  try {
    // Only well-formed tokens reach the database, and link-preview crawlers
    // (and anyone scanning tokens) are rate limited per client.
    if (
      !shareToken ||
      !SHARE_TOKEN_PATTERN.test(shareToken) ||
      !rateLimit(`og:${clientKey(req)}`, OG_RATE_LIMIT.limit, OG_RATE_LIMIT.windowMs)
    ) {
      await serveIndexHtml(res, { path: req.path });
      return;
    }
    const tags = await galleryMetaTags(shareToken);
    await serveIndexHtml(res, { path: req.path, replaceMetaWith: tags ?? undefined });
  } catch (err) {
    logger.error({ err }, "Error serving shareable URL");
    if (!res.headersSent) await serveIndexHtml(res, { path: req.path });
  }
});

// index: false so `/` falls through to the handler below and gets the
// runtime-injected HTML instead of the raw file. Hashed assets are immutable
// by construction; everything else (favicon, opengraph image) gets a short
// TTL so it can be replaced without a rename.
app.use(
  express.static(frontendDist, {
    index: false,
    setHeaders(res, filePath) {
      const isHashedAsset = path
        .relative(frontendDist, filePath)
        .startsWith(`assets${path.sep}`);
      res.setHeader(
        "Cache-Control",
        isHashedAsset ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      );
    },
  }),
);
app.get("/{*splat}", (req, res, next) => {
  serveIndexHtml(res, { path: req.path }).catch(next);
});

export default app;
