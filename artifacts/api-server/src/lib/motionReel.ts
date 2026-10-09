import { spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ICON_BODY_PATH,
  ICON_LINE_PATHS,
  ICON_LINE_STROKE,
  ICON_SPARK_PATHS,
  ICON_SPARK_STROKE,
  LOCKUP_GAP,
  LOCKUP_HEIGHT,
  LOCKUP_ICON_OFFSET_Y,
  LOCKUP_ICON_SCALE,
  LOCKUP_ICON_WIDTH,
  LOCKUP_WIDTH,
  WORDMARK_PATHS,
  WORDMARK_STROKE,
  coral,
  font,
  ink,
  ivory,
} from "@workspace/brand";
import { logger } from "./logger.js";

const REEL_WIDTH = 1280;
const REEL_HEIGHT = 720;
/** zoompan works on a frame this many times the output size (sub-pixel smooth pans). */
export const REEL_SUPERSAMPLE = 2;
/** Ken Burns zoom range: 1.0 <-> REEL_MAX_ZOOM. */
export const REEL_MAX_ZOOM = 1.1;
const REEL_FPS = 30;
const MIN_REEL_BYTES = 20_000;
const DEFAULT_FFMPEG_TIMEOUT_MS = 120_000;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

interface MotionReelBrandingOptions {
  venueName?: string | null;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/* ------------------------------------------------------------------------
 * Title lettering. The production image installs no brand font, so text in
 * the reel is drawn as stroked paths (like the wordmark) from a small
 * monoline capital alphabet: cap height 100 units, y down, baseline at 100.
 * It renders identically everywhere sharp/librsvg runs, with no font files.
 * --------------------------------------------------------------------- */

type StrokeGlyph = { w: number; d: string };

const STROKE_GLYPHS: Record<string, StrokeGlyph> = {
  A: { w: 76, d: "M0 100 L38 0 L76 100 M14 64 H62" },
  B: { w: 61, d: "M0 100 V0 H34 A23 23 0 0 1 34 46 H0 M34 46 A27 27 0 0 1 34 100 H0" },
  C: { w: 72, d: "M70.3 14.6 A40 50 0 1 0 70.3 85.4" },
  D: { w: 70, d: "M0 0 V100 H30 A40 50 0 0 0 30 0 Z" },
  E: { w: 56, d: "M56 0 H0 V100 H56 M0 50 H46" },
  F: { w: 56, d: "M56 0 H0 V100 M0 50 H46" },
  G: { w: 82, d: "M70.3 14.6 A40 50 0 1 0 82 50 H50" },
  H: { w: 66, d: "M0 0 V100 M66 0 V100 M0 50 H66" },
  I: { w: 0, d: "M0 0 V100" },
  J: { w: 48, d: "M48 0 V76 A24 24 0 0 1 0 76" },
  K: { w: 64, d: "M0 0 V100 M62 0 L0 62 M22 42 L64 100" },
  L: { w: 54, d: "M0 0 V100 H54" },
  M: { w: 84, d: "M0 100 V0 L42 70 L84 0 V100" },
  N: { w: 68, d: "M0 100 V0 L68 100 V0" },
  O: { w: 88, d: "M0 50 A44 50 0 1 0 88 50 A44 50 0 1 0 0 50 Z" },
  P: { w: 59, d: "M0 100 V0 H34 A25 25 0 0 1 34 50 H0" },
  Q: { w: 92, d: "M0 50 A44 50 0 1 0 88 50 A44 50 0 1 0 0 50 Z M58 74 L92 104" },
  R: { w: 62, d: "M0 100 V0 H34 A25 25 0 0 1 34 50 H0 M30 50 L62 100" },
  S: { w: 62, d: "M60 18 C56 6 46 0 31 0 C14 0 2 10 2 25 C2 42 18 47 31 50 C46 53 62 58 62 75 C62 90 49 100 31 100 C15 100 3 93 0 80" },
  T: { w: 70, d: "M0 0 H70 M35 0 V100" },
  U: { w: 68, d: "M0 0 V66 A34 34 0 0 0 68 66 V0" },
  V: { w: 72, d: "M0 0 L36 100 L72 0" },
  W: { w: 100, d: "M0 0 L24 100 L50 20 L76 100 L100 0" },
  X: { w: 66, d: "M0 0 L66 100 M66 0 L0 100" },
  Y: { w: 68, d: "M0 0 L34 50 L68 0 M34 50 V100" },
  Z: { w: 64, d: "M0 0 H64 L0 100 H64" },
  "0": { w: 56, d: "M0 50 A28 50 0 1 0 56 50 A28 50 0 1 0 0 50 Z" },
  "1": { w: 26, d: "M0 18 L26 0 V100" },
  "2": { w: 58, d: "M2 22 C4 8 16 0 29 0 C44 0 56 10 56 26 C56 44 40 56 0 100 H58" },
  "3": { w: 58, d: "M2 10 C8 3 18 0 28 0 C44 0 54 10 54 25 C54 40 42 48 26 48 C44 48 58 58 58 74 C58 90 46 100 29 100 C16 100 6 95 0 86" },
  "4": { w: 60, d: "M44 100 V0 L0 70 H60" },
  "5": { w: 58, d: "M54 0 H8 L4 46 C12 40 20 38 30 38 C46 38 58 50 58 69 C58 88 45 100 29 100 C16 100 6 95 0 86" },
  "6": { w: 58, d: "M50 6 C44 2 37 0 30 0 C12 0 2 22 2 52 C2 82 12 100 30 100 C46 100 58 88 58 70 C58 52 46 40 30 40 C18 40 8 46 2 56" },
  "7": { w: 58, d: "M0 0 H58 L20 100" },
  "8": { w: 58, d: "M29 46 A24 23 0 1 1 29 0 A24 23 0 1 1 29 46 Z M29 46 A28 27 0 1 0 29 100 A28 27 0 1 0 29 46 Z" },
  "9": { w: 56, d: "M8 94 C14 98 21 100 28 100 C46 100 56 78 56 48 C56 18 46 0 28 0 C12 0 0 12 0 30 C0 48 12 60 28 60 C40 60 50 54 56 44" },
  "&": { w: 64, d: "M62 100 L14 34 C8 26 8 18 8 16 C8 6 16 0 26 0 C36 0 44 6 44 16 C44 30 30 38 18 46 C6 54 0 62 0 74 C0 90 12 100 28 100 C42 100 52 92 60 78 L64 66" },
  "'": { w: 0, d: "M0 0 V22" },
  '"': { w: 14, d: "M0 0 V22 M14 0 V22" },
  ".": { w: 0, d: "M0 99 V100" },
  ",": { w: 4, d: "M4 94 L0 112" },
  "-": { w: 36, d: "M0 58 H36" },
  ":": { w: 0, d: "M0 33 V34 M0 99 V100" },
  "!": { w: 0, d: "M0 0 V70 M0 99 V100" },
  "?": { w: 50, d: "M0 22 C2 8 14 0 26 0 C40 0 50 9 50 22 C50 40 26 44 26 68 M26 99 V100" },
  "/": { w: 44, d: "M44 0 L0 100" },
  "(": { w: 20, d: "M20 0 C4 24 4 76 20 100" },
  ")": { w: 20, d: "M0 0 C16 24 16 76 0 100" },
};
const SPACE_UNITS = 72;
const TRACKING_UNITS = 22;

/** Uppercase, accent-free text limited to the stroke alphabet (unsupported characters dropped). */
export function strokeTextFor(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ß/g, "SS")
    .replace(/æ/gi, "AE")
    .replace(/ø/gi, "O")
    .toUpperCase()
    .split("")
    .filter((char) => char === " " || char in STROKE_GLYPHS)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Width of stroke text in glyph units (cap height = 100). */
export function strokeTextWidth(text: string): number {
  let width = 0;
  let previousWasGlyph = false;
  for (const char of text) {
    if (char === " ") {
      width += SPACE_UNITS;
      previousWasGlyph = false;
      continue;
    }
    if (previousWasGlyph) width += TRACKING_UNITS;
    width += STROKE_GLYPHS[char]!.w;
    previousWasGlyph = true;
  }
  return width;
}

/**
 * SVG group drawing `text` (already passed through strokeTextFor) centred on
 * `centerX`, with its cap top at `top` and the given cap height in px.
 */
function strokeTextSvg(params: {
  text: string;
  centerX: number;
  top: number;
  capHeight: number;
  color: string;
  strokeUnits: number;
}): string {
  const scale = params.capHeight / 100;
  const width = strokeTextWidth(params.text);
  const left = params.centerX - (width * scale) / 2;
  const paths: string[] = [];
  let x = 0;
  let previousWasGlyph = false;
  for (const char of params.text) {
    if (char === " ") {
      x += SPACE_UNITS;
      previousWasGlyph = false;
      continue;
    }
    if (previousWasGlyph) x += TRACKING_UNITS;
    const glyph = STROKE_GLYPHS[char]!;
    paths.push(`<path transform="translate(${x} 0)" d="${glyph.d}"/>`);
    x += glyph.w;
    previousWasGlyph = true;
  }
  return `<g transform="translate(${left.toFixed(2)} ${params.top.toFixed(2)}) scale(${scale.toFixed(4)})" fill="none" stroke="${params.color}" stroke-width="${params.strokeUnits}" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</g>`;
}

/** Split a long name into at most two lines at the space nearest the middle. */
function splitTitleLines(text: string): string[] {
  const spaces = [...text.matchAll(/ /g)].map((match) => match.index ?? 0);
  if (spaces.length === 0) return [text];
  const middle = text.length / 2;
  const at = spaces.reduce((best, index) => (Math.abs(index - middle) < Math.abs(best - middle) ? index : best));
  return [text.slice(0, at), text.slice(at + 1)];
}

/** Layout for the venue name: one line at up to 44px caps, or two lines when it would get too small. */
export function layoutVenueTitle(
  text: string,
  maxWidthPx = 1100,
): { lines: string[]; capHeight: number } {
  const preferred = 44;
  const minimum = 28;
  const fit = (lines: string[]) =>
    Math.min(preferred, ...lines.map((line) => (maxWidthPx / Math.max(1, strokeTextWidth(line))) * 100));
  const single = fit([text]);
  if (single >= minimum) return { lines: [text], capHeight: single };
  const lines = splitTitleLines(text);
  return { lines, capHeight: Math.max(16, fit(lines)) };
}

/** Width of the Dreemer lockup on the title card, in output pixels. */
const TITLE_LOCKUP_WIDTH = 420;

/**
 * The lockup drawn from the brand geometry (no font needed), scaled to
 * TITLE_LOCKUP_WIDTH and centred horizontally with its top edge at `top`.
 */
function reelLockupSvg(top: number): string {
  const scale = TITLE_LOCKUP_WIDTH / LOCKUP_WIDTH;
  const left = (REEL_WIDTH - TITLE_LOCKUP_WIDTH) / 2;
  const wordX = LOCKUP_ICON_WIDTH + LOCKUP_GAP;
  return `<g transform="translate(${left} ${top}) scale(${scale})">
        <g transform="translate(0 ${LOCKUP_ICON_OFFSET_Y}) scale(${LOCKUP_ICON_SCALE})">
          <path d="${ICON_BODY_PATH}" fill="${coral[500]}"/>
          <g fill="none" stroke="${coral[400]}" stroke-width="${ICON_LINE_STROKE}" stroke-linecap="round">
            ${ICON_LINE_PATHS.map((d) => `<path d="${d}"/>`).join("\n            ")}
          </g>
          <g fill="none" stroke="${coral[400]}" stroke-width="${ICON_SPARK_STROKE}" stroke-linecap="round">
            ${ICON_SPARK_PATHS.map((d) => `<path d="${d}"/>`).join("\n            ")}
          </g>
        </g>
        <g transform="translate(${wordX} 0)" fill="none" stroke="${ivory[100]}" stroke-width="${WORDMARK_STROKE}" stroke-linejoin="round">
          ${WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join("\n          ")}
        </g>
      </g>`;
}

/**
 * Branded opening card: the Dreemer lockup, "CREATED FOR" and the venue
 * name, all drawn as paths. `scale` renders the same 1280x720 layout at a
 * multiple of that size (the reel uses its supersampled size).
 */
export async function buildReelTitleCard(
  options: MotionReelBrandingOptions,
  scale = 1,
): Promise<Buffer | null> {
  const venueName = options.venueName?.trim();
  if (!venueName) return null;

  const trimmedName = venueName.slice(0, 90);
  const lockupTop = 220;
  const lockupHeight = LOCKUP_HEIGHT * (TITLE_LOCKUP_WIDTH / LOCKUP_WIDTH);
  const createdForTop = Math.round(lockupTop + lockupHeight + 84);
  const strokeName = strokeTextFor(trimmedName);
  // Names in scripts the stroke alphabet cannot draw keep the text element
  // (rendered with whatever fonts the host has) rather than vanishing.
  const drawable = strokeName.replace(/ /g, "").length >= Math.ceil(trimmedName.replace(/\s/g, "").length * 0.7);

  let venueSvg: string;
  if (drawable && strokeName) {
    const layout = layoutVenueTitle(strokeName);
    const firstTop = createdForTop + 44;
    venueSvg = layout.lines
      .map((line, index) =>
        strokeTextSvg({
          text: line,
          centerX: REEL_WIDTH / 2,
          top: firstTop + index * layout.capHeight * 1.5,
          capHeight: layout.capHeight,
          color: ivory[100],
          strokeUnits: 9,
        }),
      )
      .join("\n      ");
  } else {
    const venueFontSize = trimmedName.length > 56 ? 30 : trimmedName.length > 34 ? 38 : 48;
    venueSvg = `<text x="640" y="${createdForTop + 44 + venueFontSize}" text-anchor="middle" font-family="${font.email}" font-size="${venueFontSize}" font-weight="600" fill="${ivory[100]}">${escapeSvgText(trimmedName)}</text>`;
  }

  const width = Math.round(REEL_WIDTH * scale);
  const height = Math.round(REEL_HEIGHT * scale);
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${REEL_WIDTH} ${REEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${ink[900]}"/>
          <stop offset="100%" stop-color="${ink[800]}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="40%" r="58%">
          <stop offset="0%" stop-color="${coral[500]}" stop-opacity="0.16"/>
          <stop offset="55%" stop-color="${coral[500]}" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="${coral[500]}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <rect width="100%" height="100%" fill="url(#glow)"/>
      ${reelLockupSvg(lockupTop)}
      ${strokeTextSvg({ text: "CREATED FOR", centerX: REEL_WIDTH / 2, top: createdForTop, capHeight: 15, color: ink[300], strokeUnits: 11 })}
      ${venueSvg}
    </svg>`;

  return sharp(Buffer.from(svg))
    .resize(width, height)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
}

export function assertUsableMotionReel(buffer: Buffer): void {
  if (buffer.length < MIN_REEL_BYTES) {
    throw new Error(`Motion reel is unusably small (${buffer.length} bytes).`);
  }
  if (buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("Motion reel is not a valid MP4 file.");
  }
}

export function ffmpegExecutable(): string {
  const explicit = process.env.FFMPEG_PATH?.trim();
  if (explicit) return explicit;

  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    path.resolve(process.cwd(), "bin", binaryName),
    path.resolve(process.cwd(), "artifacts", "api-server", "bin", binaryName),
    path.resolve(process.cwd(), "artifacts", "api-server", "dist", "bin", binaryName),
    path.resolve(MODULE_DIR, "bin", binaryName),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "ffmpeg";
}

export function checkFfmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegExecutable(), ["-version"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

function ffmpegTimeoutMs(): number {
  const parsed = Number(process.env.FFMPEG_TIMEOUT_MS ?? DEFAULT_FFMPEG_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FFMPEG_TIMEOUT_MS;
}

/**
 * Run ffmpeg with a kill timer: a wedged encode is SIGKILLed after
 * FFMPEG_TIMEOUT_MS (default 120s) or when the session deadline aborts, so a
 * stuck process can never hold a worker slot.
 */
export function runFfmpeg(
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal; executable?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const executable = options.executable ?? ffmpegExecutable();
    const timeoutMs = options.timeoutMs ?? ffmpegTimeoutMs();
    const proc = spawn(executable, ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    let killedFor: "timeout" | "abort" | null = null;

    const finish = (err: unknown | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const kill = (reason: "timeout" | "abort") => {
      killedFor = reason;
      proc.kill("SIGKILL");
    };
    const onAbort = () => kill("abort");
    const timer = setTimeout(() => kill("timeout"), timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-8_000);
    });
    proc.on("error", (err) => {
      finish(
        new Error(
          `ffmpeg executable not available (${executable}). Install ffmpeg or set FFMPEG_PATH. ${err.message}`,
        ),
      );
    });
    proc.on("close", (code) => {
      if (killedFor === "abort") finish(options.signal?.reason ?? new Error("ffmpeg aborted"));
      else if (killedFor === "timeout") finish(new Error(`ffmpeg timed out after ${timeoutMs}ms and was killed`));
      else if (code === 0) finish(null);
      else finish(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-800)}`));
    });
  });
}

async function tmpFile(suffix: string): Promise<string> {
  return path.join(
    os.tmpdir(),
    `dreemer-reel-${crypto.randomBytes(6).toString("hex")}${suffix}`,
  );
}

/**
 * Fit one still into the supersampled 16:9 reel frame. A still whose shape
 * differs from 16:9 (the 3:4 portraits, the 4:3 close-up) is letterboxed over
 * a blurred, darkened copy of itself instead of being cropped, and sized so
 * it stays fully visible even at the deepest Ken Burns zoom. 16:9 stills fill
 * the frame.
 */
export async function composeReelFrame(
  slide: Buffer,
  options: { width?: number; height?: number; maxZoom?: number } = {},
): Promise<{ buffer: Buffer; letterboxed: boolean }> {
  const width = options.width ?? REEL_WIDTH * REEL_SUPERSAMPLE;
  const height = options.height ?? REEL_HEIGHT * REEL_SUPERSAMPLE;
  const maxZoom = options.maxZoom ?? REEL_MAX_ZOOM;
  const oriented = await sharp(slide).rotate().toBuffer({ resolveWithObject: true });
  const ratio = oriented.info.width / oriented.info.height;
  const target = width / height;

  if (Math.abs(ratio - target) / target <= 0.02) {
    const buffer = await sharp(oriented.data)
      .resize(width, height, { fit: "cover", kernel: "lanczos3" })
      .jpeg({ quality: 92 })
      .toBuffer();
    return { buffer, letterboxed: false };
  }

  // Blur at 1/8 size, then scale up: cheap, and smoother than a big boxblur.
  const background = await sharp(oriented.data)
    .resize(Math.round(width / 8), Math.round(height / 8), { fit: "cover" })
    .blur(4)
    .modulate({ brightness: 0.55 })
    .resize(width, height, { kernel: "cubic" })
    .toBuffer();
  const foreground = await sharp(oriented.data)
    .resize(Math.floor(width / maxZoom), Math.floor(height / maxZoom), {
      fit: "inside",
      kernel: "lanczos3",
    })
    .toBuffer({ resolveWithObject: true });
  const buffer = await sharp(background)
    .composite([
      {
        input: foreground.data,
        left: Math.round((width - foreground.info.width) / 2),
        top: Math.round((height - foreground.info.height) / 2),
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer, letterboxed: true };
}

/**
 * zoompan filter for one Ken Burns clip. The input is already the
 * supersampled 16:9 frame; zoom runs linearly off the output frame counter
 * (the recursive form stalled at its cap mid-clip) between 1 and
 * REEL_MAX_ZOOM, centred.
 */
export function kenBurnsFilter(frames: number, zoomIn: boolean): string {
  const superWidth = REEL_WIDTH * REEL_SUPERSAMPLE;
  const superHeight = REEL_HEIGHT * REEL_SUPERSAMPLE;
  const span = (REEL_MAX_ZOOM - 1).toFixed(3);
  const last = Math.max(1, frames - 1);
  const zoomExpr = zoomIn ? `1+${span}*on/${last}` : `${REEL_MAX_ZOOM}-${span}*on/${last}`;
  return (
    `scale=${superWidth}:${superHeight},setsar=1,` +
    `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${REEL_FPS}`
  );
}

async function concatClips(clips: Buffer[], signal?: AbortSignal): Promise<Buffer> {
  if (clips.length === 0) throw new Error("concatClips: no clips provided");
  if (clips.length === 1) return clips[0]!;

  const clipPaths: string[] = [];
  const listPath = await tmpFile(".txt");
  const outPath = await tmpFile(".mp4");
  try {
    for (const buffer of clips) {
      const clipPath = await tmpFile(".mp4");
      await fs.writeFile(clipPath, buffer);
      clipPaths.push(clipPath);
    }

    const listContent = clipPaths
      .map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`)
      .join("\n");
    await fs.writeFile(listPath, listContent);

    await runFfmpeg(
      [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { signal },
    );

    const stitched = await fs.readFile(outPath);
    logger.info({ clipCount: clips.length, stitchedBytes: stitched.length }, "Stitched gallery reel clips");
    return stitched;
  } finally {
    fs.unlink(listPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
    for (const clipPath of clipPaths) fs.unlink(clipPath).catch(() => {});
  }
}

export async function buildKenBurnsSlideshow(
  slides: Buffer[],
  secondsPerSlide = 4,
  branding: MotionReelBrandingOptions = {},
  signal?: AbortSignal,
): Promise<Buffer> {
  if (slides.length === 0) throw new Error("buildKenBurnsSlideshow: no slides provided");

  const clipBuffers: Buffer[] = [];
  const clipPaths: string[] = [];
  const titleCard = await buildReelTitleCard(branding, REEL_SUPERSAMPLE);
  const reelSlides = titleCard ? [titleCard, ...slides] : slides;
  let letterboxed = 0;

  try {
    for (let i = 0; i < reelSlides.length; i++) {
      signal?.throwIfAborted();
      const frame = await composeReelFrame(reelSlides[i]!);
      if (frame.letterboxed) letterboxed += 1;
      const clipPath = await tmpFile(`-clip-${i}.mp4`);
      clipPaths.push(clipPath);
      await renderKenBurnsClip(frame.buffer, secondsPerSlide, i % 2 === 0, clipPath, signal);
      clipBuffers.push(await fs.readFile(clipPath));
    }

    const reel = await concatClips(clipBuffers, signal);
    assertUsableMotionReel(reel);
    logger.info(
      {
        slideCount: slides.length,
        titleCard: Boolean(titleCard),
        letterboxed,
        reelBytes: reel.length,
      },
      "Built gallery motion reel",
    );
    return reel;
  } finally {
    for (const clipPath of clipPaths) fs.unlink(clipPath).catch(() => {});
  }
}

async function renderKenBurnsClip(
  frame: Buffer,
  secondsPerSlide: number,
  zoomIn: boolean,
  outPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const frames = Math.round(secondsPerSlide * REEL_FPS);
  const imgPath = await tmpFile(".jpg");

  try {
    await fs.writeFile(imgPath, frame);
    await runFfmpeg(
      [
        "-i",
        imgPath,
        "-vf",
        kenBurnsFilter(frames, zoomIn),
        "-frames:v",
        String(frames),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { signal },
    );
  } finally {
    fs.unlink(imgPath).catch(() => {});
  }
}
