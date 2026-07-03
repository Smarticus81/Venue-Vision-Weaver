import { Router, type IRouter } from "express";
import { eq, and, sql, asc, gte, isNull } from "drizzle-orm";
import {
  db,
  ownerCredentialsTable,
  venuesTable,
  venueMediaTable,
  coupleSessionsTable,
  generatedAssetsTable,
  creditTransactionsTable,
  uploadIntentsTable,
} from "@workspace/db";
import { estimateSessionCostUsd } from "../lib/cost.js";
import {
  CreateVenueBody,
  GetVenueParams,
  GetVenueDashboardParams,
  GetVenueStatsParams,
  ListVenueMediaParams,
  AddVenueMediaParams,
  AddVenueMediaBody,
  DeleteVenueMediaParams,
  UpdateVenueParams,
  UpdateVenueBody,
  RecoverOwnerVenuesBody,
} from "@workspace/api-zod";
import { sendOwnerLoginEmail, sendOwnerRecoveryEmail } from "../lib/emailService.js";
import { rateLimit, clientKey } from "../lib/rateLimit.js";
import { TRIAL_CREDITS } from "@workspace/db";
import { toPublicVenue } from "../lib/credits.js";
import {
  mimeTypeFromObjectPath,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage.js";
import {
  createOwnerLoginLink,
  createOwnerPasswordHash,
  exchangeOwnerLoginToken,
  getOwnerEmailFromRequest,
  isStrongOwnerPassword,
  loginOwnerWithPassword,
  OWNER_SESSION_COOKIE,
  ownerCookieOptions,
  requireOwnerMutationOrigin,
  requireOwnerVenue,
  revokeOwnerSession,
} from "../lib/ownerAuth.js";
import { createCoupleUploadToken } from "../lib/uploadToken.js";
import {
  assertReferenceImageQuality,
  hammingDistance,
  type ReferenceImageQuality,
} from "../lib/referenceImageQuality.js";
import { ownerVenueResponse, publicContactFields } from "../lib/venueResponse.js";
import { hasCompletePublicGalleryAssets } from "../lib/sessionVisibility.js";
import { logger } from "../lib/logger.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_VENUE_PHOTO_EDGE_PX = 256;
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

// POST /venues
router.post("/venues", async (req, res): Promise<void> => {
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
  const ownerPassword = typeof req.body?.password === "string" ? req.body.password : "";
  const normalizedOwnerEmail = ownerEmail?.trim().toLowerCase() ?? "";
  if (!normalizedOwnerEmail || !EMAIL_REGEX.test(normalizedOwnerEmail)) {
    res.status(400).json({ error: "Owner email is required" });
    return;
  }
  if (ownerPassword && !isStrongOwnerPassword(ownerPassword)) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
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
  const ownerPasswordHash = ownerPassword ? createOwnerPasswordHash(ownerPassword) : null;
  const [existingOwnerVenue] = await db
    .select()
    .from(venuesTable)
    .where(
      and(
        sql`lower(${venuesTable.ownerEmail}) = ${normalizedOwnerEmail}`,
        sql`lower(${venuesTable.name}) = ${trimmedName.toLowerCase()}`,
      ),
    )
    .limit(1);

  if (existingOwnerVenue && ownerPasswordHash) {
    let venue;
    try {
      venue = await db.transaction(async (tx) => {
        const [updatedVenue] = await tx
          .update(venuesTable)
          .set({
            contactEmail: normalizedContactEmail ?? existingOwnerVenue.contactEmail,
            contactPhone: normalizeNullableText(contactPhone) ?? existingOwnerVenue.contactPhone,
            websiteUrl: normalizedWebsiteUrl ?? existingOwnerVenue.websiteUrl,
            bookingUrl: normalizedBookingUrl ?? existingOwnerVenue.bookingUrl,
          })
          .where(eq(venuesTable.id, existingOwnerVenue.id))
          .returning();

        await tx
          .insert(ownerCredentialsTable)
          .values({
            ownerEmail: normalizedOwnerEmail,
            passwordHash: ownerPasswordHash,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: ownerCredentialsTable.ownerEmail,
            set: {
              passwordHash: ownerPasswordHash,
              updatedAt: new Date(),
            },
          });

        return updatedVenue ?? existingOwnerVenue;
      });
    } catch (err) {
      const pgError = err instanceof Error ? (err.cause as { code?: string }) : null;
      if (pgError?.code === "42P01") {
        res.status(503).json({
          error: "Database schema needs to be updated. Run pnpm run setup:db or apply supabase/bootstrap.sql.",
        });
        return;
      }
      throw err;
    }

    const session = await loginOwnerWithPassword(normalizedOwnerEmail, ownerPassword);
    if (session) {
      res.cookie(OWNER_SESSION_COOKIE, session, ownerCookieOptions(30 * 24 * 60 * 60 * 1000));
    }
    res.status(200).json(ownerVenueResponse(venue));
    return;
  }

  const internalSlug = await uniqueVenueSlug(slug);

  let venue;
  try {
    venue = await db.transaction(async (tx) => {
      const [createdVenue] = await tx
        .insert(venuesTable)
        .values({
          name: trimmedName,
          slug: internalSlug,
          tagline: tagline ?? null,
          description: description ?? null,
          ownerEmail: normalizedOwnerEmail,
          contactEmail: normalizedContactEmail ?? null,
          contactPhone: normalizeNullableText(contactPhone) ?? null,
          websiteUrl: normalizedWebsiteUrl ?? null,
          bookingUrl: normalizedBookingUrl ?? null,
          plan: "trial",
          creditsBalance: TRIAL_CREDITS,
        })
        .returning();

      if (!createdVenue) {
        throw new Error("Failed to create venue.");
      }

      await tx.insert(creditTransactionsTable).values({
        venueId: createdVenue.id,
        delta: TRIAL_CREDITS,
        reason: "trial_grant",
      });

      if (ownerPasswordHash) {
        await tx
          .insert(ownerCredentialsTable)
          .values({
            ownerEmail: normalizedOwnerEmail,
            passwordHash: ownerPasswordHash,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: ownerCredentialsTable.ownerEmail,
            set: {
              passwordHash: ownerPasswordHash,
              updatedAt: new Date(),
            },
          });
      }

      return createdVenue;
    });
  } catch (err) {
    const pgError = err instanceof Error ? (err.cause as { code?: string; detail?: string; message?: string }) : null;
    logger.error({ err, pgCode: pgError?.code, pgDetail: pgError?.detail, pgMessage: pgError?.message }, "Failed to insert venue");
    if (pgError?.code === "23505") {
      res.status(409).json({ error: "This venue already exists. Try logging in instead." });
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

  if (ownerPassword) {
    const session = await loginOwnerWithPassword(normalizedOwnerEmail, ownerPassword);
    if (session) {
      res.cookie(OWNER_SESSION_COOKIE, session, ownerCookieOptions(30 * 24 * 60 * 60 * 1000));
    }
  }

  res.status(201).json(ownerVenueResponse(venue));
});

// POST /owners/password-login
router.post("/owners/password-login", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || !EMAIL_REGEX.test(email) || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  if (!rateLimit(`ownerpassword:ip:${clientKey(req)}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many login attempts. Try again soon." });
    return;
  }
  if (!rateLimit(`ownerpassword:email:${email}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: "Too many login attempts. Try again soon." });
    return;
  }

  const session = await loginOwnerWithPassword(email, password);
  if (!session) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  res.cookie(OWNER_SESSION_COOKIE, session, ownerCookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ accepted: true });
});

// POST /owners/login-link
router.post("/owners/login-link", async (req, res): Promise<void> => {
  const body = RecoverOwnerVenuesBody.safeParse(req.body);
  const ack = (): void => {
    res.json({ accepted: true });
  };

  if (!body.success) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const email = body.data.email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  if (!rateLimit(`ownerlogin:ip:${clientKey(req)}`, 5, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  if (!rateLimit(`ownerlogin:email:${email}`, 5, 60 * 60 * 1000)) {
    return ack();
  }

  const [venue] = await db
    .select({ id: venuesTable.id })
    .from(venuesTable)
    .where(sql`lower(${venuesTable.ownerEmail}) = ${email}`)
    .limit(1);

  if (venue) {
    const loginUrl = await createOwnerLoginLink(email);
    await sendOwnerLoginEmail(email, loginUrl);
  }

  return ack();
});

// POST /owners/login
router.post("/owners/login", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) {
    res.status(400).json({ error: "Login token required" });
    return;
  }
  const session = await exchangeOwnerLoginToken(token);
  if (!session) {
    res.status(401).json({ error: "Login link is invalid or expired" });
    return;
  }
  res.cookie(OWNER_SESSION_COOKIE, session, ownerCookieOptions(30 * 24 * 60 * 60 * 1000));
  res.json({ accepted: true });
});

// GET /owners/session
router.get("/owners/session", async (req, res): Promise<void> => {
  const ownerEmail = await getOwnerEmailFromRequest(req);
  if (!ownerEmail) {
    res.status(401).json({ error: "Owner login required" });
    return;
  }
  const venues = await db
    .select({ id: venuesTable.id, name: venuesTable.name, slug: venuesTable.slug })
    .from(venuesTable)
    .where(sql`lower(${venuesTable.ownerEmail}) = ${ownerEmail}`)
    .orderBy(asc(venuesTable.name));
  res.json({ ownerEmail, venues });
});

// POST /owners/logout
router.post("/owners/logout", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  await revokeOwnerSession(req);
  res.clearCookie(OWNER_SESSION_COOKIE, { path: "/" });
  res.json({ accepted: true });
});

// GET /venues - deprecated public directory (venue-only distribution via direct links)
router.get("/venues", async (_req, res): Promise<void> => {
  res.status(404).json({ error: "Venue directory is not available. Use your venue link or code." });
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

  const venue = await requireOwnerVenue(req, res, params.data.slug);
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

  res.json(ownerVenueResponse(updated));
});

// POST /owners/recover  (magic-link, never enumerates)
router.post("/owners/recover", async (req, res): Promise<void> => {
  const body = RecoverOwnerVenuesBody.safeParse(req.body);
  // Always return accepted to prevent enumeration of registered owner emails
  const ack = (): void => {
    res.json({ accepted: true });
  };

  if (!body.success) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }
  const email = body.data.email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  // Per-IP + per-email rate limits prevent abuse of the email-sender
  if (!rateLimit(`ownerrecover:ip:${clientKey(req)}`, 5, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  if (!rateLimit(`ownerrecover:email:${email}`, 3, 60 * 60 * 1000)) {
    return ack();
  }

  const rows = await db
    .select({
      name: venuesTable.name,
      slug: venuesTable.slug,
      createdAt: venuesTable.createdAt,
    })
    .from(venuesTable)
    .where(sql`lower(${venuesTable.ownerEmail}) = ${email}`)
    .orderBy(asc(venuesTable.name));

  if (rows.length > 0) {
    const venues = await Promise.all(
      rows.map(async (venue) => ({
        ...venue,
        loginUrl: await createOwnerLoginLink(email, `/profile/${venue.slug}`),
      })),
    );
    await sendOwnerRecoveryEmail(email, venues);
  }

  return ack();
});

// GET /venues/:slug/dashboard (owner session)
router.get("/venues/:slug/dashboard", async (req, res): Promise<void> => {
  const params = GetVenueDashboardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOwnerVenue(req, res, params.data.slug);
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

  // Get thumbnail for each ready session
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

  res.json({
    venue: ownerVenueResponse(venue),
    sessions: sessionsWithThumbnails,
  });
});

// GET /venues/:slug/stats (owner session)
router.get("/venues/:slug/stats", async (req, res): Promise<void> => {
  const params = GetVenueStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOwnerVenue(req, res, params.data.slug);
  if (!venue) return;

  const sessions = await db
    .select({
      status: coupleSessionsTable.status,
      createdAt: coupleSessionsTable.createdAt,
      completedAt: coupleSessionsTable.completedAt,
    })
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.venueId, venue.id));

  const totalSessions = sessions.length;
  const readySessions = sessions.filter(s => s.status === "ready").length;
  const processingSessions = sessions.filter(s => s.status === "processing" || s.status === "pending").length;
  const failedSessions = sessions.filter(s => s.status === "failed").length;
  const totalEstimatedCostUsd = +sessions
    .reduce(
      (sum, s) =>
        sum + estimateSessionCostUsd(),
      0,
    )
    .toFixed(2);

  const completedSessions = sessions.filter(
    s => s.status === "ready" && s.completedAt
  );
  const avgCompletionSeconds =
    completedSessions.length > 0
      ? completedSessions.reduce((sum, s) => {
          const diff =
            (s.completedAt!.getTime() - s.createdAt.getTime()) / 1000;
          return sum + diff;
        }, 0) / completedSessions.length
      : null;

  res.json({
    totalSessions,
    readySessions,
    processingSessions,
    failedSessions,
    avgCompletionSeconds,
    totalEstimatedCostUsd,
  });
});

// GET /venues/:slug/media (owner session)
router.get("/venues/:slug/media", async (req, res): Promise<void> => {
  const params = ListVenueMediaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const venue = await requireOwnerVenue(req, res, params.data.slug);
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

  const venue = await requireOwnerVenue(req, res, params.data.slug);
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

  const venue = await requireOwnerVenue(req, res, params.data.slug);
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

export default router;
