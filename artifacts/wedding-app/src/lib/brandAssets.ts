/*
 * Self-hosted sample imagery under public/brand. Everything here is an AI
 * preview made from an example venue and a demo couple (Higgsfield job
 * 9d6bf43d-32da-4f4d-8dd1-a92697e06169 for the garden set); the landing page
 * labels it that way wherever it appears.
 *
 * The hero is one diptych — the empty orangery on the left, the couple in it
 * on the right — served as a srcset (800w = 74 KB, 1200w, 1400w) so phones
 * never download the desktop file. compare-room / compare-couple are the two
 * halves of the same frame, used as a 2-up in the compare section.
 */

export const HERO_IMAGE = {
  src: "/brand/hero-800.webp",
  srcSet: "/brand/hero-800.webp 800w, /brand/hero-1200.webp 1200w, /brand/hero-1400.webp 1400w",
  /** Keep in sync with .venue-hero grid columns in index.css. */
  sizes: "(max-width: 760px) calc(100vw - 32px), (max-width: 1050px) calc(50vw - 24px), min(640px, 50vw)",
  width: 1400,
  height: 1045,
  alt: "An empty orangery ceremony space with a flower arch on the left, and the same venue with a couple walking its garden path on the right, AI preview",
} as const;

export const COMPARE_IMAGES = {
  room: {
    src: "/brand/compare-room.webp",
    width: 640,
    height: 961,
    alt: "The orangery ceremony space, empty",
  },
  couple: {
    src: "/brand/compare-couple.webp",
    width: 640,
    height: 961,
    alt: "The same venue with a couple walking the garden path, AI preview",
  },
} as const;

export const BRAND_ASSETS = {
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
    alt: "Couple holding hands at the end of a candlelit ceremony aisle, AI preview",
  },
  {
    index: "Frame 02",
    label: "First dance",
    src: BRAND_ASSETS.frameFirstDance,
    alt: "Couple's first dance under a single warm spotlight in a dark ballroom, AI preview",
  },
  {
    index: "Frame 03",
    label: "Golden hour",
    src: BRAND_ASSETS.frameGoldenHour,
    alt: "Couple embracing on a stone terrace in golden-hour light, AI preview",
  },
  {
    index: "Frame 04",
    label: "The motion reel",
    src: BRAND_ASSETS.frameReelStill,
    alt: "Still from the reel: the couple walking through a candlelit corridor, AI preview",
  },
] as const;
