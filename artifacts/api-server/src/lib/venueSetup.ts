import { DEMO_NOT_CONFIGURED_CODE, type SamplePhotoOutcome } from "./sampleGallery.js";
import { importOnCooldown, normalizeWebsiteUrl } from "./websiteMediaImport.js";
import { isVenueReady } from "./venueResponse.js";

/*
 * Pure cores of the venue-setup routes (POST /venues/{slug}/sessions/{id}/booked,
 * /media/import-website, /sample-gallery, /tour-card-downloaded and the PATCH
 * incentive line). Routes in routes/venues.ts wire them to the database; the
 * rules live here so they are unit-tested without Postgres or Clerk.
 */

/* ————— Incentive line ————— */

export const INCENTIVE_TEXT_MAX = 160;

/**
 * One plain line for the share page and gallery email: control characters and
 * line breaks become spaces, runs of whitespace collapse, empty clears it.
 */
export function normalizeIncentiveText(value: string | null | undefined): string | null {
  if (value == null) return null;
  // eslint-disable-next-line no-control-regex
  const flattened = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  if (!flattened) return null;
  return flattened.slice(0, INCENTIVE_TEXT_MAX);
}

/* ————— Booked marker ————— */

export interface BookableSession {
  id: number;
  venueId: number;
  kind: string;
  bookedAt: Date | null;
  bookedBy: string | null;
}

export type BookedPlan =
  | { kind: "noop" }
  | { kind: "refuse"; status: 409; error: string; code: "sample_session" }
  | { kind: "set"; bookedAt: Date | null; bookedBy: string | null; eventType: "booked" | "unbooked" };

/**
 * What a booked toggle should do. Idempotent by design: asking for the state
 * the session is already in changes nothing and records no event, so a double
 * click or a retried request never double-counts a booking.
 */
export function planBookedChange(
  session: Pick<BookableSession, "kind" | "bookedAt">,
  booked: boolean,
  actor: string,
  now: Date,
): BookedPlan {
  if (session.kind !== "couple") {
    return {
      kind: "refuse",
      status: 409,
      error: "Sample galleries are demos of our test couple; only real couples can be marked as booked.",
      code: "sample_session",
    };
  }
  const isBooked = session.bookedAt != null;
  if (booked === isBooked) return { kind: "noop" };
  return booked
    ? { kind: "set", bookedAt: now, bookedBy: actor, eventType: "booked" }
    : { kind: "set", bookedAt: null, bookedBy: null, eventType: "unbooked" };
}

export interface BookedStore<S extends BookableSession> {
  loadSession(venueId: number, sessionId: number): Promise<S | null>;
  /**
   * Conditional write: applies only while the row is still in the opposite
   * state (booked_at null for a booking, not null for an undo). Returns the
   * updated row, or null when another request got there first.
   */
  writeBooked(sessionId: number, change: { bookedAt: Date | null; bookedBy: string | null }): Promise<S | null>;
  recordEvent(session: S, eventType: "booked" | "unbooked", actor: string): Promise<void>;
}

export type BookedOutcome<S> =
  | { ok: true; session: S; changed: boolean }
  | { ok: false; status: 404 | 409; error: string; code?: string };

export async function setSessionBooked<S extends BookableSession>(
  store: BookedStore<S>,
  input: { venueId: number; sessionId: number; booked: boolean; actor: string; now?: Date },
): Promise<BookedOutcome<S>> {
  const session = await store.loadSession(input.venueId, input.sessionId);
  if (!session) return { ok: false, status: 404, error: "Session not found" };

  const plan = planBookedChange(session, input.booked, input.actor, input.now ?? new Date());
  if (plan.kind === "refuse") return { ok: false, status: plan.status, error: plan.error, code: plan.code };
  if (plan.kind === "noop") return { ok: true, session, changed: false };

  const updated = await store.writeBooked(session.id, { bookedAt: plan.bookedAt, bookedBy: plan.bookedBy });
  if (!updated) {
    // A concurrent request already applied the same toggle: answer with the
    // current row and do not record a second event.
    const current = await store.loadSession(input.venueId, input.sessionId);
    if (!current) return { ok: false, status: 404, error: "Session not found" };
    return { ok: true, session: current, changed: false };
  }
  await store.recordEvent(updated, plan.eventType, input.actor);
  return { ok: true, session: updated, changed: true };
}

/** "owner:<clerkUserId>" (the schema also allows "operator:<email>"). */
export function ownerActor(clerkUserId: string): string {
  return `owner:${clerkUserId}`;
}

/* ————— Tour card ————— */

export interface TourCardStore<V> {
  /** Sets tour_card_downloaded_at only while it is null; null when it was already set. */
  stampFirstDownload(venueId: number, now: Date): Promise<V | null>;
  reload(venueId: number): Promise<V | null>;
  recordFirstDownload(venue: V): Promise<void>;
}

/**
 * Record the checklist tick. Repeat downloads keep the first timestamp and
 * never re-log the funnel event, so the KPI counts venues, not clicks.
 */
export async function markTourCardDownloaded<V>(
  store: TourCardStore<V>,
  venueId: number,
  now = new Date(),
): Promise<{ venue: V; firstTime: boolean } | null> {
  const stamped = await store.stampFirstDownload(venueId, now);
  if (stamped) {
    await store.recordFirstDownload(stamped);
    return { venue: stamped, firstTime: true };
  }
  const current = await store.reload(venueId);
  return current ? { venue: current, firstTime: false } : null;
}

/* ————— Website import ————— */

export type ImportRequest =
  | { ok: true; websiteUrl: string; override: boolean }
  | { ok: false; status: 400 | 429; error: string; code: string };

/**
 * Validate the request before anything is fetched or claimed: the URL (body
 * override, else the venue's saved website) and the per-venue cooldown. The
 * messages match lib/websiteMediaImport.ts.
 */
export function planWebsiteImport(input: {
  /** Body websiteUrl (already shape-checked by ImportVenueWebsiteMediaBody). */
  websiteUrlOverride?: string | null;
  venueWebsiteUrl: string | null;
  websiteImportedAt: Date | null;
  now: Date;
}): ImportRequest {
  const override = input.websiteUrlOverride?.trim() ?? "";
  const websiteUrl = override ? normalizeWebsiteUrl(override) : normalizeWebsiteUrl(input.venueWebsiteUrl);
  if (override && !websiteUrl) {
    return { ok: false, status: 400, error: "Website URL must be a valid http or https address.", code: "invalid_website_url" };
  }
  if (!websiteUrl) {
    return {
      ok: false,
      status: 400,
      error: "Add your venue's website address first, then import photos from it.",
      code: "no_website_url",
    };
  }
  if (importOnCooldown(input.websiteImportedAt, input.now)) {
    return {
      ok: false,
      status: 429,
      error: "Photos were imported from this website a few minutes ago. Review those first, then try again.",
      code: "import_cooldown",
    };
  }
  return { ok: true, websiteUrl, override: Boolean(override) };
}

/** Display orders for appended media: after the highest existing order. */
export function appendDisplayOrders(existingOrders: number[], count: number): number[] {
  const start = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;
  return Array.from({ length: count }, (_, index) => start + index);
}

/* ————— Sample gallery ————— */

/** Samples that did not fail, per venue. A failed sample can be retried. */
export const MAX_SAMPLES_PER_VENUE = 2;

export interface SampleCounts {
  /** Sample sessions still pending or processing. */
  inFlight: number;
  /** Sample sessions that did not fail (pending, processing, ready). */
  nonFailed: number;
}

export type SampleRefusal = {
  ok: false;
  status: 409;
  error: string;
  code: "venue_not_ready" | "sample_in_progress" | "sample_limit" | typeof DEMO_NOT_CONFIGURED_CODE;
};

/** Cheap checks before any demo photo is copied. */
export function checkSampleAllowed(
  media: ReadonlyArray<{ coverage?: string | null }>,
  counts: SampleCounts,
  maxSamples = MAX_SAMPLES_PER_VENUE,
): SampleRefusal | { ok: true } {
  if (!isVenueReady(media)) {
    return {
      ok: false,
      status: 409,
      error: "Add your five venue photos first; the sample is built from them.",
      code: "venue_not_ready",
    };
  }
  if (counts.inFlight > 0) {
    return {
      ok: false,
      status: 409,
      error: "A sample is already rendering for this venue. It usually takes a few minutes.",
      code: "sample_in_progress",
    };
  }
  if (counts.nonFailed >= maxSamples) {
    return {
      ok: false,
      status: 409,
      error: `This venue already has ${maxSamples} sample galleries. Make a gallery for a real couple next.`,
      code: "sample_limit",
    };
  }
  return { ok: true };
}

export interface SampleGalleryDeps<S> {
  loadMedia(venueId: number): Promise<Array<{ coverage?: string | null }>>;
  countSamples(venueId: number): Promise<SampleCounts>;
  /** Copy the demo couple's photos into private upload objects. */
  preparePhotos(): Promise<SamplePhotoOutcome>;
  /**
   * Insert the sample session and its couple_media rows. Must re-check the
   * counts under a venue row lock; returns a refusal when a concurrent request
   * won the race.
   */
  insertSession(venueId: number, objectKeys: string[]): Promise<{ ok: true; session: S } | SampleRefusal>;
  /** Best-effort cleanup of copied photos when the insert was refused. */
  discardPhotos(objectKeys: string[]): Promise<void>;
}

export async function startSampleGallery<S>(
  deps: SampleGalleryDeps<S>,
  venueId: number,
): Promise<{ ok: true; session: S } | SampleRefusal> {
  const allowed = checkSampleAllowed(await deps.loadMedia(venueId), await deps.countSamples(venueId));
  if (!allowed.ok) return allowed;

  const photos = await deps.preparePhotos();
  if (!photos.ok) return { ok: false, status: 409, error: photos.error, code: photos.code };

  const inserted = await deps.insertSession(venueId, photos.objectKeys);
  if (!inserted.ok) await deps.discardPhotos(photos.objectKeys).catch(() => undefined);
  return inserted;
}
