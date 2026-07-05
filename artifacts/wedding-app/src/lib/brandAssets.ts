/**
 * Brand imagery generated in the Higgsfield studio, art-directed to the
 * editorial-darkroom token system (warm near-black, candlelight rose).
 *
 * Served from the studio CDN by default. To self-host: run
 * `node scripts/fetch-brand-assets.mjs` from the repo root (needs open
 * network), then build with VITE_LOCAL_BRAND_ASSETS=1.
 */

const CDN_BASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3FvUSDWlpMZmeo552NjYHGJ67RL";

type BrandAssetSet = {
  heroAtmosphere: string;
  frameCeremony: string;
  frameFirstDance: string;
  frameGoldenHour: string;
  frameReelStill: string;
};

const CDN: BrandAssetSet = {
  heroAtmosphere: `${CDN_BASE}/hf_20260705_205658_eb2a1a7c-4ce0-444d-82d7-4aa96873ce73_min.webp`,
  frameCeremony: `${CDN_BASE}/hf_20260705_205704_73ea4c99-08d9-435e-852a-5a4a1eabab32_min.webp`,
  frameFirstDance: `${CDN_BASE}/hf_20260705_205829_1a4cd4b3-bc16-4489-b1e9-1ec6893e1a5a_min.webp`,
  frameGoldenHour: `${CDN_BASE}/hf_20260705_205832_fd9973ea-4be7-4105-9076-2b4767cea833_min.webp`,
  frameReelStill: `${CDN_BASE}/hf_20260705_205835_eee8b83b-0301-44a7-aca4-0a0bb7b50e70_min.webp`,
};

const LOCAL: BrandAssetSet = {
  heroAtmosphere: "/brand/hero-atmosphere.webp",
  frameCeremony: "/brand/frame-ceremony.webp",
  frameFirstDance: "/brand/frame-first-dance.webp",
  frameGoldenHour: "/brand/frame-golden-hour.webp",
  frameReelStill: "/brand/frame-reel-still.webp",
};

export const BRAND_ASSETS =
  import.meta.env.VITE_LOCAL_BRAND_ASSETS === "1" ? LOCAL : CDN;

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
