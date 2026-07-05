import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, coupleSessionsTable, venuesTable, generatedAssetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { handleClerkWebhook } from "./routes/billing.js";
import { logger } from "./lib/logger";
import { clerkEnabled } from "./lib/orgAuth.js";
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

if (clerkEnabled()) {
  // Verifies the Clerk session (cookie or Authorization header) and exposes
  // getAuth(req) to every route. Does not itself reject unauthenticated
  // requests — org-scoped routes enforce that via requireOrg.
  app.use(clerkMiddleware());
} else {
  logger.warn(
    "CLERK_SECRET_KEY is not set — owner/organization routes will refuse requests until Clerk is configured",
  );
}

// Clerk webhooks (billing + organization sync). Raw body for svix signature.
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

app.get("/v/:shareToken", async (req, res): Promise<void> => {
  try {
    const { shareToken } = req.params;
    if (!shareToken) {
      res.sendFile(path.join(frontendDist, "index.html"));
      return;
    }

    const [session] = await db
      .select()
      .from(coupleSessionsTable)
      .where(eq(coupleSessionsTable.shareToken, shareToken));

    if (!session) {
      res.sendFile(path.join(frontendDist, "index.html"));
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

    const htmlPath = path.join(frontendDist, "index.html");
    if (fs.existsSync(htmlPath)) {
      let html = fs.readFileSync(htmlPath, "utf-8");

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

      html = html.replace("<head>", `<head>${metaTags}`);
      res.send(html);
    } else {
      res.sendFile(htmlPath);
    }
  } catch (err) {
    logger.error({ err }, "Error serving shareable URL");
    res.sendFile(path.join(frontendDist, "index.html"));
  }
});

app.use(express.static(frontendDist));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

export default app;
