import type { SpendCheck, VenueReadiness } from "./activation";
import { isAcceptedImageType } from "./photoQueue";

/**
 * Pure rules for starting a couple's gallery from the dashboard or from
 * tour-day mode. They mirror POST /venues/{slug}/sessions (2-3 couple photos,
 * a valid couple email, both partners' consent, YYYY-MM wedding month, venue
 * ready, a credit to spend) so the button is honest before the server says
 * no. The server re-checks everything.
 */

export const MIN_COUPLE_PHOTOS = 2;
export const MAX_COUPLE_PHOTOS = 3;
export const COUPLE_NAME_MAX = 80;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidWeddingMonth(value: string | null | undefined): boolean {
  return !value || MONTH_RE.test(value);
}

export type CaptureIssue =
  | "venue_not_ready"
  | "spend_blocked"
  | "photos"
  | "email"
  | "month"
  | "consent";

export interface CaptureInput {
  photoCount: number;
  email: string;
  weddingMonth: string | null;
  consent: boolean;
  readiness: Pick<VenueReadiness, "ready">;
  spend: SpendCheck;
}

/** Every reason the gallery cannot start yet, in the order the owner fixes them. */
export function captureIssues(input: CaptureInput): CaptureIssue[] {
  const issues: CaptureIssue[] = [];
  if (!input.readiness.ready) issues.push("venue_not_ready");
  if (!input.spend.ok) issues.push("spend_blocked");
  if (input.photoCount < MIN_COUPLE_PHOTOS || input.photoCount > MAX_COUPLE_PHOTOS) issues.push("photos");
  if (!isValidEmail(input.email)) issues.push("email");
  if (!isValidWeddingMonth(input.weddingMonth)) issues.push("month");
  if (!input.consent) issues.push("consent");
  return issues;
}

/** One short line for the first open issue, shown beside the disabled button. */
export function captureHint(issues: ReadonlyArray<CaptureIssue>, photoCount: number): string | null {
  const first = issues[0];
  switch (first) {
    case undefined:
      return null;
    case "venue_not_ready":
      return "Finish your five venue photos first.";
    case "spend_blocked":
      return "Add credits or pick a plan to start this gallery.";
    case "photos": {
      const need = Math.max(0, MIN_COUPLE_PHOTOS - photoCount);
      return need > 0
        ? `Add ${need} more ${need === 1 ? "photo" : "photos"} of the couple.`
        : `Use at most ${MAX_COUPLE_PHOTOS} photos.`;
    }
    case "email":
      return "Add the couple's email so the gallery reaches them.";
    case "month":
      return "Pick the wedding month from the list.";
    case "consent":
      return "Confirm both of them agreed.";
  }
}

export interface PhotoSelection<F> {
  accepted: F[];
  rejectedType: number;
  overflow: number;
}

/** Adds picked files to the current selection without passing the cap. */
export function addCouplePhotos<F extends { type: string }>(
  current: ReadonlyArray<F>,
  picked: ReadonlyArray<F>,
  max = MAX_COUPLE_PHOTOS,
): PhotoSelection<F> {
  const accepted: F[] = [...current];
  let rejectedType = 0;
  let overflow = 0;
  for (const file of picked) {
    if (!isAcceptedImageType(file.type)) {
      rejectedType += 1;
      continue;
    }
    if (accepted.length >= max) {
      overflow += 1;
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejectedType, overflow };
}

/** Owner copy for the session-create error codes the API returns. */
export function createSessionErrorCopy(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case "venue_not_ready":
      return "The venue needs all five photo views before galleries can start.";
    case "photo_count":
      return `Use ${MIN_COUPLE_PHOTOS} or ${MAX_COUPLE_PHOTOS} photos of the couple.`;
    case "invalid_email":
      return "Check the couple's email address.";
    case "consent_required":
      return "Confirm both partners agreed before starting.";
    case "invalid_photos":
      return "One of the photos could not be used. Try a clearer, well-lit photo of both of them.";
    case "stale_upload":
      return "One of the uploads expired. Add the photos again.";
    case "venue_daily_cap":
    case "venue_hourly_cap":
      return "Your venue hit its gallery limit for now. Try again a little later.";
    case "rate_limited":
      return "Too many galleries from this connection. Wait a few minutes and try again.";
    default:
      return fallback;
  }
}
