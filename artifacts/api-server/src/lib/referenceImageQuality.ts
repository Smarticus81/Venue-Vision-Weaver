import sharp from "sharp";

type ReferenceProfile = "couple" | "venue";

export interface ReferenceImageQuality {
  width: number;
  height: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  perceptualHash: string;
}

const PROFILE_THRESHOLDS: Record<
  ReferenceProfile,
  {
    minBrightness: number;
    maxBrightness: number;
    minContrast: number;
    minSharpness: number;
  }
> = {
  couple: {
    minBrightness: 30,
    maxBrightness: 238,
    minContrast: 12,
    minSharpness: 14,
  },
  venue: {
    minBrightness: 24,
    maxBrightness: 242,
    minContrast: 10,
    minSharpness: 10,
  },
};

function statsFromPixels(pixels: Buffer): { mean: number; stdev: number } {
  let sum = 0;
  for (const value of pixels) sum += value;
  const mean = sum / pixels.length;

  let variance = 0;
  for (const value of pixels) {
    const delta = value - mean;
    variance += delta * delta;
  }

  return { mean, stdev: Math.sqrt(variance / pixels.length) };
}

function laplacianVariance(pixels: Buffer, width: number, height: number): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value =
        pixels[i] * 4 -
        pixels[i - 1] -
        pixels[i + 1] -
        pixels[i - width] -
        pixels[i + width];
      sum += value;
      sumSquares += value * value;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

function differenceHash(pixels: Buffer): string {
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = pixels[y * 9 + x];
      const right = pixels[y * 9 + x + 1];
      bits += left > right ? "1" : "0";
    }
  }
  return bits;
}

export function hammingDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

export async function assertReferenceImageQuality(params: {
  buffer: Buffer;
  label: string;
  minEdgePx: number;
  profile: ReferenceProfile;
}): Promise<ReferenceImageQuality> {
  const { buffer, label, minEdgePx, profile } = params;
  const image = sharp(buffer, { limitInputPixels: 48_000_000 }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (width < minEdgePx || height < minEdgePx) {
    throw new Error(
      `${label} is too small (${width}x${height}). Upload at least ${minEdgePx}px on each side.`,
    );
  }

  const normalized = image.clone().flatten({ background: "#ffffff" }).greyscale();
  const { data: qualityPixels, info } = await normalized
    .clone()
    .resize(256, 256, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hashPixels = await normalized
    .clone()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer();

  const { mean: brightness, stdev: contrast } = statsFromPixels(qualityPixels);
  const sharpness = laplacianVariance(qualityPixels, info.width, info.height);
  const thresholds = PROFILE_THRESHOLDS[profile];

  if (brightness < thresholds.minBrightness) {
    throw new Error(`${label} is too dark for reliable ${profile === "couple" ? "likeness" : "venue"} matching.`);
  }
  if (brightness > thresholds.maxBrightness) {
    throw new Error(`${label} is too washed out for reliable ${profile === "couple" ? "likeness" : "venue"} matching.`);
  }
  if (contrast < thresholds.minContrast) {
    throw new Error(`${label} has too little contrast. Upload a clearer, better-lit image.`);
  }
  if (sharpness < thresholds.minSharpness) {
    throw new Error(`${label} appears blurry. Upload a sharper image.`);
  }

  return {
    width,
    height,
    brightness,
    contrast,
    sharpness,
    perceptualHash: differenceHash(hashPixels),
  };
}
