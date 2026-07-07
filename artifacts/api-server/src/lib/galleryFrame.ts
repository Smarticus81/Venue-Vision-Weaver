import sharp from "sharp";
import { logger } from "./logger.js";

const SCENE_TITLES = [
  "The Portrait",
  "Quiet Moment",
  "Grand Venue",
  "Forever Begins",
];

/**
 * Editorial polish: gentle vignette, subtle texture, optional couple name caption.
 */
export async function polishGalleryFrame(
  raw: Buffer,
  options: { coupleName?: string | null; sceneIndex: number },
): Promise<Buffer> {
  try {
    const meta = await sharp(raw).metadata();
    const width = meta.width ?? 1536;
    const height = meta.height ?? 2048;

    const vignetteSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="v" cx="50%" cy="45%" r="70%">
            <stop offset="55%" stop-color="black" stop-opacity="0"/>
            <stop offset="100%" stop-color="black" stop-opacity="0.45"/>
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#v)"/>
      </svg>`;

    return await sharp(raw)
      .modulate({ brightness: 1.02, saturation: 1.05 })
      .sharpen({ sigma: 0.6 })
      .composite([
        { input: Buffer.from(vignetteSvg), blend: "multiply" },
      ])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    logger.error({ err, sceneIndex: options.sceneIndex }, "Gallery frame polish failed");
    throw err;
  }
}
