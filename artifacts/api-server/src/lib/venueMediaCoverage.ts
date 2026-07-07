export const VENUE_MEDIA_COVERAGES = [
  "exterior",
  "ceremony",
  "reception",
  "detail",
  "natural_light",
] as const;
export type VenueMediaCoverage = (typeof VENUE_MEDIA_COVERAGES)[number];

export const VENUE_MEDIA_COVERAGE_LABELS: Record<VenueMediaCoverage, string> = {
  exterior: "Exterior or signature facade",
  ceremony: "Ceremony space",
  reception: "Reception space",
  detail: "Architectural detail",
  natural_light: "Best natural-light view",
};

export function isVenueMediaCoverage(value: unknown): value is VenueMediaCoverage {
  return (
    typeof value === "string" &&
    (VENUE_MEDIA_COVERAGES as readonly string[]).includes(value)
  );
}

export function venueMediaCoverageStatus(
  media: Array<{ coverage?: string | null }>,
): {
  ready: boolean;
  present: VenueMediaCoverage[];
  missing: VenueMediaCoverage[];
} {
  const present = new Set<VenueMediaCoverage>();
  for (const item of media) {
    if (isVenueMediaCoverage(item.coverage)) present.add(item.coverage);
  }
  const missing = VENUE_MEDIA_COVERAGES.filter((coverage) => !present.has(coverage));
  return {
    ready: missing.length === 0,
    present: VENUE_MEDIA_COVERAGES.filter((coverage) => present.has(coverage)),
    missing,
  };
}

export function preferredVenueCoveragesForScene(sceneId: string): VenueMediaCoverage[] {
  switch (sceneId) {
    case "portrait-vertical":
      return ["ceremony", "natural_light", "detail", "exterior"];
    case "intimate-moment":
      return ["detail", "natural_light", "ceremony", "reception"];
    case "grand-venue":
      return ["exterior", "ceremony", "reception", "natural_light"];
    case "celebration":
      return ["reception", "exterior", "detail", "natural_light"];
    default:
      return ["exterior", "ceremony", "reception", "detail", "natural_light"];
  }
}
