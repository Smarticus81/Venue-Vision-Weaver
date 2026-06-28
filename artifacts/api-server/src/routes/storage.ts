import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { and, eq } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  assertNormalizedUploadObjectPath,
} from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
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
import { getOwnerEmailFromRequest, requireOwnerVenue } from "../lib/ownerAuth";
import { verifyCoupleUploadToken } from "../lib/uploadToken";
import { canReadVenueMediaReference } from "../lib/objectAccess";
import { canReadGeneratedAssetWithShareToken } from "../lib/sessionVisibility";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function extensionForImageMime(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
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
      res.status(400).json({ error: "Upload must be a JPG, PNG, or WebP image up to 8MB." });
      return;
    }
    if (!rateLimit(`upload:${clientKey(req)}`, 30, 60 * 60 * 1000)) {
      res.status(429).json({ error: "Too many uploads. Try again later." });
      return;
    }
    if (!venueSlug) {
      res.status(400).json({ error: "venueSlug is required" });
      return;
    }
    let venueId: number;
    if (purpose === "venue") {
      const venue = await requireOwnerVenue(req, res, venueSlug);
      if (!venue) return;
      venueId = venue.id;
    } else {
      const ownerVenue = uploadToken ? null : await requireOwnerVenue(req, res, venueSlug);
      if (ownerVenue) {
        venueId = ownerVenue.id;
      } else {
        if (!uploadToken || !verifyCoupleUploadToken(uploadToken, venueSlug)) {
          res.status(401).json({ error: "Upload token expired. Refresh the venue page and try again." });
          return;
        }
        const [venue] = await db
          .select({ id: venuesTable.id })
          .from(venuesTable)
          .where(eq(venuesTable.slug, venueSlug));
        if (!venue) {
          res.status(404).json({ error: "Venue not found" });
          return;
        }
        venueId = venue.id;
      }
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
      expiresAt: new Date(Date.now() + UPLOAD_INTENT_TTL_MS),
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

    const response = await objectStorageService.downloadObject(file);

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
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
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

    // --- Protected route example (uncomment when adding auth middleware) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile, 3600, objectPath);

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

async function canReadStoredObject(req: Request, objectPath: string): Promise<boolean> {
  const [venueMedia] = await db
    .select({
      id: venueMediaTable.id,
      venueSlug: venuesTable.slug,
      ownerEmail: venuesTable.ownerEmail,
    })
    .from(venueMediaTable)
    .innerJoin(venuesTable, eq(venueMediaTable.venueId, venuesTable.id))
    .where(eq(venueMediaTable.objectKey, objectPath))
    .limit(1);

  const ownerEmail = await getOwnerEmailFromRequest(req);

  if (venueMedia) {
    const publicVenueSlug = typeof req.query.venueSlug === "string" ? req.query.venueSlug : "";
    return canReadVenueMediaReference({
      publicVenueSlug,
      venueSlug: venueMedia.venueSlug,
      ownerEmail,
      venueOwnerEmail: venueMedia.ownerEmail,
    });
  }

  const shareToken = typeof req.query.shareToken === "string" ? req.query.shareToken : "";
  if (shareToken) {
    const [generated] = await db
      .select({
        id: generatedAssetsTable.id,
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

  if (!ownerEmail) return false;
  const [ownedGenerated] = await db
    .select({ id: generatedAssetsTable.id })
    .from(generatedAssetsTable)
    .innerJoin(coupleSessionsTable, eq(generatedAssetsTable.sessionId, coupleSessionsTable.id))
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .where(
      and(
        eq(generatedAssetsTable.objectKey, objectPath),
        eq(venuesTable.ownerEmail, ownerEmail),
      ),
    )
    .limit(1);
  if (ownedGenerated) return true;

  const [ownedCouple] = await db
    .select({ id: coupleMediaTable.id })
    .from(coupleMediaTable)
    .innerJoin(coupleSessionsTable, eq(coupleMediaTable.sessionId, coupleSessionsTable.id))
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .where(and(eq(coupleMediaTable.objectKey, objectPath), eq(venuesTable.ownerEmail, ownerEmail)))
    .limit(1);
  return !!ownedCouple;
}
