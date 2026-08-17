/** Mood metadata for the accent system the mood dial swaps. */

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
