/*
 * Couple share-page helpers: the share link, the venue's date CTA, gallery
 * funnel events, the "who made this gallery" marker, and the pairing of each
 * AI still with the real venue photo it was imagined from.
 *
 * Pure functions take their browser dependencies as arguments so the node
 * test suite (shareSession.test.ts) can exercise them without a DOM.
 */
import type {
  GalleryEventBody,
  GalleryEventBodyType,
  GeneratedAsset,
  VenueMediaCoverage,
  VenueMediaItem,
} from "@workspace/api-client-react";

/* ————— Share link ————— */

export function shareUrlFor(shareToken: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/v/${encodeURIComponent(shareToken)}`;
}

export interface ShareTarget {
  shareToken: string;
  venueName: string | null;
  coupleName: string | null;
}

export function shareText(target: ShareTarget): { title: string; text: string } {
  const venue = target.venueName?.trim();
  const couple = target.coupleName?.trim();
  return {
    title: couple ? `${couple} at ${venue || "our venue"}` : `Our day at ${venue || "our venue"}`,
    text: venue ? `An AI preview of our wedding at ${venue}.` : "An AI preview of our wedding day.",
  };
}

export async function copyShareLink(shareToken: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(shareUrlFor(shareToken, window.location.origin));
    return true;
  } catch {
    return false;
  }
}

/** Native share sheet when the device has one, otherwise copy the link. */
export async function shareGallery(target: ShareTarget): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  const url = shareUrlFor(target.shareToken, window.location.origin);
  const { title, text } = shareText(target);
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "cancelled";
    }
  }
  return (await copyShareLink(target.shareToken)) ? "copied" : "failed";
}

/* ————— Wedding month ————— */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function isWeddingMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** "2027-06" -> "June 2027"; anything else -> null. */
export function formatWeddingMonth(value: string | null | undefined): string | null {
  if (!isWeddingMonth(value)) return null;
  const [, year, month] = MONTH_PATTERN.exec(value)!;
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/**
 * Month choices for the "When are you thinking?" select: this month through
 * the next three years, which covers how far ahead venues book.
 */
export function weddingMonthOptions(now: Date, months = 37): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const year = now.getFullYear();
  const month = now.getMonth();
  for (let i = 0; i < months; i++) {
    const d = new Date(year, month + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    options.push({ value, label: formatWeddingMonth(value)! });
  }
  return options;
}

/* ————— Date CTA ————— */

export interface DateCtaVenue {
  name: string;
  bookingUrl?: string | null;
  websiteUrl?: string | null;
  contactEmail?: string | null;
}

export interface DateCta {
  /** "Check your date at {venue}" — the apex button. */
  label: string;
  /** "Hold your date" — the compact sticky-bar button. */
  shortLabel: string;
  href: string;
  /** True for http(s) targets (open in a new tab); false for mailto. */
  external: boolean;
}

function httpUrl(raw: string | null | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The share-page date CTA (step0-merge-decisions E10), mirroring the server's
 * bookingCtaFor so the page and the gallery email agree: bookingUrl, then
 * websiteUrl, then a mailto to the venue's contact email. Web targets carry
 * utm_source=dreemer&utm_medium=gallery and the couple's wedding month.
 * Never "Book a tour": the couple has already toured. Null when the venue
 * has nowhere to send the couple.
 */
export function dateCtaFor(
  venue: DateCtaVenue | null | undefined,
  options: { weddingMonth?: string | null; coupleName?: string | null; medium?: string } = {},
): DateCta | null {
  if (!venue?.name) return null;
  const label = `Check your date at ${venue.name}`;
  const shortLabel = "Hold your date";
  const month = isWeddingMonth(options.weddingMonth) ? options.weddingMonth : null;
  const target = httpUrl(venue.bookingUrl) ?? httpUrl(venue.websiteUrl);
  if (target) {
    target.searchParams.set("utm_source", "dreemer");
    target.searchParams.set("utm_medium", options.medium ?? "gallery");
    target.searchParams.set("utm_campaign", "hold_your_date");
    if (month) target.searchParams.set("wedding_month", month);
    return { label, shortLabel, href: target.toString(), external: true };
  }
  const email = venue.contactEmail?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const monthLabel = formatWeddingMonth(month);
  const subject = `Our date at ${venue.name}${monthLabel ? ` (${monthLabel})` : ""}`;
  const lines = [
    `Hi ${venue.name},`,
    "",
    `We just saw our Dreemer gallery and would like to check availability${monthLabel ? ` for ${monthLabel}` : ""}.`,
  ];
  const couple = options.coupleName?.trim();
  if (couple) lines.push("", couple);
  const params = new URLSearchParams({ subject, body: lines.join("\n") });
  return {
    label,
    shortLabel,
    href: `mailto:${email}?${params.toString().replace(/\+/g, "%20")}`,
    external: false,
  };
}

/* ————— Gallery events ————— */

export type GalleryEventType = GalleryEventBodyType;

type EventFetch = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;

/**
 * Records a share-page event (shared, cta_click, download) against the
 * gallery. "viewed" is recorded by the server when the page loads. Never
 * throws and never blocks the action the couple took; keepalive lets a
 * cta_click survive the navigation it precedes.
 */
export async function postGalleryEvent(
  shareToken: string,
  type: GalleryEventType,
  send: EventFetch = (input, init) => fetch(input, init),
): Promise<boolean> {
  if (!shareToken) return false;
  const body: GalleryEventBody = { type, source: "share_page" };
  try {
    const res = await send(`/api/sessions/by-token/${encodeURIComponent(shareToken)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ————— Creator marker ————— */

/** Minimal Storage surface so tests can pass a Map-backed fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const CREATOR_KEY_PREFIX = "dreemer:gallery-creator:";

export interface CreatorRecord {
  venueSlug: string;
  /** The address the couple typed, so the processing view can name it. */
  email: string | null;
}

/**
 * Marks this tab as the one that made the gallery. Session-scoped on purpose:
 * venues run the flow on shared tour-day tablets, and the marker only gates
 * "Make another gallery" and the delivery copy, never access.
 */
export function rememberCreatedGallery(store: KeyValueStore | null, shareToken: string, record: CreatorRecord): void {
  if (!store || !shareToken) return;
  try {
    store.setItem(CREATOR_KEY_PREFIX + shareToken, JSON.stringify(record));
  } catch {
    /* storage full or blocked: the page still works without the marker */
  }
}

export function createdGalleryRecord(store: KeyValueStore | null, shareToken: string): CreatorRecord | null {
  if (!store || !shareToken) return null;
  try {
    const raw = store.getItem(CREATOR_KEY_PREFIX + shareToken);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreatorRecord>;
    if (typeof parsed?.venueSlug !== "string") return null;
    return { venueSlug: parsed.venueSlug, email: typeof parsed.email === "string" ? parsed.email : null };
  } catch {
    return null;
  }
}

export function sessionStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/* ————— Stills and the real space ————— */

/** Scene order of the four stills (displayOrder 1..4), from scenePlan.ts. */
export const GALLERY_SCENES = [
  { title: "The portrait", coverages: ["ceremony", "natural_light", "detail", "exterior"] },
  { title: "A quiet moment", coverages: ["detail", "natural_light", "ceremony", "reception"] },
  { title: "The whole venue", coverages: ["exterior", "ceremony", "reception", "natural_light"] },
  { title: "Celebration", coverages: ["reception", "exterior", "detail", "natural_light"] },
] as const satisfies ReadonlyArray<{ title: string; coverages: readonly VenueMediaCoverage[] }>;

const COVERAGE_ORDER: readonly VenueMediaCoverage[] = [
  "exterior",
  "ceremony",
  "reception",
  "detail",
  "natural_light",
];
const MAX_VENUE_REFERENCES = 11;

export function sortedStills(assets: readonly GeneratedAsset[] | null | undefined): GeneratedAsset[] {
  return [...(assets ?? [])]
    .filter((asset) => asset.assetType === "image")
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

export function reelAsset(assets: readonly GeneratedAsset[] | null | undefined): GeneratedAsset | null {
  return (assets ?? []).find((asset) => asset.assetType === "video") ?? null;
}

/**
 * The venue photos the pipeline handed the image model, in the same order
 * (gallerySessionPipeline.selectVenueMediaForGeneration): one photo per
 * coverage first, then the rest in display order. venueReferenceIndexes on
 * each still index into this list.
 */
export function generationReferenceOrder(media: readonly VenueMediaItem[]): VenueMediaItem[] {
  const ordered = [...media].sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id);
  const selected: VenueMediaItem[] = [];
  const ids = new Set<number>();
  for (const coverage of COVERAGE_ORDER) {
    const match = ordered.find((item) => item.coverage === coverage);
    if (match) {
      selected.push(match);
      ids.add(match.id);
    }
  }
  for (const item of ordered) {
    if (selected.length >= MAX_VENUE_REFERENCES) break;
    if (!ids.has(item.id)) {
      selected.push(item);
      ids.add(item.id);
    }
  }
  return selected.slice(0, MAX_VENUE_REFERENCES);
}

/**
 * The real venue photo to show beside a still: the reference the model was
 * anchored on when the still records it, otherwise the venue's photo of the
 * space that scene favours, otherwise any venue photo. Null without media.
 */
export function realSpaceFor(still: GeneratedAsset, media: readonly VenueMediaItem[]): VenueMediaItem | null {
  if (media.length === 0) return null;
  const references = generationReferenceOrder(media);
  const anchor = still.venueReferenceIndexes?.[0];
  if (typeof anchor === "number" && references[anchor]) return references[anchor]!;
  const scene = GALLERY_SCENES[still.displayOrder - 1];
  if (scene) {
    for (const coverage of scene.coverages) {
      const match = references.find((item) => item.coverage === coverage);
      if (match) return match;
    }
  }
  return references[(Math.max(still.displayOrder, 1) - 1) % references.length] ?? null;
}

export function sceneTitle(still: GeneratedAsset): string | null {
  return GALLERY_SCENES[still.displayOrder - 1]?.title ?? null;
}

/* ————— Storage URLs ————— */

export function shareAssetUrl(objectKey: string, shareToken: string): string {
  return `/api/storage${objectKey}?shareToken=${encodeURIComponent(shareToken)}`;
}

export function venueMediaUrl(objectKey: string | null | undefined, venueSlug: string): string {
  if (!objectKey) return "";
  return `/api/storage${objectKey}?venueSlug=${encodeURIComponent(venueSlug)}`;
}

/* ————— Processing poll ————— */

/**
 * Poll interval while a gallery renders: brisk at first, easing off for
 * slow sessions so a forgotten tab does not hammer the API. Reaches 10s at
 * five minutes, 30s after twenty.
 */
export function processingPollInterval(elapsedMs: number): number {
  if (elapsedMs < 2 * 60_000) return 3_000;
  if (elapsedMs < 5 * 60_000) return 5_000;
  if (elapsedMs < 20 * 60_000) return 10_000;
  return 30_000;
}
