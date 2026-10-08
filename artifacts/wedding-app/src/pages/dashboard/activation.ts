/**
 * Pure activation logic for the owner dashboard: readiness of the venue's
 * reference photos (the same rule the server applies in isVenueReady) and
 * the five-step checklist. No React, no network.
 */

export const COVERAGES = [
  "exterior",
  "ceremony",
  "reception",
  "detail",
  "natural_light",
] as const;
export type Coverage = (typeof COVERAGES)[number];

/** Server rule: at least this many photos AND every coverage role present. */
export const MIN_VENUE_REFERENCES = 5;

export function isCoverage(value: unknown): value is Coverage {
  return typeof value === "string" && (COVERAGES as readonly string[]).includes(value);
}

export interface VenueReadiness {
  ready: boolean;
  present: Coverage[];
  missing: Coverage[];
  count: number;
  /** Photos still needed before couples can start a gallery. */
  needed: number;
}

export function venueReadiness(
  media: ReadonlyArray<{ coverage?: string | null }>,
): VenueReadiness {
  const present = new Set<Coverage>();
  for (const item of media) if (isCoverage(item.coverage)) present.add(item.coverage);
  const missing = COVERAGES.filter((c) => !present.has(c));
  const count = media.length;
  const needed = Math.max(missing.length, MIN_VENUE_REFERENCES - count, 0);
  return {
    ready: missing.length === 0 && count >= MIN_VENUE_REFERENCES,
    present: COVERAGES.filter((c) => present.has(c)),
    missing,
    count,
    needed,
  };
}

/**
 * Which coverage a new photo should default to: the first role still
 * missing, cycling past the ones already queued in this batch, then the
 * least-covered role.
 */
export function nextCoverageFor(
  media: ReadonlyArray<{ coverage?: string | null }>,
  queued: ReadonlyArray<Coverage> = [],
): Coverage {
  const counts = new Map<Coverage, number>(COVERAGES.map((c) => [c, 0]));
  for (const item of media) if (isCoverage(item.coverage)) counts.set(item.coverage, (counts.get(item.coverage) ?? 0) + 1);
  for (const c of queued) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: Coverage = COVERAGES[0];
  let bestCount = Number.POSITIVE_INFINITY;
  for (const c of COVERAGES) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export type ActivationStepId =
  | "photos"
  | "booking_link"
  | "tour_card"
  | "first_gallery"
  | "plan";

export interface ActivationStep {
  id: ActivationStepId;
  done: boolean;
  /** Short progress note for a partially done step, e.g. "3 of 5 views". */
  detail: string | null;
}

export interface ActivationInput {
  readiness: VenueReadiness;
  bookingUrl: string | null | undefined;
  tourCardDownloadedAt: string | null | undefined;
  coupleGalleries: number;
  plan: string | null | undefined;
  firstPaidAt: string | null | undefined;
}

export interface ActivationState {
  steps: ActivationStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** The first step still open, or null when everything is done. */
  next: ActivationStepId | null;
}

export function computeActivation(input: ActivationInput): ActivationState {
  const { readiness } = input;
  const paid =
    Boolean(input.firstPaidAt) ||
    input.plan === "starter" ||
    input.plan === "growth" ||
    input.plan === "payg";
  const steps: ActivationStep[] = [
    {
      id: "photos",
      done: readiness.ready,
      detail: readiness.ready
        ? null
        : readiness.count === 0
          ? null
          : `${readiness.present.length} of ${COVERAGES.length} views`,
    },
    { id: "booking_link", done: Boolean(input.bookingUrl?.trim()), detail: null },
    { id: "tour_card", done: Boolean(input.tourCardDownloadedAt), detail: null },
    { id: "first_gallery", done: input.coupleGalleries > 0, detail: null },
    { id: "plan", done: paid, detail: null },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.id ?? null;
  return { steps, doneCount, total: steps.length, complete: next === null, next };
}

export type SpendCheck =
  | { ok: true }
  | { ok: false; reason: "trial_expired" | "insufficient_credits" };

/**
 * The dashboard's local copy of the server's spend rule (lib/trial.ts): an
 * expired trial blocks by time even with credits left; otherwise one credit
 * per gallery. The server re-checks and answers 402 with the same codes.
 */
export function localSpendCheck(org: {
  creditsBalance: number;
  trial?: { onTrial: boolean; expired: boolean } | null;
}): SpendCheck {
  if (org.trial?.onTrial && org.trial.expired) return { ok: false, reason: "trial_expired" };
  if (org.creditsBalance < 1) return { ok: false, reason: "insufficient_credits" };
  return { ok: true };
}

/** Days left on a trial, floored at zero; null when no end date is known. */
export function trialDaysLeft(endsAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}
