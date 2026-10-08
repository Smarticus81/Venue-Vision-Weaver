/**
 * Turns the object keys the API stores into URLs the owner's browser can
 * load through the storage proxy. Pure, so it is unit-tested.
 */
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

export function withQueryParam(url: string, key: string, value: string): string {
  if (!url || !value) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/** Venue reference photos are readable with the venue slug attached. */
export function venueReferenceUrl(objectKey: string, venueSlug: string): string {
  return withQueryParam(normalizeStorageObjectPath(objectKey), "venueSlug", venueSlug);
}

/** Generated gallery assets the owner may view through their session. */
export function ownerAssetUrl(objectKey: string): string {
  return normalizeStorageObjectPath(objectKey);
}

/** A sensible filename for a re-uploaded venue photo (retag / replace). */
export function objectKeyFileName(objectKey: string, fallback = "venue-photo.jpg"): string {
  const last = objectKey.split(/[/?#]/).filter(Boolean).pop();
  if (!last) return fallback;
  return /\.[a-z0-9]{3,4}$/i.test(last) ? last : `${last}.jpg`;
}
