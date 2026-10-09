import {
  collectImageCandidates,
  defaultResearchDeps,
  resolveUrl,
  stripTags,
  type FetchedPage,
} from "../control-plane/outreach/venueResearch.js";
import { logger } from "./logger.js";
import { ObjectStorageService, assertNormalizedUploadObjectPath } from "./objectStorage.js";
import {
  assertReferenceImageQuality,
  hammingDistance,
  MIN_REFERENCE_EDGE_PX,
  NEAR_DUPLICATE_HAMMING,
  type ReferenceImageQuality,
} from "./referenceImageQuality.js";
import {
  VENUE_MEDIA_COVERAGES,
  venueMediaCoverageStatus,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";

/*
 * "Import photos from your website" for venue onboarding (shared-contract 2.3
 * POST /venues/{slug}/media/import-website).
 *
 * The network-facing parts reuse the outreach studio's SSRF-guarded fetchers
 * (control-plane/outreach/venueResearch.ts: public-host check, DNS resolution
 * against private ranges, byte caps, timeouts, manual redirects) through its
 * exported defaultResearchDeps(); nothing in that file is edited. Selection,
 * coverage guessing and the storage write live here and are unit-tested with
 * injected deps.
 */

export const IMPORT_LIMITS = {
  /** Homepage plus this many venue-ish subpages. */
  maxSubpages: 2,
  maxDownloads: 10,
  /** New media rows one import may add. */
  maxImported: 5,
  /** Hard ceiling on venue media after import (owner can still upload more). */
  maxTotalMedia: 12,
  /** Two imports of the same venue must be at least this far apart. */
  cooldownMs: 10 * 60 * 1000,
} as const;

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUBPAGE_HINT = /wedding|venue|space|gallery|photo|event|tour|ceremony|reception|celebrat/i;

export interface ImportedMediaDraft {
  objectKey: string;
  coverage: VenueMediaCoverage;
  perceptualHash: string;
  width: number;
  height: number;
  contentType: string;
  sourceUrl: string;
}

export interface ExistingMediaRow {
  objectKey: string;
  coverage: string | null;
  perceptualHash: string | null;
}

export interface WebsiteImportInput {
  venue: { id: number; name: string; websiteUrl: string | null; websiteImportedAt: Date | null };
  /** Body override; validated and returned as `websiteUrl` so the route can persist it. */
  websiteUrlOverride?: string | null;
  existing: ExistingMediaRow[];
  now?: Date;
}

export interface WebsiteImportDeps {
  fetchPage(url: string): Promise<FetchedPage | null>;
  fetchBinary(url: string): Promise<{ buffer: Buffer; contentType: string | null } | null>;
  /** Quality + perceptual hash of the original bytes; throws when unusable. */
  inspect(buffer: Buffer, label: string): Promise<ReferenceImageQuality>;
  /** Persist as a private upload object; returns the /objects/uploads/... key. */
  store(buffer: Buffer, contentType: string): Promise<string>;
}

export type WebsiteImportOutcome =
  | { ok: false; status: 400 | 429; error: string; code: string }
  | {
      ok: true;
      websiteUrl: string;
      candidatesFound: number;
      warnings: string[];
      media: ImportedMediaDraft[];
    };

/** Normalise a website URL (scheme optional); null when it is not http(s). */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** True when the venue imported recently enough that another run should wait. */
export function importOnCooldown(websiteImportedAt: Date | null, now: Date, cooldownMs = IMPORT_LIMITS.cooldownMs): boolean {
  return websiteImportedAt != null && now.getTime() - websiteImportedAt.getTime() < cooldownMs;
}

const COVERAGE_HINTS: Array<[VenueMediaCoverage, RegExp]> = [
  ["ceremony", /ceremony|altar|aisle|chapel|vows|arch|garden wedding/i],
  ["reception", /reception|ballroom|dinner|dining|tables|dance|banquet|tent|barn interior/i],
  ["exterior", /exterior|facade|outside|aerial|drone|estate|grounds|entrance|front|building|barn|manor|lawn|view of/i],
  ["natural_light", /window|sunlight|sunset|golden hour|daylight|natural light|terrace|patio|veranda|porch/i],
  ["detail", /detail|decor|table ?scape|centerpiece|florals?|flowers|chandelier|cake|place setting|close[- ]?up/i],
];

/** Best-effort coverage role from alt text and URL words; null when nothing matches. */
export function guessCoverage(alt: string | null, url: string): VenueMediaCoverage | null {
  const haystack = `${alt ?? ""} ${decodeURIComponent(url).replace(/[-_/.]+/g, " ")}`;
  for (const [coverage, pattern] of COVERAGE_HINTS) {
    if (pattern.test(haystack)) return coverage;
  }
  return null;
}

/**
 * Assign coverage roles to imported photos: keyword guesses first, then fill
 * the roles the venue still lacks (in catalogue order), then "detail".
 */
export function assignCoverages(
  guesses: Array<VenueMediaCoverage | null>,
  existingCoverages: Array<string | null>,
): VenueMediaCoverage[] {
  const present = new Set<string>(existingCoverages.filter((c): c is string => !!c));
  const assigned: VenueMediaCoverage[] = [];
  for (const guess of guesses) {
    if (guess && !present.has(guess)) {
      present.add(guess);
      assigned.push(guess);
      continue;
    }
    assigned.push(guess ?? "detail");
  }
  // Second pass: unguessed photos take the still-missing roles.
  const missing = VENUE_MEDIA_COVERAGES.filter((coverage) => !present.has(coverage));
  for (let i = 0; i < assigned.length && missing.length > 0; i += 1) {
    if (guesses[i] == null) {
      const next = missing.shift()!;
      assigned[i] = next;
      present.add(next);
    }
  }
  return assigned;
}

function pickSubpages(html: string, pageUrl: string, max: number): string[] {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }
  const picked: string[] = [];
  const seen = new Set<string>([pageUrl.replace(/\/$/, "")]);
  for (const match of html.matchAll(/<a\b[^>]*href=("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[2] ?? match[3];
    const label = stripTags(match[4] ?? "");
    const url = resolveUrl(pageUrl, href);
    if (!url || !url.startsWith(origin)) continue;
    const normalized = url.replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    let pathname = "";
    try {
      pathname = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!SUBPAGE_HINT.test(`${label} ${pathname}`)) continue;
    if (/\.(pdf|jpe?g|png|webp|zip|mp4)$/i.test(url)) continue;
    seen.add(normalized);
    picked.push(url);
    if (picked.length >= max) break;
  }
  return picked;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Pull candidate space photos from the venue's own site. Returns drafts for
 * the route to insert (the owner confirms or deletes them afterwards).
 */
export async function importWebsiteMedia(input: WebsiteImportInput, deps: WebsiteImportDeps): Promise<WebsiteImportOutcome> {
  const now = input.now ?? new Date();
  const override = input.websiteUrlOverride?.trim();
  const websiteUrl = override ? normalizeWebsiteUrl(override) : normalizeWebsiteUrl(input.venue.websiteUrl);
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
  if (importOnCooldown(input.venue.websiteImportedAt, now)) {
    return {
      ok: false,
      status: 429,
      error: "Photos were imported from this website a few minutes ago. Review those first, then try again.",
      code: "import_cooldown",
    };
  }

  const warnings: string[] = [];
  const room = Math.max(0, Math.min(IMPORT_LIMITS.maxImported, IMPORT_LIMITS.maxTotalMedia - input.existing.length));
  if (room === 0) {
    return {
      ok: true,
      websiteUrl,
      candidatesFound: 0,
      warnings: ["This venue already has the maximum number of reference photos. Delete a few before importing more."],
      media: [],
    };
  }

  let home: FetchedPage | null = null;
  try {
    home = await deps.fetchPage(websiteUrl);
  } catch (err) {
    logger.warn({ err, websiteUrl }, "Website import: homepage fetch threw");
  }
  if (!home) {
    return {
      ok: true,
      websiteUrl,
      candidatesFound: 0,
      warnings: [`We could not load ${hostnameOf(websiteUrl)}. The site may block automated visits; upload photos directly instead.`],
      media: [],
    };
  }

  const pages: Array<{ url: string; html: string }> = [{ url: home.finalUrl, html: home.html }];
  for (const subpage of pickSubpages(home.html, home.finalUrl, IMPORT_LIMITS.maxSubpages)) {
    try {
      const fetched = await deps.fetchPage(subpage);
      if (fetched) pages.push({ url: fetched.finalUrl, html: fetched.html });
    } catch (err) {
      logger.debug({ err, subpage }, "Website import: subpage fetch failed");
    }
  }

  const candidates: ReturnType<typeof collectImageCandidates> = [];
  const seenUrls = new Set<string>();
  for (const page of pages) {
    for (const candidate of collectImageCandidates(page.html, page.url)) {
      if (seenUrls.has(candidate.url)) continue;
      seenUrls.add(candidate.url);
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const knownHashes = input.existing.map((row) => row.perceptualHash).filter((hash): hash is string => !!hash);
  const kept: Array<Omit<ImportedMediaDraft, "coverage"> & { guess: VenueMediaCoverage | null }> = [];
  let downloads = 0;
  let rejectedQuality = 0;
  let rejectedDuplicate = 0;

  for (const candidate of candidates) {
    if (downloads >= IMPORT_LIMITS.maxDownloads || kept.length >= room) break;
    downloads += 1;
    let fetched: { buffer: Buffer; contentType: string | null } | null = null;
    try {
      fetched = await deps.fetchBinary(candidate.url);
    } catch (err) {
      logger.debug({ err, url: candidate.url }, "Website import: image fetch failed");
    }
    if (!fetched) continue;
    const contentType = (fetched.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) continue;

    let quality: ReferenceImageQuality;
    try {
      quality = await deps.inspect(fetched.buffer, `Photo from ${hostnameOf(candidate.url)}`);
    } catch {
      rejectedQuality += 1;
      continue;
    }
    const duplicate =
      knownHashes.some((hash) => hammingDistance(hash, quality.perceptualHash) <= NEAR_DUPLICATE_HAMMING) ||
      kept.some((image) => hammingDistance(image.perceptualHash, quality.perceptualHash) <= NEAR_DUPLICATE_HAMMING);
    if (duplicate) {
      rejectedDuplicate += 1;
      continue;
    }

    let objectKey: string;
    try {
      objectKey = await deps.store(fetched.buffer, contentType);
    } catch (err) {
      logger.warn({ err, url: candidate.url }, "Website import: storing photo failed");
      warnings.push("One or more photos could not be saved to storage.");
      continue;
    }
    kept.push({
      objectKey,
      perceptualHash: quality.perceptualHash,
      width: quality.width,
      height: quality.height,
      contentType,
      sourceUrl: candidate.url,
      guess: guessCoverage(candidate.alt, candidate.url),
    });
  }

  const coverages = assignCoverages(
    kept.map((image) => image.guess),
    input.existing.map((row) => row.coverage),
  );
  const media: ImportedMediaDraft[] = kept.map(({ guess: _guess, ...image }, index) => ({
    ...image,
    coverage: coverages[index] ?? "detail",
  }));

  if (media.length === 0) {
    warnings.unshift(
      `No usable photos were found on ${hostnameOf(home.finalUrl)} (need at least ${MIN_REFERENCE_EDGE_PX}px on each side). Upload your five space photos directly.`,
    );
  } else {
    const after = venueMediaCoverageStatus([
      ...input.existing.map((row) => ({ coverage: row.coverage })),
      ...media.map((item) => ({ coverage: item.coverage })),
    ]);
    if (!after.ready) {
      warnings.push(
        `Imported ${media.length} photo${media.length === 1 ? "" : "s"}. Check the suggested roles, then add the missing ones: ${after.missing.join(", ")}.`,
      );
    } else {
      warnings.push(`Imported ${media.length} photo${media.length === 1 ? "" : "s"}. Check the suggested roles before couples arrive.`);
    }
  }
  if (rejectedQuality > 0) warnings.push(`${rejectedQuality} photo${rejectedQuality === 1 ? " was" : "s were"} too small or too dark to use.`);
  if (rejectedDuplicate > 0) warnings.push(`${rejectedDuplicate} near-duplicate photo${rejectedDuplicate === 1 ? " was" : "s were"} skipped.`);

  return { ok: true, websiteUrl, candidatesFound: candidates.length, warnings, media };
}

/* ————— Live deps ————— */

function extensionForMime(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  return ".jpg";
}

/**
 * Write a buffer as a private upload object (the same /objects/uploads/...
 * namespace the browser uploads into), so imported photos flow through the
 * existing media and pipeline code paths unchanged.
 */
export async function uploadBufferAsUploadObject(
  storage: ObjectStorageService,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const uploadURL = await storage.getObjectEntityUploadURL(extensionForMime(contentType));
  const objectKey = storage.normalizeObjectEntityPath(uploadURL);
  assertNormalizedUploadObjectPath(objectKey);
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": contentType, "Content-Length": String(buffer.length) },
    body: buffer,
  });
  if (!res.ok) {
    throw new Error(`Storage upload failed with status ${res.status}: ${res.statusText}`);
  }
  return objectKey;
}

export function defaultWebsiteImportDeps(storage = new ObjectStorageService()): WebsiteImportDeps {
  const research = defaultResearchDeps();
  return {
    fetchPage: (url) => research.fetchPage(url),
    fetchBinary: (url) => research.fetchBinary(url),
    inspect: (buffer, label) =>
      assertReferenceImageQuality({ buffer, label, minEdgePx: MIN_REFERENCE_EDGE_PX, profile: "venue" }),
    store: (buffer, contentType) => uploadBufferAsUploadObject(storage, buffer, contentType),
  };
}
