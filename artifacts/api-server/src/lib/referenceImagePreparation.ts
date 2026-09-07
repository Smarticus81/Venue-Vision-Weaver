import sharp, { type Metadata } from "sharp";

export const REFERENCE_TARGET_MIN_EDGE_PX = 1024;

const REFERENCE_PREFERRED_MAX_EDGE_PX = 2048;
const REFERENCE_MAX_OUTPUT_PIXELS = 16_000_000;
const REFERENCE_INPUT_PIXEL_LIMIT = 120_000_000;

export interface PreparedReferenceImage {
  buffer: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  upscaled: boolean;
}

function orientedDimensions(metadata: Metadata): { width: number; height: number } {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const orientation = metadata.orientation ?? 1;
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return swapsAxes ? { width: height, height: width } : { width, height };
}

export function referenceTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number; upscaled: boolean } {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Reference photo dimensions could not be read.");
  }

  const sourceMinEdge = Math.min(sourceWidth, sourceHeight);
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
  let scale = 1;

  if (sourceMinEdge < REFERENCE_TARGET_MIN_EDGE_PX) {
    scale = REFERENCE_TARGET_MIN_EDGE_PX / sourceMinEdge;
  } else if (sourceMaxEdge > REFERENCE_PREFERRED_MAX_EDGE_PX) {
    // Downscale large references for a smaller Gemini payload, but never make
    // the shortest edge smaller than the target used for reliable references.
    scale = Math.max(
      REFERENCE_TARGET_MIN_EDGE_PX / sourceMinEdge,
      REFERENCE_PREFERRED_MAX_EDGE_PX / sourceMaxEdge,
    );
  }

  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  if (width * height > REFERENCE_MAX_OUTPUT_PIXELS) {
    throw new Error(
      "Reference photo has an unsupported aspect ratio. Use a standard portrait or landscape crop.",
    );
  }

  return {
    width,
    height,
    upscaled: scale > 1.001,
  };
}

/**
 * Prepare a reference-only copy for Gemini. This uses deterministic Lanczos
 * resampling and never invokes face restoration or generative enhancement, so
 * it cannot invent identity details. The original stored upload is untouched.
 */
export async function prepareReferenceImage(image: {
  buffer: Buffer;
  mimeType: string;
}): Promise<PreparedReferenceImage> {
  const metadata = await sharp(image.buffer, { limitInputPixels: REFERENCE_INPUT_PIXEL_LIMIT }).metadata();
  const source = orientedDimensions(metadata);
  const target = referenceTargetDimensions(source.width, source.height);

  const { data, info } = await sharp(image.buffer, { limitInputPixels: REFERENCE_INPUT_PIXEL_LIMIT })
    .rotate()
    .resize({
      width: target.width,
      height: target.height,
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .flatten({ background: "#ffffff" })
    .normalize({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    sourceWidth: source.width,
    sourceHeight: source.height,
    width: info.width,
    height: info.height,
    upscaled: target.upscaled,
  };
}
