import type { VenueType } from "@workspace/db";

/**
 * Deterministic segment classifiers (growth-loop.md 9.4). Pure functions:
 * no I/O, no model calls, so the same prospect always lands in the same
 * segment and KPI slices stay comparable over time.
 */

/** First match wins; scanned against lowercased name + qualification + JSON of facts. */
const VENUE_TYPE_KEYWORDS: Array<{ type: VenueType; words: string[] }> = [
  { type: "barn_farm", words: ["barn", "farm", "ranch", "homestead"] },
  { type: "estate", words: ["estate", "manor", "mansion", "chateau", "villa", "plantation"] },
  { type: "hotel_resort", words: ["hotel", "inn", "resort", "lodge"] },
  { type: "winery", words: ["winery", "vineyard", "brewery", "distillery", "cidery"] },
  { type: "garden", words: ["garden", "botanic", "arboretum", "greenhouse", "conservatory"] },
  { type: "historic", words: ["historic", "museum", "hall", "church", "chapel", "castle", "library"] },
  { type: "urban_loft", words: ["loft", "warehouse", "industrial", "studio", "gallery"] },
  { type: "restaurant_club", words: ["restaurant", "rooftop", "club", "bar", "brasserie"] },
  { type: "waterfront", words: ["beach", "waterfront", "lake", "yacht", "marina", "harbor", "oceanfront"] },
];

export interface ClassifyVenueTypeInput {
  name: string;
  qualification?: string | null;
  facts?: { style?: unknown; spaces?: unknown; summary?: unknown } | null;
}

function containsWord(haystack: string, word: string): boolean {
  // Whole-word match so "inn" does not fire on "inner" or "bar" on "barn".
  const pattern = new RegExp(`(^|[^a-z])${word}(s)?([^a-z]|$)`, "i");
  return pattern.test(haystack);
}

export function classifyVenueType(input: ClassifyVenueTypeInput): VenueType {
  const factsText = input.facts ? safeJson(input.facts) : "";
  const haystack = `${input.name} ${input.qualification ?? ""} ${factsText}`.toLowerCase();
  for (const entry of VENUE_TYPE_KEYWORDS) {
    if (entry.words.some((word) => containsWord(haystack, word))) return entry.type;
  }
  return "other";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Trim, collapse whitespace, Title Case each word; empty/null -> "Unknown".
 * A two-letter token right after a comma is a state/province code and stays
 * uppercase ("austin, tx" -> "Austin, TX").
 */
export function normalizeRegion(region: string | null | undefined): string {
  const collapsed = (region ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "Unknown";
  const words = collapsed.split(" ");
  return words
    .map((word, index) => {
      const afterComma = index > 0 && words[index - 1]!.endsWith(",");
      if (word.length === 2 && (afterComma || word === word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
