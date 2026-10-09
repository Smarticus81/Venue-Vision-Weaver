import {
  coupleMediaTable,
  coupleSessionsTable,
  db,
  generatedAssetsTable,
  venueMediaTable,
  venuesTable,
  type CoupleSession,
} from "@workspace/db";
import { and, asc, eq, lt, notInArray, sql } from "drizzle-orm";
import { refundCreditsForSession } from "./credits.js";
import {
  GallerySceneFailureError,
  describeGalleryFailure,
  processGallerySession,
  type GalleryGenerationResult,
} from "./galleryGeneration.js";
import { logger } from "./logger.js";
import { ObjectStorageService, assertNormalizedUploadObjectPath } from "./objectStorage.js";
import { assertReferenceImagesValid } from "./referenceImage.js";
import { findGalleryStyle } from "./galleryStyles.js";
import {
  isVenueMediaCoverage,
  VENUE_MEDIA_COVERAGES,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";
import { GalleryStorageError } from "./stillImageErrors.js";
import {
  sendControlPlaneEmail,
  sendGalleryReadyNotification,
  sendGalleryToCouple,
  type EmailSendResult,
  type GalleryEmailOptions,
} from "./emailService.js";
import { recordGalleryEvent, type GalleryEventInput } from "./galleryEvents.js";
import { recordFunnelEvent, type FunnelEventInput } from "./funnelEvents.js";
import { bookingCtaFor } from "./venueResponse.js";
import { absoluteUrl } from "./appUrl.js";

const MAX_VENUE_REFERENCES_FOR_GALLERY = 11;
const MAX_COUPLE_REFERENCES = 3;
const STORAGE_TIMEOUT_MS = 60_000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type VenueMediaRow = typeof venueMediaTable.$inferSelect;
type VenueRow = typeof venuesTable.$inferSelect;

let storageService: ObjectStorageService | null = null;
function storage(): ObjectStorageService {
  storageService ??= new ObjectStorageService();
  return storageService;
}

function extensionForMime(contentType: string): string {
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function uploadBufferToStorage(buffer: Buffer, contentType: string): Promise<string> {
  const uploadURL = await storage().getObjectEntityUploadURL(
    extensionForMime(contentType),
  );
  const objectKey = storage().normalizeObjectEntityPath(uploadURL);
  assertNormalizedUploadObjectPath(objectKey);

  let res: Response;
  try {
    res = await fetch(uploadURL, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
      },
      body: buffer,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GalleryStorageError(
      `Storage upload failed before a response: ${err instanceof Error ? err.message : String(err)}`,
      objectKey,
      { cause: err },
    );
  }

  if (!res.ok) {
    throw new GalleryStorageError(`Storage upload failed with status ${res.status}: ${res.statusText}`, objectKey);
  }

  return objectKey;
}

/**
 * Read one stored object. A failure is a GalleryStorageError (never null):
 * a transient bucket outage must not read as "the couple uploaded too few
 * photos".
 */
async function fetchObjectAsBuffer(objectKey: string): Promise<Buffer> {
  try {
    const file = await storage().getObjectEntityFile(objectKey);
    const [content] = await withTimeout(
      file.download(),
      STORAGE_TIMEOUT_MS,
      () => new Error(`download timed out after ${STORAGE_TIMEOUT_MS}ms`),
    );
    return content as Buffer;
  } catch (err) {
    throw new GalleryStorageError(
      `Failed to read ${objectKey} from storage: ${err instanceof Error ? err.message : String(err)}`,
      objectKey,
      { cause: err },
    );
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

/* ---------------------------------------------------------------- failure */

export interface FailSessionDeps {
  /** processing -> failed; returns the row only when this call made the transition. */
  markFailed(sessionId: number, fields: { errorMessage: string; failureDetail: string }): Promise<CoupleSession | null>;
  /** Unconditional last resort when the guarded update itself threw. */
  forceFailed(sessionId: number, errorMessage: string): Promise<void>;
  refund(sessionId: number): Promise<boolean>;
  venueOrganizationId(venueId: number): Promise<number | null>;
  recordFunnelEvent(input: FunnelEventInput): Promise<void>;
}

/** Owner-facing failure detail, with which scenes were kept for a retry. */
export function failureDetailFor(err: unknown): string {
  const cause = err instanceof GallerySceneFailureError ? err.primary : err;
  const { detail } = describeGalleryFailure(cause);
  if (!(err instanceof GallerySceneFailureError)) return detail;
  const failed = err.scenes.filter((scene) => scene.status === "failed").map((scene) => scene.sceneId);
  const kept = err.scenes.length - failed.length;
  return `${detail} | scenes: ${kept} kept for retry, ${failed.length} failed (${failed.join(", ")})`.slice(0, 2000);
}

/**
 * Mark a session failed and refund its credit, exactly once. The update is
 * guarded on status=processing, so the worker deadline, the reaper and the
 * pipeline's own catch can all call this without double refunds; the first
 * caller wins. If the guarded update throws, an unconditional update is tried
 * so the couple never polls a "processing" gallery forever.
 */
export async function failSession(
  session: { id: number; venueId: number; kind?: string | null; startedAt?: Date | null },
  err: unknown,
  deps: FailSessionDeps = dbFailSessionDeps,
): Promise<boolean> {
  const cause = err instanceof GallerySceneFailureError ? err.primary : err;
  const failure = describeGalleryFailure(cause);
  const failureDetail = failureDetailFor(err);
  let failedRow: CoupleSession | null = null;
  try {
    failedRow = await deps.markFailed(session.id, { errorMessage: failure.coupleMessage, failureDetail });
  } catch (updateErr) {
    logger.error({ err: updateErr, sessionId: session.id }, "Guarded session failure update threw; forcing failed status");
    try {
      await deps.forceFailed(session.id, failure.coupleMessage);
    } catch (forceErr) {
      logger.error({ err: forceErr, sessionId: session.id }, "Could not mark session failed");
      return false;
    }
  }
  if (!failedRow) {
    // Someone else (deadline, reaper, startup cleanup) already finished it,
    // or the forced update ran: refund is idempotent, so still try it.
    try {
      await deps.refund(session.id);
    } catch (refundErr) {
      logger.error({ err: refundErr, sessionId: session.id }, "Refund after forced failure threw");
    }
    return false;
  }

  logger.warn(
    { sessionId: session.id, category: failure.category, detail: failureDetail },
    "Gallery session failed",
  );
  try {
    await deps.refund(session.id);
  } catch (refundErr) {
    logger.error({ err: refundErr, sessionId: session.id }, "Credit refund for failed session threw");
  }

  if ((failedRow.kind ?? session.kind ?? "couple") === "couple") {
    const organizationId = await deps.venueOrganizationId(session.venueId).catch(() => null);
    const startedAt = failedRow.startedAt ?? session.startedAt ?? null;
    await deps.recordFunnelEvent({
      organizationId,
      venueId: session.venueId,
      event: "session_failed",
      source: "server",
      properties: {
        sessionId: session.id,
        category: failure.category,
        durationMs: startedAt ? Date.now() - new Date(startedAt).getTime() : null,
      },
    });
  }
  return true;
}

export const dbFailSessionDeps: FailSessionDeps = {
  async markFailed(sessionId, fields) {
    const [row] = await db
      .update(coupleSessionsTable)
      .set({
        status: "failed",
        errorMessage: fields.errorMessage,
        failureDetail: fields.failureDetail,
        completedAt: new Date(),
      })
      .where(and(eq(coupleSessionsTable.id, sessionId), eq(coupleSessionsTable.status, "processing")))
      .returning();
    return row ?? null;
  },
  async forceFailed(sessionId, errorMessage) {
    await db
      .update(coupleSessionsTable)
      .set({ status: "failed", errorMessage, completedAt: new Date() })
      .where(and(eq(coupleSessionsTable.id, sessionId), notInArray(coupleSessionsTable.status, ["ready", "failed"])));
  },
  refund: (sessionId) => refundCreditsForSession(sessionId),
  async venueOrganizationId(venueId) {
    const [row] = await db
      .select({ organizationId: venuesTable.organizationId })
      .from(venuesTable)
      .where(eq(venuesTable.id, venueId));
    return row?.organizationId ?? null;
  },
  recordFunnelEvent,
};

/* --------------------------------------------------------------- delivery */

export interface DeliveryDeps {
  sendGalleryToCouple(
    coupleEmail: string,
    session: CoupleSession,
    venue: { name: string },
    options: GalleryEmailOptions,
  ): Promise<EmailSendResult>;
  notifyOwnerToReview(ownerEmail: string, session: CoupleSession, venue: { name: string }): Promise<void>;
  notifyOwnerDelivered(ownerEmail: string, session: CoupleSession, venue: { name: string; slug: string }): Promise<void>;
  recordGalleryEvent(input: GalleryEventInput): Promise<void>;
  recordFunnelEvent(input: FunnelEventInput): Promise<void>;
}

export type DeliveryHoldReason =
  | "sample"
  | "review_before_send"
  | "unjudged_frames"
  | "no_couple_email"
  | "email_not_sent";

export interface DeliveryOutcome {
  delivered: boolean;
  holdReason: DeliveryHoldReason | null;
}

type DeliveryVenue = Pick<
  VenueRow,
  "id" | "name" | "slug" | "ownerEmail" | "organizationId" | "reviewBeforeSend" | "bookingUrl" | "websiteUrl" | "contactEmail"
>;

/** Why a ready gallery must wait for the owner instead of auto-sending (null = send now). */
export function deliveryHoldReason(
  session: Pick<CoupleSession, "kind" | "coupleEmail">,
  venue: Pick<VenueRow, "reviewBeforeSend">,
  result: Pick<GalleryGenerationResult, "needsReview">,
): DeliveryHoldReason | null {
  if (session.kind === "sample") return "sample";
  if (venue.reviewBeforeSend) return "review_before_send";
  if (result.needsReview) return "unjudged_frames";
  if (!session.coupleEmail || !EMAIL_REGEX.test(session.coupleEmail.trim())) return "no_couple_email";
  return null;
}

/**
 * After a session turns ready: email the gallery to the couple with the
 * venue's date CTA (unless the venue reviews first, the gallery is an owner
 * sample, or a frame could not be judged), log the "sent" gallery event and
 * the session_ready funnel event. Sample galleries never email anyone and
 * never count in the funnel. Never throws.
 */
export async function deliverReadyGallery(
  session: CoupleSession,
  venue: DeliveryVenue,
  result: GalleryGenerationResult,
  deps: DeliveryDeps = defaultDeliveryDeps,
): Promise<DeliveryOutcome> {
  let holdReason = deliveryHoldReason(session, venue, result);
  if (holdReason === "sample") return { delivered: false, holdReason };

  let delivered = false;
  try {
    if (!holdReason) {
      const sent = await deps.sendGalleryToCouple(session.coupleEmail.trim(), session, venue, {
        venueName: venue.name,
        bookingCta: bookingCtaFor(venue, {
          weddingMonth: session.weddingMonth,
          coupleName: session.coupleName,
          medium: "email",
        }),
      });
      if (sent.sent) {
        delivered = true;
        await deps.recordGalleryEvent({
          sessionId: session.id,
          venueId: session.venueId,
          eventType: "sent",
          source: "system",
          meta: { auto: true },
        });
        await deps.notifyOwnerDelivered(venue.ownerEmail, session, venue);
      } else {
        logger.warn({ sessionId: session.id, reason: sent.reason }, "Automatic gallery email not sent; owner will send it");
        holdReason = "email_not_sent";
      }
    }
    if (holdReason) {
      await deps.notifyOwnerToReview(venue.ownerEmail, session, venue);
    }
  } catch (err) {
    logger.error({ err, sessionId: session.id }, "Gallery delivery step failed");
  }

  const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : null;
  await deps.recordFunnelEvent({
    organizationId: venue.organizationId,
    venueId: venue.id,
    event: "session_ready",
    source: "server",
    properties: {
      sessionId: session.id,
      delivered,
      holdReason,
      durationMs: startedAt ? Date.now() - startedAt : null,
      belowTargetFrames: result.belowTargetFrames,
      fallbackUsed: result.fallbackUsed,
      createdVia: session.createdVia,
    },
  });
  return { delivered, holdReason };
}

export const defaultDeliveryDeps: DeliveryDeps = {
  sendGalleryToCouple: (coupleEmail, session, venue, options) =>
    sendGalleryToCouple(coupleEmail, session, venue, options),
  notifyOwnerToReview: (ownerEmail, session, venue) => sendGalleryReadyNotification(ownerEmail, session, venue),
  async notifyOwnerDelivered(ownerEmail, session, venue) {
    const couple = session.coupleName?.trim() || "A couple";
    await sendControlPlaneEmail(ownerEmail, `Gallery sent – ${venue.name}`, [
      `The gallery for ${couple} at ${venue.name} is ready and was emailed to them with a link to check their date with you.`,
      `See it, and when they open it, on your dashboard: ${absoluteUrl(`/dashboard/${venue.slug}`)}`,
    ]);
  },
  recordGalleryEvent,
  recordFunnelEvent,
};

/* ---------------------------------------------------------------- session */

/** pending -> processing with started_at; null when someone else claimed it. */
async function claimSession(sessionId: number): Promise<CoupleSession | null> {
  const [claimed] = await db
    .update(coupleSessionsTable)
    .set({ status: "processing", startedAt: new Date(), errorMessage: null, failureDetail: null })
    .where(and(eq(coupleSessionsTable.id, sessionId), eq(coupleSessionsTable.status, "pending")))
    .returning();
  return claimed ?? null;
}

/**
 * Polished stills stored by an earlier run of this session (display orders
 * 1-4). A frame whose object can no longer be read is dropped so it renders
 * again.
 */
async function loadExistingFrames(sessionId: number): Promise<Map<number, Buffer>> {
  const rows = await db
    .select({
      objectKey: generatedAssetsTable.objectKey,
      displayOrder: generatedAssetsTable.displayOrder,
    })
    .from(generatedAssetsTable)
    .where(and(eq(generatedAssetsTable.sessionId, sessionId), eq(generatedAssetsTable.assetType, "image")));
  const frames = new Map<number, Buffer>();
  for (const row of rows) {
    try {
      frames.set(row.displayOrder, await fetchObjectAsBuffer(row.objectKey));
    } catch (err) {
      logger.warn({ err, sessionId, objectKey: row.objectKey }, "Kept gallery frame unreadable; rendering it again");
      await db
        .delete(generatedAssetsTable)
        .where(and(eq(generatedAssetsTable.sessionId, sessionId), eq(generatedAssetsTable.objectKey, row.objectKey)));
    }
  }
  return frames;
}

export interface ProcessSessionOptions {
  /** Aborted by the worker when SESSION_DEADLINE_MS passes. */
  signal?: AbortSignal;
}

export async function processSession(sessionId: number, options: ProcessSessionOptions = {}): Promise<void> {
  const { signal } = options;
  logger.info({ sessionId }, "Starting gallery generation pipeline");

  let claimed: CoupleSession | null;
  try {
    claimed = await claimSession(sessionId);
  } catch (err) {
    logger.error({ err, sessionId }, "Could not claim session");
    return;
  }
  if (!claimed) {
    logger.info({ sessionId }, "Session already claimed or not pending; skipping");
    return;
  }
  const session = claimed;

  try {
    const style = findGalleryStyle(session.styleId);
    if (!style) {
      throw new Error(
        `Invalid or missing gallery style (${session.styleId ?? "none"}). Choose a style before generating.`,
      );
    }

    const [venue] = await db.select().from(venuesTable).where(eq(venuesTable.id, session.venueId));
    if (!venue) throw new Error(`Venue ${session.venueId} not found for session ${sessionId}`);

    const venueMedia = await db
      .select()
      .from(venueMediaTable)
      .where(eq(venueMediaTable.venueId, session.venueId))
      .orderBy(venueMediaTable.displayOrder, venueMediaTable.id);

    // Prompt and judge roles are positional (photo 1 together, 2 partner A,
    // 3 partner B), so read the couple photos in upload order.
    const coupleMedia = await db
      .select()
      .from(coupleMediaTable)
      .where(eq(coupleMediaTable.sessionId, sessionId))
      .orderBy(asc(coupleMediaTable.id));

    logger.info(
      { sessionId, count: coupleMedia.length, venuePhotos: venueMedia.length },
      "Fetching couple and venue photos",
    );

    const coupleBuffers = await Promise.all(
      coupleMedia.slice(0, MAX_COUPLE_REFERENCES).map(async (media) => ({
        buffer: await fetchObjectAsBuffer(media.objectKey),
        mimeType: guessMimeType(media.objectKey),
      })),
    );

    const venueBuffers = await Promise.all(
      selectVenueMediaForGeneration(venueMedia).map(async (media) => ({
        buffer: await fetchObjectAsBuffer(media.objectKey),
        mimeType: guessMimeType(media.objectKey),
        coverage: (isVenueMediaCoverage(media.coverage) ? media.coverage : null) as VenueMediaCoverage | null,
      })),
    );

    await assertReferenceImagesValid(coupleBuffers, venueBuffers);
    signal?.throwIfAborted();

    const existingFrames = await loadExistingFrames(sessionId);
    logger.info(
      {
        sessionId,
        styleId: style.id,
        couplePhotoCount: coupleBuffers.length,
        venuePhotoCount: venueBuffers.length,
        keptFrames: existingFrames.size,
      },
      "Starting strict reference-based gallery generation",
    );

    const result = await processGallerySession({
      session,
      style,
      coupleBuffers,
      venueBuffers,
      venueName: venue.name,
      existingFrames,
      signal,
      uploadBuffer: uploadBufferToStorage,
      deleteObject: (objectKey) => storage().deleteObjectEntity(objectKey),
    });

    if (!result.readySession) {
      logger.warn({ sessionId }, "Gallery finished after the session was closed (deadline); nothing delivered");
      return;
    }
    await deliverReadyGallery(result.readySession, venue, result);
    logger.info({ sessionId }, "Gallery pipeline complete");
  } catch (err) {
    logger.error({ err, sessionId }, "Gallery generation pipeline failed");
    // Accepted frames stay stored (they are only exposed once the session is
    // ready), so a retry renders just the scenes that failed.
    await failSession(session, signal?.aborted && signal.reason ? signal.reason : err);
  }
}

/* ----------------------------------------------------------------- reaper */

/**
 * Fail (and refund) sessions stuck in processing since before `cutoff`,
 * skipping the ones this process is still working on. Keys on started_at,
 * falling back to created_at for rows claimed before started_at existed.
 */
export async function reapStaleSessions(cutoff: Date, excludeIds: number[], err: Error): Promise<number[]> {
  const startedOrCreated = sql`coalesce(${coupleSessionsTable.startedAt}, ${coupleSessionsTable.createdAt})`;
  const conditions = [eq(coupleSessionsTable.status, "processing"), lt(startedOrCreated, cutoff)];
  if (excludeIds.length > 0) conditions.push(notInArray(coupleSessionsTable.id, excludeIds));
  const stale = await db
    .select({
      id: coupleSessionsTable.id,
      venueId: coupleSessionsTable.venueId,
      kind: coupleSessionsTable.kind,
      startedAt: coupleSessionsTable.startedAt,
    })
    .from(coupleSessionsTable)
    .where(and(...conditions))
    .limit(50);
  const reaped: number[] = [];
  for (const row of stale) {
    if (await failSession(row, err)) reaped.push(row.id);
  }
  return reaped;
}

/** Pending session ids, oldest first. */
export async function listPendingSessionIds(limit: number): Promise<number[]> {
  const rows = await db
    .select({ id: coupleSessionsTable.id })
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.status, "pending"))
    .orderBy(asc(coupleSessionsTable.createdAt))
    .limit(limit);
  return rows.map((row) => row.id);
}
