/**
 * The Dreemer logo as geometry.
 *
 * The wordmark is a custom monoline lowercase with generous spacing. The
 * architectural D frames an open arched doorway: a venue and a future moment
 * in one compact silhouette. Because the letterforms are
 * paths, the logo renders identically with no web font loaded, in email
 * clients, in `sharp`, and in the browser.
 *
 * Coordinates are shared by the SVG file generator (`scripts/build-logo.ts`)
 * and the React `<DreemerLogo />` component, so the app and the asset folder
 * can never drift apart.
 */
import { coral, ink, ivory } from "./tokens.js";

export type LogoVariant = "color" | "ink" | "reversed";

/* ------------------------------------------------------------- wordmark */

export const WORDMARK_STROKE = 14;
export const WORDMARK_HEIGHT = 150;
const GAP = 20;
const S = WORDMARK_STROKE / 2; // half stroke, so outer edges land on integers
const R = 50 - S; // bowl centre-line radius: outer bowl = 100 wide

type Glyph = { width: number; d: string };

const glyphs: Record<"d" | "r" | "e" | "m", Glyph> = {
  d: {
    width: 100,
    d: `M ${50 - R} 100 A ${R} ${R} 0 1 0 ${50 + R} 100 A ${R} ${R} 0 1 0 ${50 - R} 100 Z M ${100 - S} 0 V 150`,
  },
  r: {
    width: 58,
    d: `M ${S} 150 V 50 M ${S} 88 A 38 38 0 0 1 ${S + 38} 50 H ${S + 47}`,
  },
  e: {
    // Ring broken between 3 o'clock and ~4:30, bar through the centre.
    width: 100,
    d: `M ${50 + R} 100 A ${R} ${R} 0 1 0 ${(50 + R * Math.cos(-0.63)).toFixed(2)} ${(100 - R * Math.sin(-0.63)).toFixed(2)} M ${50 - R + 2} 100 H ${50 + R}`,
  },
  m: {
    width: 162,
    d: `M ${S} 150 V 50 M ${S} 85 A 35 35 0 0 1 ${S + 70} 85 V 150 M ${S + 70} 85 A 35 35 0 0 1 ${S + 140} 85 V 150`,
  },
};

const WORD: Array<keyof typeof glyphs> = ["d", "r", "e", "e", "m", "e", "r"];

function layoutWordmark(): { width: number; paths: string[] } {
  let x = 0;
  const paths: string[] = [];
  for (const letter of WORD) {
    const glyph = glyphs[letter];
    paths.push(
      glyph.d.replace(/([MLHV])\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?|A\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([01])\s+([01])\s+(-?[\d.]+)\s+(-?[\d.]+)/g, (match, cmd, a, b, rx, ry, rot, large, sweep, ex, ey) => {
        if (cmd === "H") return `H ${Number(a) + x}`;
        if (cmd === "V") return `V ${a}`;
        if (cmd === "M" || cmd === "L") return `${cmd} ${Number(a) + x} ${b}`;
        if (match.startsWith("A")) return `A ${rx} ${ry} ${rot} ${large} ${sweep} ${Number(ex) + x} ${ey}`;
        return match;
      }),
    );
    x += glyph.width + GAP;
  }
  return { width: x - GAP, paths };
}

const layout = layoutWordmark();

/** Total advance width of the wordmark at WORDMARK_HEIGHT. */
export const WORDMARK_WIDTH = layout.width;

/** One path per letter, stroke-rendered with `WORDMARK_STROKE`, butt caps, round joins. */
export const WORDMARK_PATHS: readonly string[] = layout.paths;

/* ----------------------------------------------------------------- mark */

/**
 * Original architectural D on a 100-unit grid. The counter uses even-odd
 * filling; the interior arch and open door remain distinct at header sizes.
 * Tiny favicons retain only the strong outer monogram.
 */
export const ICON_SIZE = 100;

/** Outer D and counter, rendered with even-odd fill. */
export const ICON_BODY_PATH =
  "M 12 8 H 48 C 73 8 90 25 90 50 C 90 75 73 92 48 92 H 12 Z M 24 20 V 80 H 47 C 66 80 78 68 78 50 C 78 32 66 20 47 20 Z";

/** Interior arch and open door. */
export const ICON_LINE_PATHS: readonly string[] = [
  "M 38 71 V 44 C 38 33 45 27 53 27 C 61 27 67 33 67 44 V 71",
  "M 38 71 L 53 62 V 29",
];
export const ICON_LINE_STROKE = 3.5;

/** Reserved detail paths; the aperture identity has no decorative spark. */
export const ICON_SPARK_PATHS: readonly string[] = [];
export const ICON_SPARK_STROKE = 2.4;

/** A four-point star, used by the simplified favicon tile where the hairline strokes vanish. */
export function sparkPath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`;
}

/* --------------------------------------------------------------- lockup */

export const LOCKUP_GAP = 36;
/** The mark spans y 8–92; scale it to the 150-unit ascender. */
export const LOCKUP_ICON_SCALE = 150 / 84;
export const LOCKUP_ICON_OFFSET_Y = -8 * (150 / 84);
export const LOCKUP_ICON_WIDTH = 100 * LOCKUP_ICON_SCALE;
export const LOCKUP_WIDTH = LOCKUP_ICON_WIDTH + LOCKUP_GAP + WORDMARK_WIDTH;
export const LOCKUP_HEIGHT = WORDMARK_HEIGHT;

/* --------------------------------------------------------------- colors */

export function logoColors(variant: LogoVariant): { mark: string; line: string; word: string; background: string | null } {
  switch (variant) {
    case "ink":
      return { mark: ink[900], line: ink[900], word: ink[900], background: null };
    case "reversed":
      return { mark: coral[500], line: coral[400], word: ivory[100], background: ink[900] };
    default:
      return { mark: coral[500], line: coral[500], word: ink[900], background: null };
  }
}

/* ------------------------------------------------------------ svg files */

const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

function markGroup(colors: ReturnType<typeof logoColors>, transform?: string): string {
  const t = transform ? ` transform="${transform}"` : "";
  return `<g${t}>
    <path d="${ICON_BODY_PATH}" fill="${colors.mark}" fill-rule="evenodd"/>
    <g fill="none" stroke="${colors.line}" stroke-width="${ICON_LINE_STROKE}" stroke-linecap="round">
      ${ICON_LINE_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
    <g fill="none" stroke="${colors.line}" stroke-width="${ICON_SPARK_STROKE}" stroke-linecap="round">
      ${ICON_SPARK_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
  </g>`;
}

function wordGroup(colors: ReturnType<typeof logoColors>, transform?: string): string {
  const t = transform ? ` transform="${transform}"` : "";
  return `<g${t} fill="none" stroke="${colors.word}" stroke-width="${WORDMARK_STROKE}" stroke-linejoin="round">
    ${WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>`;
}

function background(colors: ReturnType<typeof logoColors>, w: number, h: number, pad: number): string {
  return colors.background ? `<rect x="${-pad}" y="${-pad}" width="${w + pad * 2}" height="${h + pad * 2}" fill="${colors.background}"/>` : "";
}

export function iconSvg(variant: LogoVariant = "color", options: { padding?: number } = {}): string {
  const pad = options.padding ?? 0;
  const colors = logoColors(variant);
  return `<svg ${XMLNS} viewBox="${-pad} ${-pad} ${ICON_SIZE + pad * 2} ${ICON_SIZE + pad * 2}" role="img" aria-label="Dreemer">
  ${background(colors, ICON_SIZE, ICON_SIZE, pad)}
  ${markGroup(colors)}
</svg>
`;
}

export function wordmarkSvg(variant: LogoVariant = "color", options: { padding?: number } = {}): string {
  const pad = options.padding ?? 0;
  const colors = logoColors(variant);
  return `<svg ${XMLNS} viewBox="${-pad} ${-pad} ${WORDMARK_WIDTH + pad * 2} ${WORDMARK_HEIGHT + pad * 2}" role="img" aria-label="dreemer">
  ${background(colors, WORDMARK_WIDTH, WORDMARK_HEIGHT, pad)}
  ${wordGroup(colors)}
</svg>
`;
}

export function lockupSvg(variant: LogoVariant = "color", options: { padding?: number } = {}): string {
  const pad = options.padding ?? 0;
  const colors = logoColors(variant);
  const wordX = LOCKUP_ICON_WIDTH + LOCKUP_GAP;
  return `<svg ${XMLNS} viewBox="${-pad} ${-pad} ${LOCKUP_WIDTH + pad * 2} ${LOCKUP_HEIGHT + pad * 2}" role="img" aria-label="Dreemer">
  ${background(colors, LOCKUP_WIDTH, LOCKUP_HEIGHT, pad)}
  ${markGroup(colors, `translate(0 ${LOCKUP_ICON_OFFSET_Y.toFixed(2)}) scale(${LOCKUP_ICON_SCALE.toFixed(4)})`)}
  ${wordGroup(colors, `translate(${wordX.toFixed(2)} 0)`)}
</svg>
`;
}

/**
 * Favicon / app-icon tile. Small sizes retain the D silhouette without the
 * interior door, preserving a legible counter at 16px.
 */
export function tileSvg(
  options: { size?: number; variant?: "light" | "dark"; simplified?: boolean; rounded?: boolean; inset?: number } = {},
): string {
  const size = options.size ?? 512;
  const dark = options.variant === "dark";
  const simplified = options.simplified ?? false;
  const rounded = options.rounded ?? true;
  const colors = logoColors(dark ? "reversed" : "color");
  const bg = dark ? ink[900] : ivory[200];
  const scale = size / 100;
  const inset = options.inset ?? 12; // in icon units, around the 100-unit mark (maskable icons pass ~20)
  const markScale = (100 - inset * 2) / 100;
  const r = rounded ? size * 0.22 : 0;
  const detail = simplified
    ? ""
    : `<g fill="none" stroke="${colors.line}" stroke-width="${ICON_LINE_STROKE}" stroke-linecap="round">
      ${ICON_LINE_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
    <g fill="none" stroke="${colors.line}" stroke-width="${ICON_SPARK_STROKE}" stroke-linecap="round">
      ${ICON_SPARK_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>`;
  return `<svg ${XMLNS} viewBox="0 0 ${size} ${size}" role="img" aria-label="Dreemer">
  <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
  <g transform="scale(${scale}) translate(${inset} ${inset}) scale(${markScale})">
    <path d="${ICON_BODY_PATH}" fill="${colors.mark}" fill-rule="evenodd"/>
    ${detail}
  </g>
</svg>
`;
}
