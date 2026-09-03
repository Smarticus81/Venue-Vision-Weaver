import type { VenueMediaCoverage } from "@workspace/api-client-react";

export const COVERAGE_OPTIONS: ReadonlyArray<{ value: VenueMediaCoverage; label: string; hint: string }> = [
  { value: "exterior", label: "Exterior", hint: "Approach, façade, grounds" },
  { value: "ceremony", label: "Ceremony", hint: "Where vows happen" },
  { value: "reception", label: "Reception", hint: "Tables, dance floor" },
  { value: "detail", label: "Detail", hint: "Texture, décor, light" },
  { value: "natural_light", label: "Natural light", hint: "A daylight room" },
];

export const MIN_VENUE_PHOTOS = 1;
export const MIN_COUPLE_PHOTOS = 1;
export const MAX_COUPLE_PHOTOS = 3;

export type BillingProductId = "starter" | "growth" | "credit_pack";

export const BILLING_PRODUCTS: ReadonlyArray<{
  id: BillingProductId;
  title: string;
  description: string;
  credits: string;
  cta: string;
  kind: "plan" | "pack";
}> = [
  {
    id: "starter",
    title: "Starter",
    description: "One venue, steady tour calendar.",
    credits: "25 credits / month",
    cta: "Choose Starter",
    kind: "plan",
  },
  {
    id: "growth",
    title: "Growth",
    description: "Several venues or a full calendar.",
    credits: "100 credits / month",
    cta: "Choose Growth",
    kind: "plan",
  },
  {
    id: "credit_pack",
    title: "Credit pack",
    description: "Top up when a busy weekend outruns the plan.",
    credits: "+10 credits, once",
    cta: "Buy 10 credits",
    kind: "pack",
  },
];

export function normalizeStorageObjectPath(objectKey: string): string {
  const raw = objectKey.trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  if (raw.startsWith("/api/storage/")) return raw;
  const uploadPath = raw.match(/uploads\/([^/?#]+)/)?.[1];
  if (uploadPath) return `/api/storage/objects/uploads/${uploadPath}`;
  if (raw.startsWith("/objects/")) return `/api/storage${raw}`;
  if (raw.startsWith("objects/")) return `/api/storage/${raw}`;
  return `/api/storage/objects/${raw.replace(/^\/+/, "")}`;
}

function withQueryParam(url: string, key: string, value: string): string {
  if (!url || !value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export function venueReferenceUrl(objectKey: string, venueSlug: string): string {
  return withQueryParam(normalizeStorageObjectPath(objectKey), "venueSlug", venueSlug);
}

export function ownerAssetUrl(objectKey: string): string {
  return normalizeStorageObjectPath(objectKey);
}

export function coupleLinkFor(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/preview/${slug}`;
}
