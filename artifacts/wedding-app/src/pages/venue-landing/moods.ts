/**
 * Mood metadata shared by the page UI and the WebGL scene. This module
 * must stay dependency-free: the page imports it eagerly, while three.js
 * (via ceremonyScene.ts) loads lazily after first paint.
 */

export type MoodKey = "golden" | "candlelit" | "moonlit";

export const MOOD_ORDER: MoodKey[] = ["golden", "candlelit", "moonlit"];

export const MOOD_LABELS: Record<MoodKey, string> = {
  golden: "Golden hour",
  candlelit: "Candlelit",
  moonlit: "Moonlit",
};

/** Browser-chrome color per mood (meta theme-color). */
export const MOOD_THEME_COLOR: Record<MoodKey, string> = {
  golden: "#241b3d",
  candlelit: "#120d20",
  moonlit: "#070b16",
};

export const DEFAULT_MOOD: MoodKey = "candlelit";
