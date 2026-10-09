/*
 * Visual samples for the couple's style cards. Each image is the same
 * committed AI sample frame (public/brand/frame-golden-hour.webp) graded the
 * way the style reads, so couples compare looks rather than different
 * photos. They are labelled as example looks wherever they appear; the
 * couple's own gallery is rendered from their photos at their venue.
 */
import type { GalleryStyleSummary } from "@workspace/api-client-react";

/** The server's default when no style is sent (routes/sessions.ts). */
export const DEFAULT_STYLE_ID = "cinematic-editorial";

export interface StyleSample {
  src: string;
  width: number;
  height: number;
  /** Two or three plain words a couple can scan. */
  mood: string;
}

const SAMPLE_SIZE = { width: 480, height: 600 } as const;

export const STYLE_SAMPLES: Readonly<Record<string, StyleSample>> = {
  "cinematic-editorial": {
    src: "/brand/styles/cinematic-editorial.webp",
    ...SAMPLE_SIZE,
    mood: "Crisp, true colour",
  },
  "heirloom-memory": {
    src: "/brand/styles/heirloom-memory.webp",
    ...SAMPLE_SIZE,
    mood: "Soft, grain, muted",
  },
  "golden-hour-dream": {
    src: "/brand/styles/golden-hour-dream.webp",
    ...SAMPLE_SIZE,
    mood: "Warm, amber glow",
  },
};

export function styleSample(styleId: string): StyleSample | null {
  return STYLE_SAMPLES[styleId] ?? null;
}

/** The default style first, the rest in the server's order. */
export function orderStyles<T extends Pick<GalleryStyleSummary, "id">>(styles: readonly T[]): T[] {
  const defaults = styles.filter((style) => style.id === DEFAULT_STYLE_ID);
  return [...defaults, ...styles.filter((style) => style.id !== DEFAULT_STYLE_ID)];
}

/**
 * The style to preselect: the couple's earlier pick when the server still
 * offers it, otherwise the default, otherwise the first offered style.
 */
export function initialStyleId(styles: readonly Pick<GalleryStyleSummary, "id">[], previous: string | null): string | null {
  if (previous && styles.some((style) => style.id === previous)) return previous;
  if (styles.some((style) => style.id === DEFAULT_STYLE_ID)) return DEFAULT_STYLE_ID;
  return styles[0]?.id ?? null;
}
