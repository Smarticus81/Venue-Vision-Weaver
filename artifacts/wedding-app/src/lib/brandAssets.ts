/**
 * Brand imagery generated in the Higgsfield studio, art-directed to the
 * editorial-darkroom token system (warm near-black, candlelight rose),
 * self-hosted under public/brand (fetched + committed by the
 * fetch-brand-assets workflow, then trimmed/optimized).
 *
 * To regenerate or re-fetch originals: scripts/fetch-brand-assets.mjs
 * (source job URLs live there).
 */

export const BRAND_ASSETS = {
  heroAtmosphere: "/brand/hero-atmosphere.webp",
  frameCeremony: "/brand/frame-ceremony.webp",
  frameFirstDance: "/brand/frame-first-dance.webp",
  frameGoldenHour: "/brand/frame-golden-hour.webp",
  frameReelStill: "/brand/frame-reel-still.webp",
} as const;

export const GALLERY_FRAMES = [
  {
    index: "Frame 01",
    label: "Ceremony aisle",
    src: BRAND_ASSETS.frameCeremony,
    alt: "Couple holding hands at the end of a candlelit ceremony aisle",
  },
  {
    index: "Frame 02",
    label: "First dance",
    src: BRAND_ASSETS.frameFirstDance,
    alt: "Couple's first dance under a single warm spotlight in a dark ballroom",
  },
  {
    index: "Frame 03",
    label: "Golden hour",
    src: BRAND_ASSETS.frameGoldenHour,
    alt: "Couple embracing on a stone terrace in golden-hour light",
  },
  {
    index: "Frame 04",
    label: "The motion reel",
    src: BRAND_ASSETS.frameReelStill,
    alt: "Cinematic still of the couple walking through a candlelit corridor",
  },
] as const;
