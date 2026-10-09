import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  assertNormalizedUploadObjectPath,
} from "../lib/objectStorage";
import {
  db,
  venuesTable,
  venueMediaTable,
  coupleSessionsTable,
  coupleMediaTable,
  generatedAssetsTable,
  uploadIntentsTable,
} from "@workspace/db";
import { rateLimit, clientKey } from "../lib/rateLimit";
import { getCallerOrgDbId, requireOrgVenue } from "../lib/orgAuth.js";
import { coupleUploadTokenExpiry, verifyCoupleUploadToken } from "../lib/uploadToken";
import { canReadVenueMediaReference } from "../lib/objectAccess";
import { canReadGeneratedAssetWithShareToken } from "../lib/sessionVisibility";
import {
  uploadIntentCoupleHourlyCap,
  uploadIntentVenueDailyCap,
} from "../lib/sessionCleanupConfig";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Owner uploads from the dashboard: the owner is signed in, a day is plenty. */
const OWNER_UPLOAD_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Couple uploads live as long as the upload token plus a grace period for
 * finishing the form, so an abandoned upload is swept within the hour instead
 * of sitting in the bucket for a day.
 */
const COUPLE_UPLOAD_INTENT_GRACE_MS = 15 * 60 * 1000;

function extensionForImageMime(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}

async function countVenueIntentsSince(venueId: number, since: Date, purpose?: string): Promise<number> {
  const conditions = [eq(uploadIntentsTable.venueId, venueId), gte(uploadIntentsTable.createdAt, since)];
  if (purpose) conditions.push(eq(uploadIntentsTable.purpose, purpose));
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(uploadIntentsTable)
    .where(and(...conditions));
  return row?.count ?? 0;
}

/**
 * Anyone holding a venue slug (and, for couples, a short-lived token) can ask
 * for an upload URL, so beyond the per-IP limit each venue has a rolling daily
 * budget and couple uploads a rolling hourly one. The budgets are far above
 * honest use (five venue photos, two or three couple photos per tour).
 */
async function uploadIntentCapExceeded(
  venueId: number,
  purpose: "venue" | "couple",
  now = Date.now(),
): Promise<boolean> {
  const daily = await countVenueIntentsSince(venueId, new Date(now - 24 * 60 * 60 * 1000));
  if (daily >= uploadIntentVenueDailyCap()) return true;
  if (purpose === "couple") {
    const hourly = await countVenueIntentsSince(venueId, new Date(now - 60 * 60 * 1000), "couple");
    if (hourly >= uploadIntentCoupleHourlyCap()) return true;
  }
  return false;
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) - NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType, purpose, venueSlug, uploadToken } = parsed.data;

    if (!ALLOWED_IMAGE_TYPES.has(contentType) || size > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: "Upload must be a JPG, PNG, or WebP image up to 50MB." });
      return;
    }
    if (!rateLimit(`upload:${clientKey(req)}`, 120, 60 * 60 * 1000)) {
      res.status(429).json({ error: "Too many uploads. Try again later." });
      return;
    }
    if (!venueSlug) {
      res.status(400).json({ error: "venueSlug is required" });
      return;
    }
    const now = Date.now();
    let venueId: number;
    let expiresAt = new Date(now + OWNER_UPLOAD_INTENT_TTL_MS);
    if (purpose === "venue") {
      const venue = await requireOrgVenue(req, res, venueSlug);
      if (!venue) return;
      venueId = venue.id;
    } else if (uploadToken) {
      if (!verifyCoupleUploadToken(uploadToken, venueSlug, now)) {
        res.status(401).json({ error: "Upload token expired. Refresh the venue page and try again." });
        return;
      }
      const tokenExpiresAt = coupleUploadTokenExpiry(uploadToken, venueSlug, now) ?? now;
      const [venue] = await db
        .select({ id: venuesTable.id })
        .from(venuesTable)
        .where(eq(venuesTable.slug, venueSlug));
      if (!venue) {
        res.status(404).json({ error: "Venue not found" });
        return;
      }
      venueId = venue.id;
      expiresAt = new Date(
        Math.min(tokenExpiresAt + COUPLE_UPLOAD_INTENT_GRACE_MS, now + OWNER_UPLOAD_INTENT_TTL_MS),
      );
    } else {
      // Owner-driven couple upload from the dashboard. requireOrgVenue
      // writes its own error response, so never write a second one here.
      const ownerVenue = await requireOrgVenue(req, res, venueSlug);
      if (!ownerVenue) return;
      venueId = ownerVenue.id;
    }

    if (await uploadIntentCapExceeded(venueId, purpose === "venue" ? "venue" : "couple", now)) {
      res.status(429).json({
        error: "This venue has reached its upload limit for now. Try again in a little while.",
      });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL(
      extensionForImageMime(contentType),
    );
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    assertNormalizedUploadObjectPath(objectPath);
    await db.insert(uploadIntentsTable).values({
      objectKey: objectPath,
      venueId,
      purpose,
      originalName: name.slice(0, 240),
      contentType,
      sizeBytes: size,
      expiresAt,
    });

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType, purpose, venueSlug },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public - no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(
      file,
      3600,
      undefined,
      typeof req.headers.range === "string" ? req.headers.range : undefined,
    );

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities. Access is decided by what the object is in
 * the database (venue reference photo, generated gallery asset, couple
 * photo) and who is asking (venue visitor, share-token holder, org member).
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const canRead = await canReadStoredObject(req, objectPath);
    if (!canRead) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(
      objectFile,
      3600,
      objectPath,
      typeof req.headers.range === "string" ? req.headers.range : undefined,
    );

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;

/**
 * Object keys are stored in their normalized `/objects/...` form (the upload
 * route asserts it before inserting an intent, and generated assets are
 * written that way), so every lookup is a single indexed equality.
 */
async function canReadStoredObject(req: Request, objectPath: string): Promise<boolean> {
  const [venueMedia] = await db
    .select({
      id: venueMediaTable.id,
      venueSlug: venuesTable.slug,
      organizationId: venuesTable.organizationId,
    })
    .from(venueMediaTable)
    .innerJoin(venuesTable, eq(venueMediaTable.venueId, venuesTable.id))
    .where(eq(venueMediaTable.objectKey, objectPath))
    .limit(1);

  const callerOrgId = await getCallerOrgDbId(req);
  const publicVenueSlug = typeof req.query.venueSlug === "string" ? req.query.venueSlug : "";

  if (venueMedia) {
    return canReadVenueMediaReference({
      publicVenueSlug,
      venueSlug: venueMedia.venueSlug,
      callerOrgId,
      venueOrganizationId: venueMedia.organizationId,
    });
  }

  const shareToken = typeof req.query.shareToken === "string" ? req.query.shareToken : "";
  if (shareToken) {
    const [generated] = await db
      .select({
        sessionId: generatedAssetsTable.sessionId,
        status: coupleSessionsTable.status,
      })
      .from(generatedAssetsTable)
      .innerJoin(coupleSessionsTable, eq(generatedAssetsTable.sessionId, coupleSessionsTable.id))
      .where(
        and(
          eq(generatedAssetsTable.objectKey, objectPath),
          eq(coupleSessionsTable.shareToken, shareToken),
        ),
      )
      .limit(1);
    if (generated) {
      const sessionAssets = await db
        .select({
          assetType: generatedAssetsTable.assetType,
          displayOrder: generatedAssetsTable.displayOrder,
        })
        .from(generatedAssetsTable)
        .where(eq(generatedAssetsTable.sessionId, generated.sessionId));
      if (canReadGeneratedAssetWithShareToken(generated.status, sessionAssets)) return true;
    }
  }

  if (callerOrgId == null) return false;
  const [ownedGenerated] = await db
    .select({ id: generatedAssetsTable.id })
    .from(generatedAssetsTable)
    .innerJoin(coupleSessionsTable, eq(generatedAssetsTable.sessionId, coupleSessionsTable.id))
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .where(
      and(
        eq(generatedAssetsTable.objectKey, objectPath),
        eq(venuesTable.organizationId, callerOrgId),
      ),
    )
    .limit(1);
  if (ownedGenerated) return true;

  const [ownedCouple] = await db
    .select({ id: coupleMediaTable.id })
    .from(coupleMediaTable)
    .innerJoin(coupleSessionsTable, eq(coupleMediaTable.sessionId, coupleSessionsTable.id))
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .where(and(eq(coupleMediaTable.objectKey, objectPath), eq(venuesTable.organizationId, callerOrgId)))
    .limit(1);
  return Boolean(ownedCouple);
}
