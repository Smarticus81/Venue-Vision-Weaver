import { Router, type IRouter } from "express";
import crypto from "crypto";
import { eq, and, sql, ilike, gte, isNull } from "drizzle-orm";
import {
  db,
  coupleSessionsTable,
  coupleMediaTable,
  generatedAssetsTable,
  venuesTable,
  venueMediaTable,
  organizationsTable,
  creditTransactionsTable,
  uploadIntentsTable,
} from "@workspace/db";
import {
  CreateSessionParams,
  CreateSessionBody,
  GetSessionParams,
  ListVenueSessionsParams,
} from "@workspace/api-zod";
import { estimateSessionCostUsd } from "../lib/cost.js";
import {
  creditsForSession,
  countVenueSessionsToday,
  hasSufficientCredits,
  VENUE_DAILY_SESSION_CAP,
  MIN_VENUE_PHOTOS,
  toPublicVenue,
} from "../lib/credits.js";
import {
  sendSessionCreatedNotification,
  sendGalleryToCouple,
  sendRecoveryEmail,
} from "../lib/emailService.js";
import { logger } from "../lib/logger.js";
import { rateLimit, clientKey } from "../lib/rateLimit.js";
import { requireOrgVenue } from "../lib/orgAuth.js";
import {
  mimeTypeFromObjectPath,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage.js";
import {
  assertReferenceImageQuality,
  hammingDistance,
  type ReferenceImageQuality,
} from "../lib/referenceImageQuality.js";
import {
  canExposeGeneratedAssetsToSharePage,
  hasCompletePublicGalleryAssets,
} from "../lib/sessionVisibility.js";
import { findGalleryStyle } from "../lib/galleryStyles.js";

const router: IRouter = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_COUPLE_PHOTOS = 1;
const MAX_COUPLE_PHOTOS = 3;
const MIN_COUPLE_PHOTO_EDGE_PX = 256;
const MAX_COUPLE_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_STYLE_ID = "cinematic-editorial";
const objectStorageService = new ObjectStorageService();
const ALLOWED_COUPLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STALE_UPLOAD_INTENT_ERROR = "STALE_UPLOAD_INTENT";

function buildSessionDetailPayload(session: typeof coupleSessionsTable.$inferSelect, venue: typeof venuesTable.$inferSelect | undefined, venueMedia: Array<typeof venueMediaTable.$inferSelect>, generatedAssets: Array<typeof generatedAssetsTable.$inferSelect>, options: { includeEmail: boolean }) {
  const base = {
    id: session.id,
    venueId: session.venueId,
    status: session.status,
    errorMessage: session.errorMessage,
    styleId: session.styleId,
    coupleName: session.coupleName,
    hasCoupleEmail: !!session.coupleEmail,
    shareToken: session.shareToken,
    ...(options.includeEmail
      ? {
          estimatedCostUsd: estimateSessionCostUsd(),
        }
      : {}),
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    venue: venue ? toPublicVenue(venue, venueMedia) : null,
    generatedAssets,
  };
  if (options.includeEmail) {
    return { ...base, coupleEmail: session.coupleEmail };
  }
  return base;
}

async function assertUploadIntentAvailable(
  objectKey: string,
  venueId: number,
  purpose: "venue" | "couple",
): Promise<void> {
  const [intent] = await db
    .select({ id: uploadIntentsTable.id })
    .from(uploadIntentsTable)
    .where(
      and(
        eq(uploadIntentsTable.objectKey, objectKey),
        eq(uploadIntentsTable.venueId, venueId),
        eq(uploadIntentsTable.purpose, purpose),
        isNull(uploadIntentsTable.consumedAt),
        gte(uploadIntentsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!intent) {
    throw new Error("This upload is no longer valid. Upload the photo again.");
  }
}

async function validateCouplePhotoObjectKeys(objectKeys: string[], venueId: number): Promise<void> {
  const seen = new Set<string>();
  const qualities: ReferenceImageQuality[] = [];

  for (const [index, objectKey] of objectKeys.entries()) {
    if (seen.has(objectKey)) {
      throw new Error(`Couple photo ${index + 1} is duplicated. Upload distinct reference photos.`);
    }
    seen.add(objectKey);

    if (!objectKey.startsWith("/objects/uploads/")) {
      throw new Error(`Couple photo ${index + 1} is not a valid uploaded object.`);
    }
    await assertUploadIntentAvailable(objectKey, venueId, "couple");

    try {
      const file = await objectStorageService.getObjectEntityFile(objectKey);
      const [buffer] = await file.download();
      if (buffer.length > MAX_COUPLE_UPLOAD_BYTES) {
        throw new Error(`Couple photo ${index + 1} is too large. Upload images up to 50MB.`);
      }

      const metadata = await file.getMetadata().catch(() => null);
      const contentType =
        metadata?.contentType && metadata.contentType !== "application/octet-stream"
          ? metadata.contentType
          : mimeTypeFromObjectPath(objectKey);
      if (!ALLOWED_COUPLE_IMAGE_TYPES.has(contentType)) {
        throw new Error(`Couple photo ${index + 1} must be a JPG, PNG, or WebP image.`);
      }

      const quality = await assertReferenceImageQuality({
        buffer,
        label: `Couple photo ${index + 1}`,
        minEdgePx: MIN_COUPLE_PHOTO_EDGE_PX,
        profile: "couple",
      });
      qualities.push(quality);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        throw new Error(`Couple photo ${index + 1} was not found. Upload the photo again.`);
      }
      throw err;
    }
  }

  for (let i = 0; i < qualities.length; i++) {
    for (let j = i + 1; j < qualities.length; j++) {
      if (hammingDistance(qualities[i]!.perceptualHash, qualities[j]!.perceptualHash) <= 2) {
        throw new Error(
          `Couple photos ${i + 1} and ${j + 1} look nearly identical. Upload distinct angles or expressions for better likeness.`,
        );
      }
    }
  }
}

async function hasReadyEmailGalleryBundle(sessionId: number): Promise<boolean> {
  const assets = await db
    .select({
      assetType: generatedAssetsTable.assetType,
      displayOrder: generatedAssetsTable.displayOrder,
    })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId));
  return hasCompletePublicGalleryAssets(assets);
}

async function readyGalleryThumbnailObjectKey(sessionId: number, status: string): Promise<string | null> {
  if (status !== "ready") return null;
  const assets = await db
    .select({
      objectKey: generatedAssetsTable.objectKey,
      assetType: generatedAssetsTable.assetType,
      displayOrder: generatedAssetsTable.displayOrder,
    })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId))
    .orderBy(generatedAssetsTable.displayOrder);
  if (!hasCompletePublicGalleryAssets(assets)) return null;
  return assets.find((asset) => asset.assetType === "image" && asset.displayOrder === 1)?.objectKey ?? null;
}

// POST /venues/:slug/sessions
router.post("/venues/:slug/sessions", async (req, res): Promise<void> => {
  const params = CreateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (!body.data.coupleEmail || !EMAIL_REGEX.test(body.data.coupleEmail.trim())) {
    res.status(400).json({ error: "A valid couple email is required" });
    return;
  }

  const [venue] = await db
    .select({
      id: venuesTable.id,
      name: venuesTable.name,
      ownerEmail: venuesTable.ownerEmail,
      creditsBalance: venuesTable.creditsBalance,
      organizationId: venuesTable.organizationId,
    })
    .from(venuesTable)
    .where(eq(venuesTable.slug, params.data.slug));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  if (
    body.data.couplePhotoKeys.length < MIN_COUPLE_PHOTOS ||
    body.data.couplePhotoKeys.length > MAX_COUPLE_PHOTOS
  ) {
    res.status(400).json({
      error: `Upload ${MIN_COUPLE_PHOTOS}-${MAX_COUPLE_PHOTOS} clear couple photos for best likeness.`,
    });
    return;
  }

  try {
    await validateCouplePhotoObjectKeys(body.data.couplePhotoKeys, venue.id);
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : "One or more couple photos are invalid. Upload clear images again.",
    });
    return;
  }

  const styleId = body.data.styleId ?? DEFAULT_STYLE_ID;
  if (!findGalleryStyle(styleId)) {
    res.status(400).json({ error: "Choose a valid gallery style." });
    return;
  }

  const neededCredits = creditsForSession();

  const todayCount = await countVenueSessionsToday(venue.id);
  if (todayCount >= VENUE_DAILY_SESSION_CAP) {
    res.status(429).json({
      error: "This venue has reached its daily preview limit. Please try again tomorrow.",
    });
    return;
  }

  const hasCredits = await hasSufficientCredits(venue.id, neededCredits);
  if (!hasCredits) {
    res.status(402).json({
      error: "No credits remaining. Ask the venue to add credits.",
    });
    return;
  }

  // Refuse to create a session if the venue has no media. The AI prompt is
  // built from the venue's photos, so generation against an empty venue is
  // either nonsensical or will outright fail downstream - block it here with
  // a friendly message so the couple isn't charged time/cost on a doomed run.
  const venueMediaForReadiness = await db
    .select({ coverage: venueMediaTable.coverage })
    .from(venueMediaTable)
    .where(eq(venueMediaTable.venueId, venue.id));
  const venueMediaCount = venueMediaForReadiness.length;

  if (!venueMediaCount || venueMediaCount < MIN_VENUE_PHOTOS) {
    res.status(409).json({
      error:
        `This venue isn't ready yet. The owner needs to upload at least ${MIN_VENUE_PHOTOS} venue photo${MIN_VENUE_PHOTOS === 1 ? "" : "s"} before couples can create a gallery.`,
    });
    return;
  }

  // Per-IP creation rate limit: 10 sessions / hour
  if (!rateLimit(`create:${clientKey(req)}`, 10, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many sessions from this address. Try again later." });
    return;
  }

  const normalizedEmail = body.data.coupleEmail.trim().toLowerCase();

  let session: typeof coupleSessionsTable.$inferSelect | null = null;
  try {
    session = await db.transaction(async (tx) => {
      // Credits are debited from the billing organization when the venue has
      // one; legacy venues (not yet adopted) draw from their own balance.
      if (venue.organizationId != null) {
        const [updatedCredits] = await tx
          .update(organizationsTable)
          .set({ creditsBalance: sql`${organizationsTable.creditsBalance} - ${neededCredits}` })
          .where(
            and(
              eq(organizationsTable.id, venue.organizationId),
              gte(organizationsTable.creditsBalance, neededCredits),
            ),
          )
          .returning({ creditsBalance: organizationsTable.creditsBalance });
        if (!updatedCredits) {
          return null;
        }
      } else {
        const [updatedCredits] = await tx
          .update(venuesTable)
          .set({ creditsBalance: sql`${venuesTable.creditsBalance} - ${neededCredits}` })
          .where(and(eq(venuesTable.id, venue.id), gte(venuesTable.creditsBalance, neededCredits)))
          .returning({ creditsBalance: venuesTable.creditsBalance });
        if (!updatedCredits) {
          return null;
        }
      }

      for (const objectKey of body.data.couplePhotoKeys) {
        const [intent] = await tx
          .update(uploadIntentsTable)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(uploadIntentsTable.objectKey, objectKey),
              eq(uploadIntentsTable.venueId, venue.id),
              eq(uploadIntentsTable.purpose, "couple"),
              isNull(uploadIntentsTable.consumedAt),
              gte(uploadIntentsTable.expiresAt, new Date()),
            ),
          )
          .returning({ id: uploadIntentsTable.id });
        if (!intent) {
          throw new Error(STALE_UPLOAD_INTENT_ERROR);
        }
      }

      const [created] = await tx
        .insert(coupleSessionsTable)
        .values({
          venueId: venue.id,
          status: "pending",
          styleId,
          coupleName: body.data.coupleName?.trim() || null,
          coupleEmail: normalizedEmail,
          shareToken: crypto.randomUUID(),
          creditsCharged: neededCredits,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create gallery session.");
      }

      await tx.insert(coupleMediaTable).values(
        body.data.couplePhotoKeys.map((key) => ({
          sessionId: created.id,
          objectKey: key,
        })),
      );

      await tx.insert(creditTransactionsTable).values({
        organizationId: venue.organizationId,
        venueId: venue.id,
        delta: -neededCredits,
        reason: "session_debit",
        sessionId: created.id,
      });

      return created;
    });
  } catch (err) {
    if (err instanceof Error && err.message === STALE_UPLOAD_INTENT_ERROR) {
      res.status(409).json({ error: "One of these uploads was already used or expired. Upload the photos again." });
      return;
    }
    throw err;
  }

  if (!session) {
    res.status(402).json({
      error: "No credits remaining. Ask the venue to add credits.",
    });
    return;
  }

  void sendSessionCreatedNotification(venue.ownerEmail, session, venue);

  res.status(201).json({
    id: session.id,
    venueId: session.venueId,
    status: session.status,
    shareToken: session.shareToken,
    createdAt: session.createdAt,
  });
});

// GET /sessions/:id  (owner session)
router.get("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select()
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.id, params.data.id));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const ownerVenue = await requireOrgVenue(req, res, venue.slug);
  if (!ownerVenue) return;

  const venueMedia = venue
    ? await db
        .select()
        .from(venueMediaTable)
        .where(eq(venueMediaTable.venueId, venue.id))
        .orderBy(venueMediaTable.displayOrder)
    : [];

  const generatedAssets = await db
    .select()
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, session.id))
    .orderBy(generatedAssetsTable.displayOrder);

  res.json(buildSessionDetailPayload(session, venue, venueMedia, generatedAssets, { includeEmail: true }));
});

// DELETE /sessions/:id  (owner session)
router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const sessionId = params.data.id;

  const [session] = await db
    .select({ id: coupleSessionsTable.id, venueId: coupleSessionsTable.venueId })
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [venue] = await db
    .select({ slug: venuesTable.slug })
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));
  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const ownerVenue = await requireOrgVenue(req, res, venue.slug);
  if (!ownerVenue) return;

  const generated = await db
    .select({ objectKey: generatedAssetsTable.objectKey })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId));
  const coupleMedia = await db
    .select({ objectKey: coupleMediaTable.objectKey })
    .from(coupleMediaTable)
    .where(eq(coupleMediaTable.sessionId, sessionId));

  // couple_media and generated_assets cascade with the session row;
  // credit_transactions keep their history with session_id set null.
  await db.delete(coupleSessionsTable).where(eq(coupleSessionsTable.id, sessionId));

  // Storage cleanup is best-effort after the DB delete: a leftover object is
  // unreachable (no DB row grants read access), while a failed delete must
  // not resurrect the session.
  for (const { objectKey } of [...generated, ...coupleMedia]) {
    try {
      await objectStorageService.deleteObjectEntity(objectKey);
    } catch (err) {
      req.log.warn({ err, sessionId, objectKey }, "Failed to delete stored object for removed session");
    }
  }

  res.json({ deleted: true });
});

// GET /sessions/by-token/:shareToken  (public read, never returns email)
router.get("/sessions/by-token/:shareToken", async (req, res): Promise<void> => {
  const { shareToken } = req.params;
  if (!shareToken || shareToken.length < 16) {
    res.status(400).json({ error: "Share token required" });
    return;
  }

  const [session] = await db
    .select()
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.shareToken, shareToken));

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));

  const venueMedia = venue
    ? await db
        .select()
        .from(venueMediaTable)
        .where(eq(venueMediaTable.venueId, venue.id))
        .orderBy(venueMediaTable.displayOrder)
    : [];

  const generatedAssets = canExposeGeneratedAssetsToSharePage(session.status)
    ? await db
        .select()
        .from(generatedAssetsTable)
        .where(eq(generatedAssetsTable.sessionId, session.id))
        .orderBy(generatedAssetsTable.displayOrder)
    : [];
  const publicGeneratedAssets = hasCompletePublicGalleryAssets(generatedAssets)
    ? generatedAssets
    : [];

  res.json(buildSessionDetailPayload(session, venue, venueMedia, publicGeneratedAssets, { includeEmail: false }));
});


// GET /venues/:slug/sessions (owner session)
router.get("/venues/:slug/sessions", async (req, res): Promise<void> => {
  const params = ListVenueSessionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  const sessions = await db
    .select({
      id: coupleSessionsTable.id,
      venueId: coupleSessionsTable.venueId,
      status: coupleSessionsTable.status,
      coupleName: coupleSessionsTable.coupleName,
      coupleEmail: coupleSessionsTable.coupleEmail,
      shareToken: coupleSessionsTable.shareToken,
      createdAt: coupleSessionsTable.createdAt,
      completedAt: coupleSessionsTable.completedAt,
    })
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.venueId, venue.id))
    .orderBy(sql`${coupleSessionsTable.createdAt} desc`);

  const sessionsWithThumbnails = await Promise.all(
    sessions.map(async (session) => {
      const thumbnailObjectKey = await readyGalleryThumbnailObjectKey(session.id, session.status);
      return {
        ...session,
        thumbnailObjectKey,
        estimatedCostUsd: estimateSessionCostUsd(),
      };
    })
  );

  res.json({ sessions: sessionsWithThumbnails });
});

// POST /sessions/recover  (magic-link recovery; never reveals if email exists)
router.post("/sessions/recover", async (req, res): Promise<void> => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_REGEX.test(email)) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  // Rate-limit BOTH per IP and per email so a single attacker can't enumerate
  // and a single inbox can't get spammed. 3 / 15 minutes each.
  const windowMs = 15 * 60 * 1000;
  const ipOk = rateLimit(`recover:ip:${clientKey(req)}`, 5, windowMs);
  const emailOk = rateLimit(`recover:email:${email}`, 3, windowMs);

  const respond = (): void => {
    res.json({ accepted: true });
  };

  if (!ipOk || !emailOk) {
    respond();
    return;
  }

  try {
    const rows = await db
      .select({
        id: coupleSessionsTable.id,
        status: coupleSessionsTable.status,
        coupleName: coupleSessionsTable.coupleName,
        shareToken: coupleSessionsTable.shareToken,
        createdAt: coupleSessionsTable.createdAt,
        venueName: venuesTable.name,
      })
      .from(coupleSessionsTable)
      .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
      .where(ilike(coupleSessionsTable.coupleEmail, email))
      .orderBy(sql`${coupleSessionsTable.createdAt} desc`)
      .limit(50);

    if (rows.length > 0) {
      void sendRecoveryEmail(email, rows);
    }
  } catch (err) {
    logger.error({ err }, "recovery lookup failed");
  }

  respond();
});

// POST /sessions/:id/send-email  (owner-only, can override recipient)
router.post("/sessions/:id/send-email", async (req, res): Promise<void> => {
  const sessionId = Number(req.params.id);
  if (Number.isNaN(sessionId)) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  const [session] = await db
    .select()
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (!rateLimit(`send:owner:${session.venueId}`, 30, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Owner send-email rate limit reached. Try again later." });
    return;
  }

  const override = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const recipient = override || session.coupleEmail || "";
  if (!recipient || !EMAIL_REGEX.test(recipient)) {
    res.status(400).json({ error: "Provide a valid email address." });
    return;
  }

  const [venue] = await db
    .select({ name: venuesTable.name, slug: venuesTable.slug })
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const ownerVenue = await requireOrgVenue(req, res, venue.slug);
  if (!ownerVenue) return;

  if (session.status !== "ready" || !(await hasReadyEmailGalleryBundle(session.id))) {
    res.status(409).json({ error: "This gallery is not ready to email yet." });
    return;
  }

  // If the owner provided a recipient that wasn't already stored, persist it
  // so subsequent sends/notifications hit the same address.
  if (override && override.toLowerCase() !== (session.coupleEmail ?? "").toLowerCase()) {
    await db
      .update(coupleSessionsTable)
      .set({ coupleEmail: override.toLowerCase() })
      .where(eq(coupleSessionsTable.id, session.id));
  }

  const sent = await sendGalleryToCouple(recipient, session, venue);
  res.json({ sent });
});

// POST /sessions/by-token/:shareToken/send-email  (couple-driven, no third-party override)
router.post("/sessions/by-token/:shareToken/send-email", async (req, res): Promise<void> => {
  const { shareToken } = req.params;
  if (!shareToken || shareToken.length < 16) {
    res.status(400).json({ error: "Share token required" });
    return;
  }

  const [session] = await db
    .select()
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.shareToken, shareToken));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  if (session.status !== "ready" || !(await hasReadyEmailGalleryBundle(session.id))) {
    res.status(409).json({ error: "This gallery is not ready to email yet." });
    return;
  }

  if (!rateLimit(`send:token:${shareToken}`, 5, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many send requests for this session. Try again later." });
    return;
  }

  const proposed = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const onFile = (session.coupleEmail ?? "").toLowerCase();

  let recipient = "";
  if (onFile) {
    if (proposed && proposed !== onFile) {
      // Refuse silent third-party sends; this is a guess-and-spam vector.
      res.status(400).json({ error: "This session is tied to a different email on file." });
      return;
    }
    recipient = onFile;
  } else {
    if (!proposed || !EMAIL_REGEX.test(proposed)) {
      res.status(400).json({ error: "Provide a valid email address." });
      return;
    }
    recipient = proposed;
    await db
      .update(coupleSessionsTable)
      .set({ coupleEmail: recipient })
      .where(eq(coupleSessionsTable.id, session.id));
  }

  const [venue] = await db
    .select({ name: venuesTable.name })
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const sent = await sendGalleryToCouple(recipient, session, venue);
  res.json({ sent });
});

export default router;
