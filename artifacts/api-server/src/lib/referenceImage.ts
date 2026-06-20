import sharp from "sharp";
import {
  assertReferenceImageQuality,
  hammingDistance,
  type ReferenceImageQuality,
} from "./referenceImageQuality.js";

type ImageRef = { buffer: Buffer; mimeType: string };

export type ReferenceAspectRatio = "3:4" | "4:3" | "16:9" | "1:1" | "9:16";

const MIN_REFERENCE_EDGE_PX = 1024;
const MIN_COUPLE_REFERENCES = 2;
const MIN_VENUE_REFERENCES = 5;

async function assertImageLargeEnough(label: string, image: ImageRef): Promise<void> {
  const meta = await sharp(image.buffer).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < MIN_REFERENCE_EDGE_PX || height < MIN_REFERENCE_EDGE_PX) {
    throw new Error(
      `${label} reference photo is too small (${width}x${height}). Upload at least ${MIN_REFERENCE_EDGE_PX}px on each side.`,
    );
  }
}

async function assertImageClearEnough(
  label: string,
  image: ImageRef,
  profile: "couple" | "venue",
): Promise<ReferenceImageQuality> {
  await assertImageLargeEnough(label, image);
  return assertReferenceImageQuality({
    buffer: image.buffer,
    label,
    minEdgePx: MIN_REFERENCE_EDGE_PX,
    profile,
  });
}

/** Fail the session if required reference photos are missing or unusable. */
export async function assertReferenceImagesValid(
  coupleBuffers: ImageRef[],
  venueBuffers: ImageRef[],
): Promise<void> {
  if (coupleBuffers.length < MIN_COUPLE_REFERENCES) {
    throw new Error(
      `At least ${MIN_COUPLE_REFERENCES} couple reference photos are required for accurate likeness.`,
    );
  }
  if (venueBuffers.length < MIN_VENUE_REFERENCES) {
    throw new Error(
      `At least ${MIN_VENUE_REFERENCES} venue reference photos are required. The venue owner must upload complete venue coverage before generation.`,
    );
  }
  const coupleQualities = await Promise.all(
    coupleBuffers.map((img, i) => assertImageClearEnough(`Couple photo ${i + 1}`, img, "couple")),
  );
  await Promise.all(
    venueBuffers.map((img, i) => assertImageClearEnough(`Venue photo ${i + 1}`, img, "venue")),
  );

  for (let i = 0; i < coupleQualities.length; i++) {
    for (let j = i + 1; j < coupleQualities.length; j++) {
      if (hammingDistance(coupleQualities[i]!.perceptualHash, coupleQualities[j]!.perceptualHash) <= 4) {
        throw new Error(
          `Couple photos ${i + 1} and ${j + 1} look nearly identical. Upload distinct angles or expressions for better likeness.`,
        );
      }
    }
  }
}
