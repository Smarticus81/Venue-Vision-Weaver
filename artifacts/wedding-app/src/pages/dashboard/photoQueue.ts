import { COVERAGES, isCoverage, nextCoverageFor, type Coverage } from "./activation";

/**
 * Pure planning for venue photo uploads: which files are accepted, how many
 * fit, and which coverage each one defaults to (the owner can change it
 * before uploading). No DOM, no network.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const MAX_VENUE_PHOTOS_PER_BATCH = 10;
/** Soft ceiling so the reference set stays curated. */
export const MAX_VENUE_PHOTOS = 20;

export interface QueuedPhotoPlan<F> {
  file: F;
  coverage: Coverage;
}

export interface UploadPlan<F> {
  accepted: QueuedPhotoPlan<F>[];
  rejected: Array<{ file: F; reason: "type" | "limit" }>;
}

export function isAcceptedImageType(type: string | null | undefined): boolean {
  return Boolean(type && (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type));
}

/**
 * Assigns each new file the coverage the venue most needs next, cycling as
 * the batch fills, so a five-file drop of a brand-new venue lands one photo
 * on each role. A forced coverage (the owner clicked one tile's "Add")
 * applies to every file in the batch.
 */
export function planUploads<F extends { type: string }>(
  files: ReadonlyArray<F>,
  media: ReadonlyArray<{ coverage?: string | null }>,
  options: { forceCoverage?: Coverage | null; existingQueued?: ReadonlyArray<Coverage>; maxBatch?: number; maxTotal?: number } = {},
): UploadPlan<F> {
  const maxBatch = options.maxBatch ?? MAX_VENUE_PHOTOS_PER_BATCH;
  const maxTotal = options.maxTotal ?? MAX_VENUE_PHOTOS;
  const queued: Coverage[] = [...(options.existingQueued ?? [])];
  const accepted: QueuedPhotoPlan<F>[] = [];
  const rejected: UploadPlan<F>["rejected"] = [];
  let room = Math.max(0, Math.min(maxBatch - queued.length, maxTotal - media.length - queued.length));
  for (const file of files) {
    if (!isAcceptedImageType(file.type)) {
      rejected.push({ file, reason: "type" });
      continue;
    }
    if (room <= 0) {
      rejected.push({ file, reason: "limit" });
      continue;
    }
    const coverage = options.forceCoverage && isCoverage(options.forceCoverage)
      ? options.forceCoverage
      : nextCoverageFor(media, queued);
    accepted.push({ file, coverage });
    queued.push(coverage);
    room -= 1;
  }
  return { accepted, rejected };
}

export interface CoverageTile {
  coverage: Coverage;
  label: string;
  hint: string;
  /** What the generator uses this view for. */
  scene: string;
}

export const COVERAGE_TILES: ReadonlyArray<CoverageTile> = [
  { coverage: "exterior", label: "Exterior", hint: "The approach or facade couples see first.", scene: "Arrival and portraits outside" },
  { coverage: "ceremony", label: "Ceremony", hint: "Where vows happen, set or empty.", scene: "The ceremony frame" },
  { coverage: "reception", label: "Reception", hint: "The dinner or dance space, lights on.", scene: "First dance and the room at night" },
  { coverage: "detail", label: "Detail", hint: "A corner, texture or feature you are proud of.", scene: "Close portraits with your materials" },
  { coverage: "natural_light", label: "Natural light", hint: "Any space in daylight, windows or garden.", scene: "Soft daylight portraits" },
];

export function coverageLabel(coverage: string | null | undefined): string {
  return COVERAGE_TILES.find((t) => t.coverage === coverage)?.label ?? String(coverage ?? "").replace(/_/g, " ");
}

/** Groups media by coverage in the fixed tile order. */
export function groupByCoverage<M extends { coverage?: string | null }>(media: ReadonlyArray<M>): Map<Coverage, M[]> {
  const out = new Map<Coverage, M[]>(COVERAGES.map((c) => [c, [] as M[]]));
  for (const item of media) {
    if (isCoverage(item.coverage)) out.get(item.coverage)!.push(item);
  }
  return out;
}
