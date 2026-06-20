import {
  coupleMediaTable,
  coupleSessionsTable,
  db,
  generatedAssetsTable,
  venueMediaTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { refundCreditsForSession } from "./credits.js";
import { processGallerySession, userMessageForStillError } from "./galleryGeneration.js";
import { logger } from "./logger.js";
import { ObjectStorageService, assertNormalizedUploadObjectPath } from "./objectStorage.js";
import { assertReferenceImagesValid } from "./referenceImage.js";
import { findGalleryStyle } from "./galleryStyles.js";
import {
  isVenueMediaCoverage,
  VENUE_MEDIA_COVERAGES,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";

const storageService = new ObjectStorageService();
const MAX_VENUE_REFERENCES_FOR_GALLERY = 11;
type VenueMediaRow = typeof venueMediaTable.$inferSelect;

function extensionForMime(contentType: string): string {
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

async function uploadBufferToStorage(buffer: Buffer, contentType: string): Promise<string> {
  const uploadURL = await storageService.getObjectEntityUploadURL(
    extensionForMime(contentType),
  );
  const objectKey = storageService.normalizeObjectEntityPath(uploadURL);
  assertNormalizedUploadObjectPath(objectKey);

  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
    },
    body: buffer,
  });

  if (!res.ok) {
    throw new Error(`Storage upload failed with status ${res.status}: ${res.statusText}`);
  }

  return objectKey;
}

async function fetchObjectAsBuffer(objectKey: string): Promise<Buffer | null> {
  try {
    const file = await storageService.getObjectEntityFile(objectKey);
    const [content] = await file.download();
    return content as Buffer;
  } catch (err) {
    logger.warn({ err, objectKey }, "Failed to fetch object from storage");
    return null;
  }
}

function guessMimeType(objectKey: string): string {
  const lower = objectKey.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export function selectVenueMediaForGeneration(media: VenueMediaRow[]): VenueMediaRow[] {
  const selected: VenueMediaRow[] = [];
  const selectedIds = new Set<number>();

  for (const coverage of VENUE_MEDIA_COVERAGES) {
    const match = media.find((item) => item.coverage === coverage);
    if (match) {
      selected.push(match);
      selectedIds.add(match.id);
    }
  }

  for (const item of media) {
    if (selected.length >= MAX_VENUE_REFERENCES_FOR_GALLERY) break;
    if (selectedIds.has(item.id)) continue;
    selected.push(item);
    selectedIds.add(item.id);
  }

  return selected.slice(0, MAX_VENUE_REFERENCES_FOR_GALLERY);
}

export async function processSession(sessionId: number): Promise<void> {
  logger.info({ sessionId }, "Starting gallery generation pipeline");
  const generatedObjectKeys: string[] = [];

  try {
    const [claimed] = await db
      .update(coupleSessionsTable)
      .set({ status: "processing" })
      .where(
        and(
          eq(coupleSessionsTable.id, sessionId),
          eq(coupleSessionsTable.status, "pending"),
        ),
      )
      .returning();

    if (!claimed) {
      logger.info({ sessionId }, "Session already claimed or not pending; skipping");
      return;
    }

    const [session] = await db
      .select()
      .from(coupleSessionsTable)
      .where(eq(coupleSessionsTable.id, sessionId));

    if (!session) throw new Error(`Session ${sessionId} not found`);

    const style = findGalleryStyle(session.styleId);
    if (!style) {
      throw new Error(
        `Invalid or missing gallery style (${session.styleId ?? "none"}). Choose a style before generating.`,
      );
    }

    const venueMedia = await db
      .select()
      .from(venueMediaTable)
      .where(eq(venueMediaTable.venueId, session.venueId))
      .orderBy(venueMediaTable.displayOrder);

    const coupleMedia = await db
      .select()
      .from(coupleMediaTable)
      .where(eq(coupleMediaTable.sessionId, sessionId));

    if (coupleMedia.length === 0) {
      throw new Error("No couple photo uploaded; cannot generate gallery");
    }

    logger.info(
      { sessionId, count: coupleMedia.length, venuePhotos: venueMedia.length },
      "Fetching couple and venue photos",
    );

    const coupleBuffers = (
      await Promise.all(
        coupleMedia.slice(0, 3).map(async (media) => {
          const buffer = await fetchObjectAsBuffer(media.objectKey);
          return buffer ? { buffer, mimeType: guessMimeType(media.objectKey) } : null;
        }),
      )
    ).filter((x): x is { buffer: Buffer; mimeType: string } => x !== null);

    if (coupleBuffers.length === 0) {
      throw new Error("Failed to load any couple photo from storage");
    }

    const venueBuffers = (
      await Promise.all(
        selectVenueMediaForGeneration(venueMedia).map(async (media) => {
          const buffer = await fetchObjectAsBuffer(media.objectKey);
          return buffer
            ? {
                buffer,
                mimeType: guessMimeType(media.objectKey),
                coverage: isVenueMediaCoverage(media.coverage) ? media.coverage : null,
              }
            : null;
        }),
      )
    ).filter(
      (x): x is { buffer: Buffer; mimeType: string; coverage: VenueMediaCoverage | null } =>
        x !== null,
    );

    await assertReferenceImagesValid(coupleBuffers, venueBuffers);

    logger.info(
      {
        sessionId,
        styleId: style.id,
        styleName: style.name,
        couplePhotoCount: coupleBuffers.length,
        venuePhotoCount: venueBuffers.length,
      },
      "Starting strict reference-based gallery generation",
    );

    await processGallerySession({
      session,
      style,
      coupleBuffers,
      venueBuffers,
      uploadBuffer: async (buffer, contentType) => {
        const objectKey = await uploadBufferToStorage(buffer, contentType);
        generatedObjectKeys.push(objectKey);
        return objectKey;
      },
    });
    logger.info({ sessionId }, "Gallery pipeline complete");
  } catch (err) {
    logger.error({ err, sessionId }, "Gallery generation pipeline failed");

    const existingAssets = await db
      .select({ objectKey: generatedAssetsTable.objectKey })
      .from(generatedAssetsTable)
      .where(eq(generatedAssetsTable.sessionId, sessionId));
    const objectKeysToDelete = [
      ...new Set([...generatedObjectKeys, ...existingAssets.map((asset) => asset.objectKey)]),
    ];

    await db
      .delete(generatedAssetsTable)
      .where(eq(generatedAssetsTable.sessionId, sessionId));

    await Promise.all(
      objectKeysToDelete.map(async (objectKey) => {
        try {
          await storageService.deleteObjectEntity(objectKey);
        } catch (deleteErr) {
          logger.warn(
            { err: deleteErr, sessionId, objectKey },
            "Failed to delete partial gallery object after session failure",
          );
        }
      }),
    );

    await db
      .update(coupleSessionsTable)
      .set({
        status: "failed",
        errorMessage: userMessageForStillError(err),
        completedAt: new Date(),
      })
      .where(eq(coupleSessionsTable.id, sessionId));

    await refundCreditsForSession(sessionId);
  }
}
