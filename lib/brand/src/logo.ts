/**
 * The Dreemer logo as geometry.
 *
 * Everything here is constructed, not traced: the wordmark is a monoline
 * geometric lowercase built from circles and stems (x-height 100, ascender
 * 150, stroke 19), and the mark is a soft coral squircle with a thin orbit
 * line and a four-point spark at its top right. Because the letterforms are
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

export const WORDMARK_STROKE = 22;
export const WORDMARK_HEIGHT = 150;
const GAP = 12;
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
 * The mark, traced from the reference render (lib/brand/assets/logo/
 * dreemer-logo-midjourney.png) on a 100-unit grid.
 *
 * The filled shape is a heart's left lobe: a soft rounded top-left, a straight
 * top edge running down to the notch, a straight edge out to the right corner,
 * a straight edge down to the point, and a gentle curve back up the left side.
 * The thin line leaves the notch and traces where the right lobe would be,
 * ending open on the right; a small hand-drawn spark (two short crossing
 * strokes) sits on the line at its peak, top right.
 */
export const ICON_SIZE = 100;

/** Filled lobe. */
export const ICON_BODY_PATH =
  "M 47.5 36.5 L 77.5 65.25 L 48.75 95.25 C 30 82, 10 60, 3.5 42 C 0 24, 3 9, 13 5.5 Z";

/** The thin right-lobe line, from the notch up over the top right and back down. */
export const ICON_LINE_PATHS: readonly string[] = [
  "M 48.5 35.5 C 56 24, 66 13, 77 11.5 C 88 10, 97 20, 98 31 C 98.5 37, 97.5 42, 96.5 45.5",
];
export const ICON_LINE_STROKE = 2.6;

/** The spark: two short crossing strokes over the line's peak. */
export const ICON_SPARK_PATHS: readonly string[] = ["M 64 8.5 L 85 14.5", "M 82.5 6 L 75.5 15"];
export const ICON_SPARK_STROKE = 2.4;

/** A four-point star, used by the simplified favicon tile where the hairline strokes vanish. */
export function sparkPath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`;
}

/* --------------------------------------------------------------- lockup */

export const LOCKUP_GAP = 36;
/** The mark spans y 5.5–95.25 (≈90 units); scale it to the 150-unit ascender. */
export const LOCKUP_ICON_SCALE = 150 / 90;
export const LOCKUP_ICON_OFFSET_Y = -5.5 * (150 / 90);
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
    <path d="${ICON_BODY_PATH}" fill="${colors.mark}"/>
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
 * Favicon / app-icon tile: ivory rounded tile with the mark. The thin orbit
 * line disappears below ~32px, so the tile drops it and keeps body + spark.
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
    ? `<path d="${sparkPath(80, 12, 9)}" fill="${colors.line}"/>`
    : `<g fill="none" stroke="${colors.line}" stroke-width="${ICON_LINE_STROKE}" stroke-linecap="round">
      ${ICON_LINE_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>
    <g fill="none" stroke="${colors.line}" stroke-width="${ICON_SPARK_STROKE}" stroke-linecap="round">
      ${ICON_SPARK_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>`;
  return `<svg ${XMLNS} viewBox="0 0 ${size} ${size}" role="img" aria-label="Dreemer">
  <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
  <g transform="scale(${scale}) translate(${inset} ${inset}) scale(${markScale})">
    <path d="${ICON_BODY_PATH}" fill="${colors.mark}"/>
    ${detail}
  </g>
</svg>
`;
}
