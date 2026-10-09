/**
 * Normalize a venue name into the slug the API expects (^[a-z0-9-]+$).
 *
 * Punctuation between words becomes a hyphen instead of vanishing, so
 * "Willow&Oak" reads "willow-oak" rather than "willowoak". A pasted URL is
 * reduced to its host's first label ("https://www.willowhouse.com/tours" →
 * "willowhouse") rather than a run of scheme fragments. Accents are folded.
 * The server still guarantees uniqueness.
 */
export function toVenueSlug(input: string): string {
  let s = input.trim();
  if (!s) return "";
  const url = parseUrlLike(s);
  if (url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    s = host.split(".")[0] ?? host;
  }
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function parseUrlLike(value: string): URL | null {
  if (/\s/.test(value)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(value) ? `https://${value}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/** Normalizes a typed website address to an absolute https URL, or null. */
export function normalizeWebsiteInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
