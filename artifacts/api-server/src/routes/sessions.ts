import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { eq, and, sql, gte, gt, isNull, ne } from "drizzle-orm";
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
  renderAttemptsTable,
  type SessionCreatedVia,
} from "@workspace/db";
import {
  CreateSessionParams,
  CreateSessionBody,
  GetSessionParams,
  RecordGalleryEventBody,
  RecoverSessionsBody,
} from "@workspace/api-zod";
import {
  creditsForSession,
  countVenueSessionsToday,
  VENUE_DAILY_SESSION_CAP,
  LOW_CREDIT_THRESHOLD,
  isLowCredit,
} from "../lib/credits.js";
import { assertCanSpend, SPEND_ERRORS, type SpendCheck } from "../lib/trial.js";
import { toPublicVenue, isVenueReady, bookingCtaFor } from "../lib/venueResponse.js";
import { MIN_COUPLE_REFERENCES } from "../lib/referenceImage.js";
import { recordGalleryEvent, hashClientIp } from "../lib/galleryEvents.js";
import { recordFunnelEvent } from "../lib/funnelEvents.js";
import {
  sendSessionCreatedNotification,
  sendGalleryToCouple,
  sendRecoveryEmail,
  sendOwnerCreditsExhausted,
  sendOwnerLowCredit,
} from "../lib/emailService.js";
import { logger } from "../lib/logger.js";
import { rateLimit, clientKey } from "../lib/rateLimit.js";
import {
  requireOrg,
  requireOrgAdmin,
  requireOwnerMutationOrigin,
  type OrgContext,
} from "../lib/orgAuth.js";
import {
  mimeTypeFromObjectPath,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage.js";
import {
  assertReferenceImageQuality,
  hammingDistance,
  MIN_REFERENCE_EDGE_PX,
  NEAR_DUPLICATE_HAMMING,
  type ReferenceImageQuality,
} from "../lib/referenceImageQuality.js";
import {
  canExposeGeneratedAssetsToSharePage,
  hasCompletePublicGalleryAssets,
} from "../lib/sessionVisibility.js";
import { findGalleryStyle } from "../lib/galleryStyles.js";
import { verifyTurnstileToken, type TurnstileVerification } from "../lib/turnstile.js";

const router: IRouter = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_COUPLE_PHOTOS = MIN_COUPLE_REFERENCES;
const MAX_COUPLE_PHOTOS = 3;
const MIN_COUPLE_PHOTO_EDGE_PX = MIN_REFERENCE_EDGE_PX;
const MAX_COUPLE_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_STYLE_ID = "cinematic-editorial";
const objectStorageService = new ObjectStorageService();
const ALLOWED_COUPLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STALE_UPLOAD_INTENT_ERROR = "STALE_UPLOAD_INTENT";

/** Per-IP session creation: 10 per hour. */
export const SESSION_CREATE_IP_LIMIT = 10;
/** Per-venue burst cap beneath the daily cap: a tour-day crowd is a handful an hour, not dozens. */
export const VENUE_HOURLY_SESSION_CAP = 12;
/** Per-IP share-page events: 30 per 10 minutes. */
const GALLERY_EVENT_IP_LIMIT = 30;
/** The owner gets at most one "credits ran out" email per organization per day per reason. */
const EXHAUSTED_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

const COUPLE_UNAVAILABLE_MESSAGE = "This venue isn't taking new galleries just yet. Please check back shortly.";

/* ————— Payloads ————— */

/**
 * Owner-only quality flag for a session: below target when any still was
 * kept below the judge's bar or could not be judged, plus the number of
 * render attempts the pipeline logged. Null before anything rendered.
 */
export function summarizeSessionQuality(
  assets: ReadonlyArray<{ assetType: string; qualityReport: Record<string, unknown> | null }>,
  attempts: number,
): { belowTarget: boolean; attempts: number } | null {
  const stills = assets.filter((asset) => asset.assetType === "image");
  if (stills.length === 0 && attempts === 0) return null;
  const belowTarget = stills.some((asset) => {
    const status = asset.qualityReport?.judgeStatus;
    return status === "below_target" || status === "unjudged";
  });
  return { belowTarget, attempts };
}

function buildSessionDetailPayload(
  session: typeof coupleSessionsTable.$inferSelect,
  venue: typeof venuesTable.$inferSelect | undefined,
  venueMedia: Array<typeof venueMediaTable.$inferSelect>,
  generatedAssets: Array<typeof generatedAssetsTable.$inferSelect>,
  options: { includeEmail: boolean; renderAttempts?: number },
) {
  const base = {
    id: session.id,
    venueId: session.venueId,
    status: session.status,
    errorMessage: session.errorMessage,
    styleId: session.styleId,
    coupleName: session.coupleName,
    hasCoupleEmail: !!session.coupleEmail,
    shareToken: session.shareToken,
    kind: session.kind,
    createdVia: session.createdVia,
    weddingMonth: session.weddingMonth,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    venue: venue ? toPublicVenue(venue, venueMedia) : null,
    generatedAssets,
    deliveryHeld: session.status === "ready" && Boolean(session.deliveryHoldReason),
  };
  if (options.includeEmail) {
    return {
      ...base,
      coupleEmail: session.coupleEmail,
      viewCount: session.viewCount,
      ctaClicks: session.ctaClicks,
      firstViewedAt: session.firstViewedAt,
      bookedAt: session.bookedAt,
      consentAt: session.consentAt,
      failureDetail: session.failureDetail,
      qualitySummary: summarizeSessionQuality(generatedAssets, options.renderAttempts ?? 0),
    };
  }
  return base;
}

/* ————— Upload intents and photo validation ————— */

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

/**
 * Cheap checks first (shape, duplicates, intent rows), then the expensive
 * download + sharp pass. Nothing is downloaded until every key has a live
 * upload intent for this venue.
 */
async function validateCouplePhotoObjectKeys(objectKeys: string[], venueId: number): Promise<void> {
  const seen = new Set<string>();
  for (const [index, objectKey] of objectKeys.entries()) {
    if (seen.has(objectKey)) {
      throw new Error(`Couple photo ${index + 1} is duplicated. Upload distinct reference photos.`);
    }
    seen.add(objectKey);
    if (!objectKey.startsWith("/objects/uploads/")) {
      throw new Error(`Couple photo ${index + 1} is not a valid uploaded object.`);
    }
    await assertUploadIntentAvailable(objectKey, venueId, "couple");
  }

  const qualities: ReferenceImageQuality[] = [];
  for (const [index, objectKey] of objectKeys.entries()) {
    try {
      const file = await objectStorageService.getObjectEntityFile(objectKey);
      const metadata = await file.getMetadata().catch(() => null);
      const declaredSize = Number(metadata?.size ?? 0);
      if (declaredSize > MAX_COUPLE_UPLOAD_BYTES) {
        throw new Error(`Couple photo ${index + 1} is too large. Upload images up to 50MB.`);
      }
      const contentType =
        metadata?.contentType && metadata.contentType !== "application/octet-stream"
          ? metadata.contentType
          : mimeTypeFromObjectPath(objectKey);
      if (!ALLOWED_COUPLE_IMAGE_TYPES.has(contentType)) {
        throw new Error(`Couple photo ${index + 1} must be a JPG, PNG, or WebP image.`);
      }

      const [buffer] = await file.download();
      if (buffer.length > MAX_COUPLE_UPLOAD_BYTES) {
        throw new Error(`Couple photo ${index + 1} is too large. Upload images up to 50MB.`);
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
      if (hammingDistance(qualities[i]!.perceptualHash, qualities[j]!.perceptualHash) <= NEAR_DUPLICATE_HAMMING) {
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

async function countVenueSessionsLastHour(venueId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coupleSessionsTable)
    .where(
      and(
        eq(coupleSessionsTable.venueId, venueId),
        gte(coupleSessionsTable.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  return row?.count ?? 0;
}

/* ————— Session-create guard pipeline (exported for tests) ————— */

export interface SessionCreateGuardInput {
  venueId: number;
  clientIp: string;
  couplePhotoKeys: string[];
  turnstileToken: string | null | undefined;
  neededCredits: number;
}

export interface SessionCreateGuardDeps {
  rateLimit(key: string, limit: number, windowMs: number): boolean;
  loadVenueMedia(venueId: number): Promise<Array<{ coverage?: string | null }>>;
  countVenueSessionsToday(venueId: number): Promise<number>;
  countVenueSessionsLastHour(venueId: number): Promise<number>;
  assertCanSpend(venueId: number, amount: number): Promise<SpendCheck>;
  verifyTurnstile(token: string | null | undefined, ip: string): Promise<TurnstileVerification>;
  /** Upload-intent checks, then download + quality validation. Throws a couple-facing message. */
  validatePhotos(objectKeys: string[], venueId: number): Promise<void>;
}

export type SessionCreateGuardResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 402 | 409 | 429 | 503;
      body: { error: string; code?: string };
      spendReason?: SpendRefusalReason;
    };

export type SpendRefusalReason = Extract<SpendCheck, { ok: false }>["reason"];

/**
 * Every check that must pass before a couple's photos are downloaded or a
 * credit is touched, in cost order: rate limit -> venue readiness -> daily
 * and hourly caps -> trial clock / balance -> Turnstile -> upload intents ->
 * download and validate. Nothing here writes to the database.
 */
export async function runSessionCreateGuards(
  input: SessionCreateGuardInput,
  deps: SessionCreateGuardDeps,
): Promise<SessionCreateGuardResult> {
  if (!deps.rateLimit(`create:${input.clientIp}`, SESSION_CREATE_IP_LIMIT, 60 * 60 * 1000)) {
    return {
      ok: false,
      status: 429,
      body: { error: "Too many sessions from this address. Try again later.", code: "rate_limited" },
    };
  }

  // Readiness: enough reference photos AND every coverage role (the same rule
  // the public venue payload reports). Couple-facing copy, never setup advice.
  const media = await deps.loadVenueMedia(input.venueId);
  if (!isVenueReady(media)) {
    return { ok: false, status: 409, body: { error: COUPLE_UNAVAILABLE_MESSAGE, code: "venue_not_ready" } };
  }

  if ((await deps.countVenueSessionsToday(input.venueId)) >= VENUE_DAILY_SESSION_CAP) {
    return {
      ok: false,
      status: 429,
      body: { error: "This venue has reached its daily preview limit. Please try again tomorrow.", code: "venue_daily_cap" },
    };
  }
  if ((await deps.countVenueSessionsLastHour(input.venueId)) >= VENUE_HOURLY_SESSION_CAP) {
    return {
      ok: false,
      status: 429,
      body: { error: "This venue is busy right now. Please try again in a little while.", code: "venue_hourly_cap" },
    };
  }

  // Trial clock + balance (lib/trial.ts): a lapsed trial is blocked by time
  // even when credits remain; the code lets the couple app explain which.
  const spend = await deps.assertCanSpend(input.venueId, input.neededCredits);
  if (!spend.ok) {
    return { ok: false, status: 402, body: { error: SPEND_ERRORS[spend.reason], code: spend.reason }, spendReason: spend.reason };
  }

  // Optional bot check (only enforced when TURNSTILE_SECRET_KEY is set).
  const turnstile = await deps.verifyTurnstile(input.turnstileToken, input.clientIp);
  if (!turnstile.ok) {
    if (turnstile.reason === "verify_failed") {
      return {
        ok: false,
        status: 503,
        body: { error: "We couldn't confirm you're not a robot just now. Please try again in a moment.", code: "turnstile_unavailable" },
      };
    }
    return {
      ok: false,
      status: 400,
      body: { error: "Please complete the quick security check and try again.", code: "turnstile_failed" },
    };
  }

  try {
    await deps.validatePhotos(input.couplePhotoKeys, input.venueId);
  } catch (err) {
    return {
      ok: false,
      status: 400,
      body: {
        error: err instanceof Error ? err.message : "One or more couple photos are invalid. Upload clear images again.",
        code: "invalid_photos",
      },
    };
  }

  return { ok: true };
}

function liveGuardDeps(): SessionCreateGuardDeps {
  return {
    rateLimit,
    loadVenueMedia: (venueId) =>
      db.select({ coverage: venueMediaTable.coverage }).from(venueMediaTable).where(eq(venueMediaTable.venueId, venueId)),
    countVenueSessionsToday,
    countVenueSessionsLastHour,
    assertCanSpend,
    verifyTurnstile: (token, ip) => verifyTurnstileToken(token, ip),
    validatePhotos: validateCouplePhotoObjectKeys,
  };
}

/* ————— Owner credit nudges ————— */

/**
 * The low-credit email goes out once per dip: when the balance is at or
 * below the threshold and either no email was ever sent, or credits were
 * granted since the last one (a purchase lifted the balance in between).
 */
export function shouldSendLowCreditEmail(input: {
  balance: number;
  lowCreditNotifiedAt: Date | null;
  lastGrantAt: Date | null;
  threshold?: number;
}): boolean {
  if (!isLowCredit(input.balance, input.threshold ?? LOW_CREDIT_THRESHOLD)) return false;
  if (!input.lowCreditNotifiedAt) return true;
  return input.lastGrantAt != null && input.lastGrantAt.getTime() > input.lowCreditNotifiedAt.getTime();
}

type CreateVenueRow = {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string;
  organizationId: number | null;
};

async function notifyCreditsExhausted(
  venue: CreateVenueRow,
  reason: "trial_expired" | "insufficient_credits",
  coupleName: string | null,
): Promise<void> {
  void recordFunnelEvent({
    organizationId: venue.organizationId,
    venueId: venue.id,
    event: "credits_exhausted",
    properties: { reason },
    source: "server",
  });
  const scope = venue.organizationId != null ? `org:${venue.organizationId}` : `venue:${venue.id}`;
  if (!rateLimit(`exhausted-email:${scope}:${reason}`, 1, EXHAUSTED_EMAIL_WINDOW_MS)) return;
  const result = await sendOwnerCreditsExhausted({ ownerEmail: venue.ownerEmail, venue, coupleName, reason });
  if (!result.sent) logger.warn({ venueId: venue.id, reason: result.reason }, "Credits-exhausted owner email not sent");
}

/**
 * Credits that re-arm the low-credit email: purchases and grants only. A
 * session_refund gives back a credit the org already had, so it is not a new
 * grant and must not cause another "low credit" email after each failure.
 */
export function lowCreditGrantWhere(organizationId: number) {
  return and(
    eq(creditTransactionsTable.organizationId, organizationId),
    gt(creditTransactionsTable.delta, 0),
    ne(creditTransactionsTable.reason, "session_refund"),
  );
}

async function maybeSendLowCreditEmail(venue: CreateVenueRow): Promise<void> {
  if (venue.organizationId == null) return;
  const [org] = await db
    .select({
      creditsBalance: organizationsTable.creditsBalance,
      lowCreditNotifiedAt: organizationsTable.lowCreditNotifiedAt,
    })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, venue.organizationId));
  if (!org) return;
  const [grant] = await db
    .select({ createdAt: sql<Date | string | null>`max(${creditTransactionsTable.createdAt})` })
    .from(creditTransactionsTable)
    .where(lowCreditGrantWhere(venue.organizationId));
  const lastGrantAt = grant?.createdAt ? new Date(grant.createdAt) : null;
  if (!shouldSendLowCreditEmail({ balance: org.creditsBalance, lowCreditNotifiedAt: org.lowCreditNotifiedAt, lastGrantAt })) return;

  const [claimed] = await db
    .update(organizationsTable)
    .set({ lowCreditNotifiedAt: new Date() })
    .where(
      and(
        eq(organizationsTable.id, venue.organizationId),
        org.lowCreditNotifiedAt
          ? eq(organizationsTable.lowCreditNotifiedAt, org.lowCreditNotifiedAt)
          : isNull(organizationsTable.lowCreditNotifiedAt),
      ),
    )
    .returning({ id: organizationsTable.id });
  if (!claimed) return; // another request already sent it
  const result = await sendOwnerLowCredit({ ownerEmail: venue.ownerEmail, venue, creditsLeft: org.creditsBalance });
  if (!result.sent) logger.warn({ venueId: venue.id, reason: result.reason }, "Low-credit owner email not sent");
}

async function recordFirstGalleryIfNew(venue: CreateVenueRow): Promise<void> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coupleSessionsTable)
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .where(
      and(
        eq(coupleSessionsTable.kind, "couple"),
        venue.organizationId != null ? eq(venuesTable.organizationId, venue.organizationId) : eq(venuesTable.id, venue.id),
      ),
    );
  if ((row?.count ?? 0) === 1) {
    await recordFunnelEvent({ organizationId: venue.organizationId, venueId: venue.id, event: "first_gallery", source: "server" });
  }
}

/* ————— Owner session resolution (authenticate first, uniform 404) ————— */

type OwnerSessionContext = {
  ctx: OrgContext;
  session: typeof coupleSessionsTable.$inferSelect;
  venue: typeof venuesTable.$inferSelect;
};

/**
 * Every /sessions/:id route authenticates before touching the session table
 * and answers 404 for anything outside the caller's organization, so an
 * unauthenticated probe learns nothing about which ids exist.
 */
async function resolveOwnerSession(req: Request, res: Response, sessionId: number): Promise<OwnerSessionContext | null> {
  if (!requireOwnerMutationOrigin(req, res)) return null;
  const ctx = await requireOrg(req, res);
  if (!ctx) return null;

  const [row] = await db
    .select({ session: coupleSessionsTable, venue: venuesTable })
    .from(coupleSessionsTable)
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .where(and(eq(coupleSessionsTable.id, sessionId), eq(venuesTable.organizationId, ctx.org.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return { ctx, session: row.session, venue: row.venue };
}

/* ————— Routes ————— */

// POST /venues/:slug/sessions
router.post("/venues/:slug/sessions", async (req, res): Promise<void> => {
  const params = CreateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CreateSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message, code: "invalid_body" });
    return;
  }

  if (!body.data.coupleEmail || !EMAIL_REGEX.test(body.data.coupleEmail.trim())) {
    res.status(400).json({ error: "A valid couple email is required", code: "invalid_email" });
    return;
  }

  // Both partners agree to the AI preview and photo handling before any
  // photo is touched. Couple sessions never start without it.
  if (body.data.consent !== true) {
    res.status(400).json({
      error: "Please confirm that both of you agree to the AI preview and how your photos are handled.",
      code: "consent_required",
    });
    return;
  }

  if (
    body.data.couplePhotoKeys.length < MIN_COUPLE_PHOTOS ||
    body.data.couplePhotoKeys.length > MAX_COUPLE_PHOTOS
  ) {
    res.status(400).json({
      error: `Upload ${MIN_COUPLE_PHOTOS}-${MAX_COUPLE_PHOTOS} clear couple photos for best likeness.`,
      code: "photo_count",
    });
    return;
  }

  const styleId = body.data.styleId ?? DEFAULT_STYLE_ID;
  if (!findGalleryStyle(styleId)) {
    res.status(400).json({ error: "Choose a valid gallery style.", code: "invalid_style" });
    return;
  }

  const [venue] = await db
    .select({
      id: venuesTable.id,
      name: venuesTable.name,
      slug: venuesTable.slug,
      ownerEmail: venuesTable.ownerEmail,
      organizationId: venuesTable.organizationId,
    })
    .from(venuesTable)
    .where(eq(venuesTable.slug, params.data.slug));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const neededCredits = creditsForSession();
  const coupleName = body.data.coupleName?.trim() || null;

  const guard = await runSessionCreateGuards(
    {
      venueId: venue.id,
      clientIp: clientKey(req),
      couplePhotoKeys: body.data.couplePhotoKeys,
      turnstileToken: body.data.turnstileToken,
      neededCredits,
    },
    liveGuardDeps(),
  );
  if (!guard.ok) {
    if (guard.status === 402 && guard.spendReason) {
      // Credit exhaustion is a conversion moment for the owner, not a dead end.
      void notifyCreditsExhausted(venue, guard.spendReason, coupleName).catch((err) =>
        logger.warn({ err, venueId: venue.id }, "credits-exhausted notification failed"),
      );
    }
    res.status(guard.status).json(guard.body);
    return;
  }

  const normalizedEmail = body.data.coupleEmail.trim().toLowerCase();
  const createdVia: SessionCreatedVia = body.data.createdVia === "tour_day" ? "tour_day" : "couple_link";
  const weddingMonth = body.data.weddingMonth ?? null;

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
          coupleName,
          coupleEmail: normalizedEmail,
          shareToken: crypto.randomUUID(),
          creditsCharged: neededCredits,
          kind: "couple",
          createdVia,
          weddingMonth,
          consentAt: new Date(),
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
      res.status(409).json({
        error: "One of these uploads was already used or expired. Upload the photos again.",
        code: "stale_upload",
      });
      return;
    }
    throw err;
  }

  if (!session) {
    // Lost the race for the last credit between the guard and the debit.
    void notifyCreditsExhausted(venue, "insufficient_credits", coupleName).catch((err) =>
      logger.warn({ err, venueId: venue.id }, "credits-exhausted notification failed"),
    );
    res.status(402).json({ error: SPEND_ERRORS.insufficient_credits, code: "insufficient_credits" });
    return;
  }

  void sendSessionCreatedNotification(venue.ownerEmail, session, venue);
  void maybeSendLowCreditEmail(venue).catch((err) => logger.warn({ err, venueId: venue.id }, "low-credit check failed"));
  void recordFirstGalleryIfNew(venue).catch((err) => logger.warn({ err, venueId: venue.id }, "first-gallery event failed"));

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

  const owner = await resolveOwnerSession(req, res, params.data.id);
  if (!owner) return;
  const { session, venue } = owner;

  const venueMedia = await db
    .select()
    .from(venueMediaTable)
    .where(eq(venueMediaTable.venueId, venue.id))
    .orderBy(venueMediaTable.displayOrder);

  const generatedAssets = await db
    .select()
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, session.id))
    .orderBy(generatedAssetsTable.displayOrder);

  const [attempts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(renderAttemptsTable)
    .where(eq(renderAttemptsTable.sessionId, session.id));

  res.json(
    buildSessionDetailPayload(session, venue, venueMedia, generatedAssets, {
      includeEmail: true,
      renderAttempts: Number(attempts?.count ?? 0),
    }),
  );
});

// DELETE /sessions/:id  (owner session, organization admins only)
router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const sessionId = params.data.id;

  const owner = await resolveOwnerSession(req, res, sessionId);
  if (!owner) return;
  if (!requireOrgAdmin(owner.ctx)) {
    res.status(403).json({ error: "Only organization admins can delete galleries.", code: "org_admin_required" });
    return;
  }

  const generated = await db
    .select({ objectKey: generatedAssetsTable.objectKey })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId));
  const coupleMedia = await db
    .select({ objectKey: coupleMediaTable.objectKey })
    .from(coupleMediaTable)
    .where(eq(coupleMediaTable.sessionId, sessionId));

  // couple_media, generated_assets and gallery_events cascade with the
  // session row; credit_transactions keep their history with session_id null.
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

  // "viewed" has one writer (lib/galleryEvents.ts): a ready couple gallery
  // opened through its share link, deduped per viewer per UTC day. Owner
  // previews through the public URL count too; sample sessions never do.
  if (session.status === "ready" && !session.deliveryHoldReason && session.kind === "couple") {
    void recordGalleryEvent({
      sessionId: session.id,
      venueId: session.venueId,
      eventType: "viewed",
      source: "share_page",
      ipHash: hashClientIp(clientKey(req)),
    });
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

  const generatedAssets = canExposeGeneratedAssetsToSharePage(session.status, session.deliveryHoldReason)
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

// POST /sessions/by-token/:shareToken/events  (public share-page funnel events)
router.post("/sessions/by-token/:shareToken/events", async (req, res): Promise<void> => {
  const { shareToken } = req.params;
  if (!shareToken || shareToken.length < 16) {
    res.status(400).json({ error: "Share token required", code: "invalid_event" });
    return;
  }

  // "viewed" is server-recorded by GET by-token and is not in the body enum.
  const body = RecordGalleryEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Unsupported gallery event.", code: "invalid_event" });
    return;
  }

  if (!rateLimit(`gallery-event:${clientKey(req)}`, GALLERY_EVENT_IP_LIMIT, 10 * 60 * 1000)) {
    res.status(429).json({ error: "Too many events from this address. Try again later.", code: "rate_limited" });
    return;
  }

  const [session] = await db
    .select({
      id: coupleSessionsTable.id,
      venueId: coupleSessionsTable.venueId,
      kind: coupleSessionsTable.kind,
      weddingMonth: coupleSessionsTable.weddingMonth,
    })
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.shareToken, shareToken));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  // Sample galleries are owner demos; they never count in the funnel.
  if (session.kind !== "couple") {
    res.json({ recorded: false });
    return;
  }

  await recordGalleryEvent({
    sessionId: session.id,
    venueId: session.venueId,
    eventType: body.data.type,
    source: body.data.source ?? "share_page",
    ipHash: hashClientIp(clientKey(req)),
    meta: session.weddingMonth ? { weddingMonth: session.weddingMonth } : null,
  });
  res.json({ recorded: true });
});

/** Exact, case-insensitive match on the stored address: no LIKE/ILIKE, so `_` and `%` are literal. */
export function recoverableSessionsQuery(normalizedEmail: string) {
  return db
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
    .where(and(eq(sql`lower(${coupleSessionsTable.coupleEmail})`, normalizedEmail), eq(coupleSessionsTable.kind, "couple")))
    .orderBy(sql`${coupleSessionsTable.createdAt} desc`)
    .limit(50);
}

// POST /sessions/recover  (emails the couple their links; never reveals if the email exists)
router.post("/sessions/recover", async (req, res): Promise<void> => {
  const parsed = RecoverSessionsBody.safeParse(req.body);
  const email = parsed.success ? parsed.data.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_REGEX.test(email)) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  // Rate-limit BOTH per IP and per email so a single attacker can't enumerate
  // and a single inbox can't get spammed. 5 / 15 minutes per address, 3 per inbox.
  const windowMs = 15 * 60 * 1000;
  const ipOk = rateLimit(`recover:ip:${clientKey(req)}`, 5, windowMs);
  const emailOk = rateLimit(`recover:email:${email}`, 3, windowMs);
  if (!ipOk || !emailOk) {
    res.status(429).json({ error: "Too many recovery requests. Try again in a few minutes.", code: "rate_limited" });
    return;
  }

  try {
    const rows = await recoverableSessionsQuery(email);
    if (rows.length > 0) {
      void sendRecoveryEmail(email, rows);
    }
  } catch (err) {
    logger.error({ err }, "recovery lookup failed");
  }

  res.json({ accepted: true });
});

function galleryEmailOptions(
  venue: { name: string; bookingUrl: string | null; websiteUrl: string | null; contactEmail: string | null },
  session: { weddingMonth: string | null; coupleName: string | null },
) {
  return {
    venueName: venue.name,
    bookingCta: bookingCtaFor(venue, { weddingMonth: session.weddingMonth, coupleName: session.coupleName, medium: "email" }),
  };
}

// POST /sessions/:id/send-email  (owner-only, can override recipient)
router.post("/sessions/:id/send-email", async (req, res): Promise<void> => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }

  // Authenticate before any lookup: the send bucket is keyed on the caller's
  // organization, and unknown or foreign sessions are a uniform 404.
  const owner = await resolveOwnerSession(req, res, sessionId);
  if (!owner) return;
  const { ctx, session, venue } = owner;

  if (!rateLimit(`send:owner:${ctx.org.id}`, 30, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Owner send-email rate limit reached. Try again later." });
    return;
  }

  const override = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const recipient = override || session.coupleEmail || "";
  if (!recipient || !EMAIL_REGEX.test(recipient)) {
    res.status(400).json({ error: "Provide a valid email address." });
    return;
  }

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

  const result = await sendGalleryToCouple(recipient, session, venue, galleryEmailOptions(venue, session));
  if (!result.sent) {
    // The owner can act on the real cause (missing key, unverified sender
    // domain), so return it instead of a 200 that reads as success.
    res.status(502).json({ error: `Email not sent: ${result.reason}` });
    return;
  }
  if (session.deliveryHoldReason) {
    // The owner reviewed and sent it: the share link may show it now.
    await db
      .update(coupleSessionsTable)
      .set({ deliveryHoldReason: null })
      .where(eq(coupleSessionsTable.id, session.id));
  }
  if (session.kind === "couple") {
    void recordGalleryEvent({ sessionId: session.id, venueId: session.venueId, eventType: "sent", source: "dashboard" });
  }
  res.json({ sent: true });
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
  if (session.deliveryHoldReason) {
    // The venue reviews it first; only the owner's send releases it.
    res.status(409).json({ error: "The venue is taking a quick look first. It will be sent to you soon.", code: "delivery_held" });
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
    .select({
      name: venuesTable.name,
      bookingUrl: venuesTable.bookingUrl,
      websiteUrl: venuesTable.websiteUrl,
      contactEmail: venuesTable.contactEmail,
    })
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return;
  }

  const result = await sendGalleryToCouple(recipient, session, venue, galleryEmailOptions(venue, session));
  if (!result.sent) {
    // Couple-facing: keep the response gentle; the actionable detail is in
    // the server logs and the owner-side send flow.
    res.status(502).json({
      error:
        "We couldn't send the email right now. Copy your gallery link to keep it, and try again soon.",
    });
    return;
  }
  if (session.kind === "couple") {
    void recordGalleryEvent({ sessionId: session.id, venueId: session.venueId, eventType: "sent", source: "share_page" });
  }
  res.json({ sent: true });
});

export default router;
