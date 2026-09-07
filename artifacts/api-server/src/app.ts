import express, { type Express, type Response } from "express";
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
import { logger } from "./lib/logger";
import { logStripeMissing } from "./lib/stripe.js";
import { clerkEnabled, clerkPublishableKey } from "./lib/orgAuth.js";
import { corsOptions, securityHeaders } from "./lib/httpSecurity.js";
import { trustProxySetting } from "./lib/trustProxy.js";
import { hasCompletePublicGalleryAssets } from "./lib/sessionVisibility.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();
app.set("trust proxy", trustProxySetting());

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
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

// Stripe billing webhooks (org subscriptions + credit packs). Raw body for
// signature verification.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    void handleStripeWebhook(req, res);
  },
);

// Clerk webhooks (organization name sync). Raw body for svix signature.
app.post(
  "/api/webhooks/clerk",
  express.raw({ type: "application/json" }),
  (req, res) => {
    void handleClerkWebhook(req, res);
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

/**
 * Serve the SPA shell with the Clerk publishable key injected as a meta tag.
 * VITE_ vars are baked into the bundle at build time, so a container built
 * without the key (the normal case on Railway) would otherwise ship a bundle
 * where owner sign-in is permanently disabled; the runtime meta tag lets the
 * frontend pick the key up from the server environment instead.
 */
function serveIndexHtml(res: Response, extraHeadHtml = ""): void {
  const html = indexHtml();
  if (html === null) {
    res.status(404).send("Frontend build not found");
    return;
  }
  const key = clerkPublishableKey();
  const headHtml =
    (key ? `<meta name="clerk-publishable-key" content="${escapeHtml(key)}" />` : "") +
    extraHeadHtml;
  // The shell references hashed chunk filenames that change every deploy, so
  // it must always be revalidated — a cached stale shell means 404s on lazy
  // route chunks and a blank page.
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(headHtml ? html.replace("<head>", `<head>${headHtml}`) : html);
}

app.get("/v/:shareToken", async (req, res): Promise<void> => {
  try {
    const { shareToken } = req.params;
    if (!shareToken) {
      serveIndexHtml(res);
      return;
    }

    const [session] = await db
      .select()
      .from(coupleSessionsTable)
      .where(eq(coupleSessionsTable.shareToken, shareToken));

    if (!session) {
      serveIndexHtml(res);
      return;
    }

    const [venue] = await db
      .select()
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
      session.status === "ready" && hasCompletePublicGalleryAssets(generatedAssets)
        ? generatedAssets
        : [];
    const thumbnailAsset = publicGeneratedAssets.find(
      (asset) => asset.assetType === "image" && asset.displayOrder === 1,
    );

    const thumbnail = thumbnailAsset
      ? `/api/storage${thumbnailAsset.objectKey}?shareToken=${encodeURIComponent(shareToken)}`
      : "";
    const coupleName = session.coupleName || "A Beautiful Couple";
    const venueName = venue ? venue.name : "Their Dream Venue";

    const title = `${coupleName}'s glimpse gallery`;
    const description = `Explore a cinematic AI wedding gallery of ${coupleName} at ${venueName}.`;

    const metaTags = `
        <title>${escapeHtml(title)}</title>
        <meta name="description" content="${escapeHtml(description)}" />
        <meta property="og:title" content="${escapeHtml(title)}" />
        <meta property="og:description" content="${escapeHtml(description)}" />
        <meta property="og:image" content="${escapeHtml(thumbnail)}" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${escapeHtml(title)}" />
        <meta name="twitter:description" content="${escapeHtml(description)}" />
        <meta name="twitter:image" content="${escapeHtml(thumbnail)}" />
      `;

    serveIndexHtml(res, metaTags);
  } catch (err) {
    logger.error({ err }, "Error serving shareable URL");
    serveIndexHtml(res);
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
app.get("/{*splat}", (_req, res) => {
  serveIndexHtml(res);
});

export default app;
