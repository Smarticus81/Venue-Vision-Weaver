import crypto from "crypto";
import { Router, type IRouter } from "express";
import { eq, and, sql, gte, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  venuesTable,
  venueMediaTable,
  coupleSessionsTable,
  generatedAssetsTable,
  organizationsTable,
  uploadIntentsTable,
  coupleMediaTable,
} from "@workspace/db";
import {
  CreateVenueBody,
  GetVenueParams,
  GetVenueDashboardParams,
  ListVenueMediaParams,
  AddVenueMediaParams,
  AddVenueMediaBody,
  DeleteVenueMediaParams,
  UpdateVenueParams,
  UpdateVenueBody,
  SetSessionBookedParams,
  SetSessionBookedBody,
  ImportVenueWebsiteMediaParams,
  ImportVenueWebsiteMediaBody,
  CreateSampleGalleryParams,
  MarkTourCardDownloadedParams,
} from "@workspace/api-zod";
import { rateLimit, clientKey } from "../lib/rateLimit.js";
import {
  mimeTypeFromObjectPath,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage.js";
import {
  requireOrg,
  requireOrgAdmin,
  requireOrgVenue,
  requireOrgVenueContext,
  requireOwnerMutationOrigin,
} from "../lib/orgAuth.js";
import { createCoupleUploadToken } from "../lib/uploadToken.js";
import {
  assertReferenceImageQuality,
  hammingDistance,
  MIN_REFERENCE_EDGE_PX,
  type ReferenceImageQuality,
} from "../lib/referenceImageQuality.js";
import { ownerVenueResponse, toPublicVenue } from "../lib/venueResponse.js";
import { hasCompletePublicGalleryAssets } from "../lib/sessionVisibility.js";
import { onVenueCreated } from "../control-plane/growth/hooks.js";
import { logger } from "../lib/logger.js";
import { galleryStatsForSessions, recordGalleryEvent, type SessionGalleryStats } from "../lib/galleryEvents.js";
import { recordFunnelEvent } from "../lib/funnelEvents.js";
import { defaultWebsiteImportDeps, importWebsiteMedia, IMPORT_LIMITS } from "../lib/websiteMediaImport.js";
import { defaultSamplePhotoDeps, prepareSamplePhotos, SAMPLE_COUPLE_NAME } from "../lib/sampleGallery.js";
import {
  appendDisplayOrders,
  MAX_SAMPLES_PER_VENUE,
  markTourCardDownloaded,
  normalizeIncentiveText,
  ownerActor,
  planWebsiteImport,
  setSessionBooked,
  startSampleGallery,
  type BookedStore,
  type SampleCounts,
  type SampleGalleryDeps,
  type TourCardStore,
} from "../lib/venueSetup.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_VENUE_PHOTO_EDGE_PX = MIN_REFERENCE_EDGE_PX;
const MAX_VENUE_UPLOAD_BYTES = 50 * 1024 * 1024;
const VENUE_NEAR_DUPLICATE_HASH_DISTANCE = 2;
const ALLOWED_VENUE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const objectStorageService = new ObjectStorageService();

function normalizeNullableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}

function normalizeNullableEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const email = value?.trim().toLowerCase() || "";
  if (!email) return null;
  if (!EMAIL_REGEX.test(email)) {
    throw new Error("Invalid public contact email address");
  }
  return email;
}

function normalizeNullableUrl(value: string | null | undefined, label: string): string | null | undefined {
  if (value === undefined) return undefined;
  const raw = value?.trim() || "";
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
    return url.toString();
  } catch {
    throw new Error(`${label} must be a valid http or https URL`);
  }
}

const router: IRouter = Router();

async function validateVenueMediaObjectKey(objectKey: string, label = "Venue photo"): Promise<ReferenceImageQuality> {
  if (!objectKey.startsWith("/objects/uploads/")) {
    throw new Error("Venue photo is not a valid uploaded object.");
  }

  try {
    const file = await objectStorageService.getObjectEntityFile(objectKey);
    const [buffer] = await file.download();
    if (buffer.length > MAX_VENUE_UPLOAD_BYTES) {
      throw new Error(`${label} is too large. Upload images up to 50MB.`);
    }

    const metadata = await file.getMetadata().catch(() => null);
    const contentType =
      metadata?.contentType && metadata.contentType !== "application/octet-stream"
        ? metadata.contentType
        : mimeTypeFromObjectPath(objectKey);
    if (!ALLOWED_VENUE_IMAGE_TYPES.has(contentType)) {
      throw new Error(`${label} must be a JPG, PNG, or WebP image.`);
    }

    return await assertReferenceImageQuality({
      buffer,
      label,
      minEdgePx: MIN_VENUE_PHOTO_EDGE_PX,
      profile: "venue",
    });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      throw new Error(`${label} was not found. Upload it again.`);
    }
    throw err;
  }
}

async function assertVenueMediaDistinct(
  venueId: number,
  objectKey: string,
  newQuality: ReferenceImageQuality,
): Promise<void> {
  const existingMedia = await db
    .select({ objectKey: venueMediaTable.objectKey })
    .from(venueMediaTable)
    .where(eq(venueMediaTable.venueId, venueId));

  for (const [index, media] of existingMedia.entries()) {
    if (media.objectKey === objectKey) continue;
    const existingQuality = await validateVenueMediaObjectKey(
      media.objectKey,
      `Existing venue photo ${index + 1}`,
    );
    if (
      hammingDistance(newQuality.perceptualHash, existingQuality.perceptualHash) <=
      VENUE_NEAR_DUPLICATE_HASH_DISTANCE
    ) {
      throw new Error(
        `This venue photo looks nearly identical to existing venue photo ${index + 1}. Upload a different exterior, ceremony, reception, detail, or natural-light view.`,
      );
    }
  }
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

/** Columns behind a SessionSummary row (dashboard list and the booked toggle). */
const sessionSummaryColumns = {
  id: coupleSessionsTable.id,
  venueId: coupleSessionsTable.venueId,
  status: coupleSessionsTable.status,
  coupleName: coupleSessionsTable.coupleName,
  coupleEmail: coupleSessionsTable.coupleEmail,
  shareToken: coupleSessionsTable.shareToken,
  createdAt: coupleSessionsTable.createdAt,
  completedAt: coupleSessionsTable.completedAt,
  kind: coupleSessionsTable.kind,
  createdVia: coupleSessionsTable.createdVia,
  weddingMonth: coupleSessionsTable.weddingMonth,
  firstViewedAt: coupleSessionsTable.firstViewedAt,
  viewCount: coupleSessionsTable.viewCount,
  ctaClicks: coupleSessionsTable.ctaClicks,
  bookedAt: coupleSessionsTable.bookedAt,
  bookedBy: coupleSessionsTable.bookedBy,
};

type SessionSummarySource = NonNullable<Awaited<ReturnType<typeof loadSummaryRow>>>;

async function toSessionSummary(row: SessionSummarySource, stats?: SessionGalleryStats) {
  const { bookedBy: _bookedBy, ...summary } = row;
  return {
    ...summary,
    thumbnailObjectKey: await readyGalleryThumbnailObjectKey(row.id, row.status),
    emailedAt: stats?.emailedAt ?? null,
    sharedCount: stats?.sharedCount ?? 0,
  };
}

async function uniqueVenueSlug(baseSlug: string): Promise<string> {
  const normalizedBase = baseSlug.replace(/-+$/, "") || "venue";
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? normalizedBase : `${normalizedBase}-${suffix + 1}`;
    const [existing] = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(eq(venuesTable.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  return `${normalizedBase}-${Date.now().toString(36)}`;
}

// POST /venues — create a venue inside the caller's organization. Auth and
// billing are organization-level (Clerk); no per-venue credentials exist.
router.post("/venues", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;

  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  const parsed = CreateVenueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    name,
    slug,
    tagline,
    description,
    ownerEmail,
    contactEmail,
    contactPhone,
    websiteUrl,
    bookingUrl,
  } = parsed.data;

  const normalizedOwnerEmail = ownerEmail?.trim().toLowerCase() ?? "";
  if (!normalizedOwnerEmail || !EMAIL_REGEX.test(normalizedOwnerEmail)) {
    res.status(400).json({ error: "Owner email is required" });
    return;
  }

  let normalizedContactEmail: string | null | undefined;
  let normalizedWebsiteUrl: string | null | undefined;
  let normalizedBookingUrl: string | null | undefined;
  try {
    normalizedContactEmail = normalizeNullableEmail(contactEmail);
    normalizedWebsiteUrl = normalizeNullableUrl(websiteUrl, "Website URL");
    normalizedBookingUrl = normalizeNullableUrl(bookingUrl, "Booking URL");
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid contact details" });
    return;
  }

  const trimmedName = name.trim();

  const [existingOrgVenue] = await db
    .select({ id: venuesTable.id, slug: venuesTable.slug })
    .from(venuesTable)
    .where(
      and(
        eq(venuesTable.organizationId, ctx.org.id),
        sql`lower(${venuesTable.name}) = ${trimmedName.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (existingOrgVenue) {
    res.status(409).json({
      error: "A venue with this name already exists in your organization.",
    });
    return;
  }

  const internalSlug = await uniqueVenueSlug(slug);

  let venue;
  try {
    const [createdVenue] = await db
      .insert(venuesTable)
      .values({
        organizationId: ctx.org.id,
        name: trimmedName,
        slug: internalSlug,
        tagline: tagline ?? null,
        description: description ?? null,
        ownerEmail: normalizedOwnerEmail,
        contactEmail: normalizedContactEmail ?? null,
        contactPhone: normalizeNullableText(contactPhone) ?? null,
        websiteUrl: normalizedWebsiteUrl ?? null,
        bookingUrl: normalizedBookingUrl ?? null,
        // Billing lives on the organization; venue-level plan/credits stay zeroed.
        plan: "trial",
        creditsBalance: 0,
      })
      .returning();

    if (!createdVenue) {
      throw new Error("Failed to create venue.");
    }
    venue = createdVenue;
    // Growth hook (shared-contract 4.6): attribution sweep etc. Never blocks the request.
    void onVenueCreated(ctx.org.id).catch((hookErr) =>
      logger.warn({ err: hookErr, orgId: ctx.org.id }, "post-create growth hook failed"),
    );
  } catch (err) {
    const pgError = err instanceof Error ? (err.cause as { code?: string; detail?: string; message?: string }) : null;
    logger.error({ err, pgCode: pgError?.code, pgDetail: pgError?.detail, pgMessage: pgError?.message }, "Failed to insert venue");
    if (pgError?.code === "23505") {
      res.status(409).json({ error: "This venue already exists." });
      return;
    }
    if (pgError?.code === "42P01") {
      res.status(503).json({
        error: "Database schema needs to be updated. Run pnpm run setup:db or apply supabase/bootstrap.sql.",
      });
      return;
    }
    res.status(500).json({ error: "Failed to create venue. Please try again." });
    return;
  }

  res.status(201).json(ownerVenueResponse(venue, ctx.org));
});

// GET /venues/:slug (public)
router.get("/venues/:slug", async (req, res): Promise<void> => {
  const params = GetVenueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.slug, params.data.slug));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const media = await db
    .select()
    .from(venueMediaTable)
    .where(eq(venueMediaTable.venueId, venue.id))
    .orderBy(venueMediaTable.displayOrder);

  res.json({
    ...toPublicVenue(venue, media),
    uploadToken: createCoupleUploadToken(venue.slug),
  });
});

// PATCH /venues/:slug  (owner-only)
router.patch("/venues/:slug", async (req, res): Promise<void> => {
  const params = UpdateVenueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  const body = UpdateVenueBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Partial<typeof venuesTable.$inferInsert> = {};
  if (body.data.name !== undefined) {
    const trimmed = body.data.name.trim();
    if (!trimmed) {
      res.status(400).json({ error: "Name cannot be empty" });
      return;
    }
    updates.name = trimmed;
  }
  if (body.data.tagline !== undefined) {
    updates.tagline = body.data.tagline?.trim() || null;
  }
  if (body.data.description !== undefined) {
    updates.description = body.data.description?.trim() || null;
  }
  try {
    const contactEmail = normalizeNullableEmail(body.data.contactEmail);
    if (contactEmail !== undefined) updates.contactEmail = contactEmail;
    const contactPhone = normalizeNullableText(body.data.contactPhone);
    if (contactPhone !== undefined) updates.contactPhone = contactPhone;
    const websiteUrl = normalizeNullableUrl(body.data.websiteUrl, "Website URL");
    if (websiteUrl !== undefined) updates.websiteUrl = websiteUrl;
    const bookingUrl = normalizeNullableUrl(body.data.bookingUrl, "Booking URL");
    if (bookingUrl !== undefined) updates.bookingUrl = bookingUrl;
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid contact details" });
    return;
  }
  if (body.data.ownerEmail !== undefined) {
    const email = body.data.ownerEmail.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "A valid owner email is required" });
      return;
    }
    updates.ownerEmail = email;
  }
  if (body.data.incentiveText !== undefined) {
    updates.incentiveText = normalizeIncentiveText(body.data.incentiveText);
  }
  if (body.data.reviewBeforeSend !== undefined) {
    updates.reviewBeforeSend = body.data.reviewBeforeSend;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(venuesTable)
    .set(updates)
    .where(eq(venuesTable.id, venue.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  res.json(ownerVenueResponse(updated, await loadVenueOrg(updated)));
});

async function loadVenueOrg(venue: { organizationId: number | null }) {
  if (venue.organizationId == null) return null;
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, venue.organizationId));
  return org ?? null;
}

// GET /venues/:slug/dashboard (organization member)
router.get("/venues/:slug/dashboard", async (req, res): Promise<void> => {
  const params = GetVenueDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  const sessions = await db
    .select(sessionSummaryColumns)
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.venueId, venue.id))
    .orderBy(sql`${coupleSessionsTable.createdAt} desc`);

  // Thumbnails for ready galleries plus the per-couple gallery_events
  // aggregates (first "sent", share count).
  const stats = await galleryStatsForSessions(sessions.map((session) => session.id));
  const sessionsWithThumbnails = await Promise.all(
    sessions.map((session) => toSessionSummary(session, stats.get(session.id))),
  );

  const [org] = venue.organizationId
    ? await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.id, venue.organizationId))
    : [];

  res.json({
    venue: ownerVenueResponse(venue, org ?? null),
    sessions: sessionsWithThumbnails,
  });
});

// GET /venues/:slug/media (owner session)
router.get("/venues/:slug/media", async (req, res): Promise<void> => {
  const params = ListVenueMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  const media = await db
    .select()
    .from(venueMediaTable)
    .where(eq(venueMediaTable.venueId, venue.id))
    .orderBy(venueMediaTable.displayOrder);

  res.json({ media });
});

// POST /venues/:slug/media (owner session)
router.post("/venues/:slug/media", async (req, res): Promise<void> => {
  const params = AddVenueMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = AddVenueMediaBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  let newQuality: ReferenceImageQuality;
  try {
    await assertUploadIntentAvailable(body.data.objectKey, venue.id, "venue");
    newQuality = await validateVenueMediaObjectKey(body.data.objectKey);
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : "Venue photo is invalid. Upload a high-resolution JPG, PNG, or WebP image.",
    });
    return;
  }

  const [duplicate] = await db
    .select({ id: venueMediaTable.id })
    .from(venueMediaTable)
    .where(and(eq(venueMediaTable.venueId, venue.id), eq(venueMediaTable.objectKey, body.data.objectKey)))
    .limit(1);
  if (duplicate) {
    res.status(409).json({
      error:
        "This venue photo is already in the profile. Upload a different view so the gallery has enough real venue coverage.",
    });
    return;
  }

  try {
    await assertVenueMediaDistinct(venue.id, body.data.objectKey, newQuality);
  } catch (err) {
    res.status(409).json({
      error:
        err instanceof Error
          ? err.message
          : "Upload a different venue view so the gallery has enough real venue coverage.",
    });
    return;
  }

  const media = await db.transaction(async (tx) => {
    const [intent] = await tx
      .update(uploadIntentsTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(uploadIntentsTable.objectKey, body.data.objectKey),
          eq(uploadIntentsTable.venueId, venue.id),
          eq(uploadIntentsTable.purpose, "venue"),
          isNull(uploadIntentsTable.consumedAt),
          gte(uploadIntentsTable.expiresAt, new Date()),
        ),
      )
      .returning({ id: uploadIntentsTable.id });
    if (!intent) return null;

    const [created] = await tx
      .insert(venueMediaTable)
      .values({
        venueId: venue.id,
        objectKey: body.data.objectKey,
        coverage: body.data.coverage,
        displayOrder: body.data.displayOrder ?? 0,
      })
      .returning();
    return created ?? null;
  });

  if (!media) {
    res.status(409).json({ error: "This upload was already used. Upload the photo again." });
    return;
  }

  res.status(201).json(media);
});

// DELETE /venues/:slug/media/:mediaId (owner session)
router.delete("/venues/:slug/media/:mediaId", async (req, res): Promise<void> => {
  const params = DeleteVenueMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  const [media] = await db
    .select()
    .from(venueMediaTable)
    .where(
      and(
        eq(venueMediaTable.id, params.data.mediaId),
        eq(venueMediaTable.venueId, venue.id)
      )
    )
    .limit(1);

  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  try {
    await objectStorageService.deleteObjectEntity(media.objectKey);
  } catch (err) {
    req.log.error(
      { err, mediaId: params.data.mediaId, objectKey: media.objectKey },
      "Failed to delete venue media object",
    );
    res.status(500).json({ error: "Could not delete the venue photo from storage." });
    return;
  }

  const [deleted] = await db
    .delete(venueMediaTable)
    .where(
      and(
        eq(venueMediaTable.id, params.data.mediaId),
        eq(venueMediaTable.venueId, venue.id)
      )
    )
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  res.sendStatus(204);
});

/* ————— Venue setup: booked marker, website import, sample, tour card ————— */

async function loadSummaryRow(venueId: number, sessionId: number) {
  const [row] = await db
    .select(sessionSummaryColumns)
    .from(coupleSessionsTable)
    .where(and(eq(coupleSessionsTable.id, sessionId), eq(coupleSessionsTable.venueId, venueId)))
    .limit(1);
  return row ?? null;
}

const bookedStore: BookedStore<SessionSummarySource> = {
  loadSession: loadSummaryRow,
  async writeBooked(sessionId, change) {
    const [row] = await db
      .update(coupleSessionsTable)
      .set({ bookedAt: change.bookedAt, bookedBy: change.bookedBy })
      .where(
        and(
          eq(coupleSessionsTable.id, sessionId),
          change.bookedAt ? isNull(coupleSessionsTable.bookedAt) : isNotNull(coupleSessionsTable.bookedAt),
        ),
      )
      .returning(sessionSummaryColumns);
    return row ?? null;
  },
  async recordEvent(session, eventType, actor) {
    await recordGalleryEvent({
      sessionId: session.id,
      venueId: session.venueId,
      eventType,
      source: "dashboard",
      meta: { actor, ...(session.weddingMonth ? { weddingMonth: session.weddingMonth } : {}) },
    });
  },
};

// POST /venues/:slug/sessions/:id/booked (organization member; idempotent)
router.post("/venues/:slug/sessions/:id/booked", async (req, res): Promise<void> => {
  const params = SetSessionBookedParams.safeParse(req.params);
  if (!params.success || !Number.isInteger(params.data.id) || params.data.id <= 0) {
    res.status(400).json({ error: "Invalid venue or session id", code: "invalid_params" });
    return;
  }
  const body = SetSessionBookedBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Send { \"booked\": true } or { \"booked\": false }.", code: "invalid_body" });
    return;
  }

  const resolved = await requireOrgVenueContext(req, res, params.data.slug);
  if (!resolved) return;
  const { ctx, venue } = resolved;

  const outcome = await setSessionBooked(bookedStore, {
    venueId: venue.id,
    sessionId: params.data.id,
    booked: body.data.booked,
    actor: ownerActor(ctx.clerkUserId),
  });
  if (!outcome.ok) {
    res.status(outcome.status).json(outcome.code ? { error: outcome.error, code: outcome.code } : { error: outcome.error });
    return;
  }
  const [stats] = (await galleryStatsForSessions([outcome.session.id])).values();
  res.json(await toSessionSummary(outcome.session, stats));
});

// POST /venues/:slug/media/import-website (organization admins)
router.post("/venues/:slug/media/import-website", async (req, res): Promise<void> => {
  const params = ImportVenueWebsiteMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = ImportVenueWebsiteMediaBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "websiteUrl must be a string.", code: "invalid_body" });
    return;
  }

  const resolved = await requireOrgVenueContext(req, res, params.data.slug);
  if (!resolved) return;
  const { ctx, venue } = resolved;
  if (!requireOrgAdmin(ctx)) {
    res.status(403).json({ error: "Only organization admins can import venue photos.", code: "org_admin_required" });
    return;
  }

  const now = new Date();
  const plan = planWebsiteImport({
    websiteUrlOverride: body.data.websiteUrl ?? null,
    venueWebsiteUrl: venue.websiteUrl,
    websiteImportedAt: venue.websiteImportedAt,
    now,
  });
  if (!plan.ok) {
    res.status(plan.status).json({ error: plan.error, code: plan.code });
    return;
  }

  // Claim the cooldown window atomically so two clicks cannot run two imports.
  const cooldownStart = new Date(now.getTime() - IMPORT_LIMITS.cooldownMs);
  const [claimed] = await db
    .update(venuesTable)
    .set({ websiteImportedAt: now, ...(plan.override ? { websiteUrl: plan.websiteUrl } : {}) })
    .where(
      and(
        eq(venuesTable.id, venue.id),
        sql`(${venuesTable.websiteImportedAt} is null or ${venuesTable.websiteImportedAt} < ${cooldownStart})`,
      ),
    )
    .returning({ id: venuesTable.id });
  if (!claimed) {
    res.status(429).json({
      error: "Photos were imported from this website a few minutes ago. Review those first, then try again.",
      code: "import_cooldown",
    });
    return;
  }

  const existing = await db
    .select({
      objectKey: venueMediaTable.objectKey,
      coverage: venueMediaTable.coverage,
      perceptualHash: venueMediaTable.perceptualHash,
      displayOrder: venueMediaTable.displayOrder,
    })
    .from(venueMediaTable)
    .where(eq(venueMediaTable.venueId, venue.id));

  const outcome = await importWebsiteMedia(
    {
      venue: { id: venue.id, name: venue.name, websiteUrl: plan.websiteUrl, websiteImportedAt: null },
      existing,
      now,
    },
    defaultWebsiteImportDeps(objectStorageService),
  );
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    return;
  }

  const orders = appendDisplayOrders(
    existing.map((row) => row.displayOrder),
    outcome.media.length,
  );
  const imported =
    outcome.media.length > 0
      ? await db
          .insert(venueMediaTable)
          .values(
            outcome.media.map((item, index) => ({
              venueId: venue.id,
              objectKey: item.objectKey,
              coverage: item.coverage,
              displayOrder: orders[index] ?? 0,
              perceptualHash: item.perceptualHash,
              width: item.width,
              height: item.height,
              contentType: item.contentType,
            })),
          )
          .onConflictDoNothing()
          .returning({
            id: venueMediaTable.id,
            venueId: venueMediaTable.venueId,
            objectKey: venueMediaTable.objectKey,
            coverage: venueMediaTable.coverage,
            displayOrder: venueMediaTable.displayOrder,
            createdAt: venueMediaTable.createdAt,
          })
      : [];

  logger.info(
    { venueId: venue.id, imported: imported.length, candidates: outcome.candidatesFound },
    "Website photo import finished",
  );
  res.json({ imported, candidatesFound: outcome.candidatesFound, warnings: outcome.warnings });
});

async function countSampleSessions(venueId: number, executor: Pick<typeof db, "select"> = db): Promise<SampleCounts> {
  const [row] = await executor
    .select({
      inFlight: sql<number>`count(*) filter (where ${coupleSessionsTable.status} in ('pending', 'processing'))::int`,
      nonFailed: sql<number>`count(*) filter (where ${coupleSessionsTable.status} <> 'failed')::int`,
    })
    .from(coupleSessionsTable)
    .where(and(eq(coupleSessionsTable.venueId, venueId), eq(coupleSessionsTable.kind, "sample")));
  return { inFlight: Number(row?.inFlight ?? 0), nonFailed: Number(row?.nonFailed ?? 0) };
}

function sampleGalleryDeps(venue: { id: number; ownerEmail: string }): SampleGalleryDeps<typeof coupleSessionsTable.$inferSelect> {
  const photoDeps = defaultSamplePhotoDeps(objectStorageService);
  return {
    loadMedia: (venueId) =>
      db.select({ coverage: venueMediaTable.coverage }).from(venueMediaTable).where(eq(venueMediaTable.venueId, venueId)),
    countSamples: (venueId) => countSampleSessions(venueId),
    preparePhotos: () => prepareSamplePhotos(photoDeps),
    insertSession: (venueId, objectKeys) =>
      db.transaction(async (tx) => {
        // Serialize sample starts per venue, then re-check under the lock.
        await tx.select({ id: venuesTable.id }).from(venuesTable).where(eq(venuesTable.id, venueId)).for("update");
        const counts = await countSampleSessions(venueId, tx);
        if (counts.inFlight > 0) {
          return {
            ok: false as const,
            status: 409 as const,
            error: "A sample is already rendering for this venue. It usually takes a few minutes.",
            code: "sample_in_progress" as const,
          };
        }
        if (counts.nonFailed >= MAX_SAMPLES_PER_VENUE) {
          return {
            ok: false as const,
            status: 409 as const,
            error: `This venue already has ${MAX_SAMPLES_PER_VENUE} sample galleries. Make a gallery for a real couple next.`,
            code: "sample_limit" as const,
          };
        }
        const [created] = await tx
          .insert(coupleSessionsTable)
          .values({
            venueId,
            status: "pending",
            styleId: DEFAULT_SAMPLE_STYLE_ID,
            coupleName: SAMPLE_COUPLE_NAME,
            // The pipeline never emails sample sessions; the column is required.
            coupleEmail: venue.ownerEmail,
            shareToken: crypto.randomUUID(),
            creditsCharged: 0,
            kind: "sample",
            createdVia: "sample",
          })
          .returning();
        if (!created) throw new Error("Failed to create sample session.");
        await tx.insert(coupleMediaTable).values(objectKeys.map((objectKey) => ({ sessionId: created.id, objectKey })));
        return { ok: true as const, session: created };
      }),
    async discardPhotos(objectKeys) {
      for (const objectKey of objectKeys) {
        await objectStorageService.deleteObjectEntity(objectKey).catch((err) => {
          logger.warn({ err, objectKey }, "Could not delete unused sample photo");
        });
      }
    },
  };
}

const DEFAULT_SAMPLE_STYLE_ID = "cinematic-editorial";
/** Sample starts per organization per hour (on top of the per-venue limits). */
const SAMPLE_ORG_HOURLY_LIMIT = 6;

// POST /venues/:slug/sample-gallery (organization member; no credit charged)
router.post("/venues/:slug/sample-gallery", async (req, res): Promise<void> => {
  const params = CreateSampleGalleryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const resolved = await requireOrgVenueContext(req, res, params.data.slug);
  if (!resolved) return;
  const { ctx, venue } = resolved;

  if (!rateLimit(`sample:org:${ctx.org.id}`, SAMPLE_ORG_HOURLY_LIMIT, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many samples started. Try again in an hour.", code: "rate_limited" });
    return;
  }

  const outcome = await startSampleGallery(sampleGalleryDeps(venue), venue.id);
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
    return;
  }
  const session = outcome.session;
  res.status(201).json({
    id: session.id,
    venueId: session.venueId,
    status: session.status,
    shareToken: session.shareToken,
    createdAt: session.createdAt,
  });
});

function tourCardStore(): TourCardStore<typeof venuesTable.$inferSelect> {
  return {
    async stampFirstDownload(venueId, now) {
      const [row] = await db
        .update(venuesTable)
        .set({ tourCardDownloadedAt: now })
        .where(and(eq(venuesTable.id, venueId), isNull(venuesTable.tourCardDownloadedAt)))
        .returning();
      return row ?? null;
    },
    async reload(venueId) {
      const [row] = await db.select().from(venuesTable).where(eq(venuesTable.id, venueId));
      return row ?? null;
    },
    async recordFirstDownload(venue) {
      await recordFunnelEvent({
        organizationId: venue.organizationId,
        venueId: venue.id,
        event: "tour_card_downloaded",
        source: "server",
      });
    },
  };
}

// POST /venues/:slug/tour-card-downloaded (organization member)
router.post("/venues/:slug/tour-card-downloaded", async (req, res): Promise<void> => {
  const params = MarkTourCardDownloadedParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOrgVenue(req, res, params.data.slug);
  if (!venue) return;

  const result = await markTourCardDownloaded(tourCardStore(), venue.id);
  if (!result) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }
  res.json(ownerVenueResponse(result.venue, await loadVenueOrg(result.venue)));
});

export default router;
