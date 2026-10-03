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

export const WORDMARK_STROKE = 19;
export const WORDMARK_HEIGHT = 150;
const GAP = 18;
const S = WORDMARK_STROKE / 2; // half stroke, so outer edges land on integers

type Glyph = { width: number; d: string };

const glyphs: Record<"d" | "r" | "e" | "m", Glyph> = {
  d: {
    width: 100,
    d: `M ${50 - 40} 100 A 40 40 0 1 0 ${50 + 40} 100 A 40 40 0 1 0 ${50 - 40} 100 Z M ${100 - S} 0 V 150`,
  },
  r: {
    width: 61,
    d: `M ${S} 150 V 50 M ${S} 90 A 40 40 0 0 1 ${S + 40} 50 H ${S + 48}`,
  },
  e: {
    width: 100,
    // Ring broken between 3 o'clock and ~4:30, bar through the centre.
    d: `M 90 100 A 40 40 0 1 0 80.64 125.71 M 10 100 H 90`,
  },
  m: {
    width: 159,
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

export const ICON_SIZE = 100;

/** Soft squircle body: 68 × 68, corner radius 27. */
export const ICON_BODY_PATH =
  "M 37 22 H 51 A 27 27 0 0 1 78 49 V 63 A 27 27 0 0 1 51 90 H 37 A 27 27 0 0 1 10 63 V 49 A 27 27 0 0 1 37 22 Z";

/** The thin orbit line hugging the body's top-right corner, broken where the spark sits. */
const ORBIT_CX = 51;
const ORBIT_CY = 49;
const ORBIT_R = 36;
export const ICON_LINE_STROKE = 3.8;

function orbitPoint(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [ORBIT_CX + ORBIT_R * Math.cos(rad), ORBIT_CY - ORBIT_R * Math.sin(rad)];
}

function orbitArc(fromDeg: number, toDeg: number): string {
  const [x1, y1] = orbitPoint(fromDeg);
  const [x2, y2] = orbitPoint(toDeg);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${ORBIT_R} ${ORBIT_R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export const ICON_LINE_PATHS: readonly string[] = [orbitArc(108, 62), orbitArc(28, -14)];

/** Four-point spark centred on the orbit at 45°. */
export function sparkPath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`;
}

const [SPARK_X, SPARK_Y] = orbitPoint(45);
export const ICON_SPARK_PATH = sparkPath(Number(SPARK_X.toFixed(2)), Number(SPARK_Y.toFixed(2)), 7.5);

/* --------------------------------------------------------------- lockup */

export const LOCKUP_GAP = 38;
export const LOCKUP_ICON_SCALE = 1.5; // icon 100 → 150, matching the ascender
export const LOCKUP_ICON_OFFSET_Y = 15; // body bottom lands on the baseline
export const LOCKUP_WIDTH = ICON_SIZE * LOCKUP_ICON_SCALE + LOCKUP_GAP + WORDMARK_WIDTH;
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
    <path d="${ICON_SPARK_PATH}" fill="${colors.line}"/>
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
  const wordX = ICON_SIZE * LOCKUP_ICON_SCALE + LOCKUP_GAP;
  return `<svg ${XMLNS} viewBox="${-pad} ${-pad} ${LOCKUP_WIDTH + pad * 2} ${LOCKUP_HEIGHT + pad * 2}" role="img" aria-label="Dreemer">
  ${background(colors, LOCKUP_WIDTH, LOCKUP_HEIGHT, pad)}
  ${markGroup(colors, `translate(0 ${LOCKUP_ICON_OFFSET_Y}) scale(${LOCKUP_ICON_SCALE})`)}
  ${wordGroup(colors, `translate(${wordX} 0)`)}
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
  return `<svg ${XMLNS} viewBox="0 0 ${size} ${size}" role="img" aria-label="Dreemer">
  <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
  <g transform="scale(${scale}) translate(${inset} ${inset}) scale(${markScale})">
    <path d="${ICON_BODY_PATH}" fill="${colors.mark}"/>
    ${simplified ? "" : `<g fill="none" stroke="${colors.line}" stroke-width="${ICON_LINE_STROKE}" stroke-linecap="round">
      ${ICON_LINE_PATHS.map((d) => `<path d="${d}"/>`).join("\n      ")}
    </g>`}
    <path d="${simplified ? sparkPath(Number(SPARK_X.toFixed(2)), Number(SPARK_Y.toFixed(2)), 10) : ICON_SPARK_PATH}" fill="${colors.line}"/>
  </g>
</svg>
`;
}
