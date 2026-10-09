import { registrableDomain } from "./domain.js";
import type { DiscoveredFact, VettingCheck } from "./types.js";

/**
 * Tier B: Google Places API (New) text search (vetting.md 1.6). Env-gated by
 * GOOGLE_PLACES_API_KEY and capped per UTC day by vet.ts (which records one
 * `places_lookup` audit event per call). Everything here is pure over the
 * injected fetchJson so the match rules are unit-testable offline.
 */

export function placesEnabled(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim());
}

export interface PlacesMatch {
  placeId: string;
  displayName: string;
  formattedAddress: string | null;
  websiteUri: string | null;
  nationalPhoneNumber: string | null;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  mapsUrl: string;
}

export interface PlacesSearchInput {
  name: string;
  region: string | null;
  location: string | null;
  websiteDomain: string | null;
}

export interface PlacesSearchResult {
  match: PlacesMatch | null;
  candidates: number;
  error: string | null;
}

type FetchJson = (
  url: string,
  init?: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json: unknown } | null>;

export const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus,places.types";

export function mapsUrlFor(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cityToken(location: string | null): string | null {
  if (!location) return null;
  const city = location.split(",")[0]?.trim().toLowerCase() ?? "";
  return city.length >= 3 ? city : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parsePlacesCandidates(json: unknown): PlacesMatch[] {
  const places = json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).places)
    ? ((json as Record<string, unknown>).places as unknown[])
    : [];
  const out: PlacesMatch[] = [];
  for (const raw of places) {
    if (!raw || typeof raw !== "object") continue;
    const place = raw as Record<string, unknown>;
    const placeId = str(place.id);
    if (!placeId) continue;
    const displayName = place.displayName && typeof place.displayName === "object"
      ? str((place.displayName as Record<string, unknown>).text)
      : str(place.displayName);
    out.push({
      placeId,
      displayName: displayName ?? "",
      formattedAddress: str(place.formattedAddress),
      websiteUri: str(place.websiteUri),
      nationalPhoneNumber: str(place.nationalPhoneNumber),
      rating: numberOrNull(place.rating),
      userRatingCount: numberOrNull(place.userRatingCount),
      businessStatus: str(place.businessStatus),
      mapsUrl: mapsUrlFor(placeId),
    });
  }
  return out;
}

/** Pure match rule: website domain first, then exact name + city. */
export function pickPlacesMatch(candidates: PlacesMatch[], input: PlacesSearchInput): PlacesMatch | null {
  if (input.websiteDomain) {
    for (const candidate of candidates) {
      if (!candidate.websiteUri) continue;
      try {
        if (registrableDomain(new URL(candidate.websiteUri).hostname) === input.websiteDomain) return candidate;
      } catch {
        /* unparsable websiteUri */
      }
    }
  }
  const wanted = normalizeName(input.name);
  const city = cityToken(input.location ?? input.region);
  if (!wanted || !city) return null;
  for (const candidate of candidates) {
    if (normalizeName(candidate.displayName) !== wanted) continue;
    if (candidate.formattedAddress?.toLowerCase().includes(city)) return candidate;
  }
  return null;
}

export async function searchPlace(
  input: PlacesSearchInput,
  deps: { fetchJson: FetchJson; apiKey: string; now: Date },
): Promise<PlacesSearchResult> {
  const textQuery = `${input.name} ${input.location ?? input.region ?? ""}`.trim();
  let response: { status: number; json: unknown } | null = null;
  try {
    response = await deps.fetchJson(PLACES_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": deps.apiKey, "X-Goog-FieldMask": FIELD_MASK },
      body: JSON.stringify({ textQuery, maxResultCount: 5 }),
    });
  } catch (err) {
    return { match: null, candidates: 0, error: err instanceof Error ? err.message : String(err) };
  }
  if (!response) return { match: null, candidates: 0, error: "Places request failed (network)" };
  if (response.status < 200 || response.status >= 300) {
    return { match: null, candidates: 0, error: `Places answered HTTP ${response.status}` };
  }
  const candidates = parsePlacesCandidates(response.json);
  return { match: pickPlacesMatch(candidates, input), candidates: candidates.length, error: null };
}

export function checkPlaces(
  result: PlacesSearchResult | null,
  _websiteDomain: string | null,
  now: Date,
  skipDetail = "Google Places disabled (GOOGLE_PLACES_API_KEY unset) or the daily cap is reached",
): VettingCheck {
  const key = "places";
  if (!result) return { key, outcome: "skip", points: 0, hardFail: false, detail: skipDetail, evidence: [] };
  if (result.error) return { key, outcome: "error", points: 0, hardFail: false, detail: `Places lookup failed: ${result.error}`, evidence: [] };
  const match = result.match;
  if (!match) {
    return {
      key,
      outcome: "warn",
      points: 0,
      hardFail: false,
      detail: `no Google listing matched the site (${result.candidates} candidate(s)); not disqualifying`,
      evidence: [],
      data: { candidates: result.candidates },
    };
  }
  const evidence = [{ url: match.mapsUrl, observedAt: now.toISOString(), excerpt: `${match.displayName} · ${match.formattedAddress ?? ""}`.trim() }];
  const data = {
    placeId: match.placeId,
    rating: match.rating,
    userRatingCount: match.userRatingCount,
    businessStatus: match.businessStatus,
    candidates: result.candidates,
  };
  if (match.businessStatus === "CLOSED_PERMANENTLY") {
    return { key, outcome: "fail", points: 0, hardFail: true, detail: "Google lists this business as permanently closed", evidence, data };
  }
  const reviews = match.userRatingCount ?? 0;
  const points = 10 + (reviews >= 10 ? 10 : 0);
  return {
    key,
    outcome: "pass",
    points,
    hardFail: false,
    detail: `Google listing matched${match.rating != null ? ` (${match.rating} stars, ${reviews} reviews)` : ""}`,
    evidence,
    data,
  };
}

/** The google_rating fact a match yields (null when no rating). */
export function placesFact(match: PlacesMatch): DiscoveredFact | null {
  if (match.rating == null) return null;
  return {
    kind: "google_rating",
    value: `${match.rating} (${match.userRatingCount ?? 0} reviews)`,
    sourceUrl: match.mapsUrl,
    sourceKind: "places",
    excerpt: match.formattedAddress ?? null,
    status: "verified",
  };
}
