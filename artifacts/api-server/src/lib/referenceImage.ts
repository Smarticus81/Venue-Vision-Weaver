import {
  assertReferenceImageQuality,
  hammingDistance,
  MIN_REFERENCE_EDGE_PX,
  NEAR_DUPLICATE_HAMMING,
  ReferenceImageError,
  type ReferenceImageQuality,
} from "./referenceImageQuality.js";

type ImageRef = { buffer: Buffer; mimeType: string };

export type ReferenceAspectRatio = "3:4" | "4:3" | "16:9" | "1:1" | "9:16";

/** Couple photos needed for a faithful likeness; the upload API enforces the same floor. */
export const MIN_COUPLE_REFERENCES = 2;
/** Venue photos needed before any gallery renders; venue readiness reads this. */
export const MIN_VENUE_REFERENCES = 5;

function assertImageClearEnough(
  label: string,
  image: ImageRef,
  profile: "couple" | "venue",
): Promise<ReferenceImageQuality> {
  // assertReferenceImageQuality also enforces the minimum edge (EXIF-rotated).
  return assertReferenceImageQuality({
    buffer: image.buffer,
    label,
    minEdgePx: MIN_REFERENCE_EDGE_PX,
    profile,
  });
}

/**
 * Fail the session if required reference photos are missing or unusable.
 * Every failure is a ReferenceImageError naming whose photos are at fault, so
 * the couple sees "your photos" only when it is their photos.
 */
export async function assertReferenceImagesValid(
  coupleBuffers: ImageRef[],
  venueBuffers: ImageRef[],
): Promise<void> {
  if (coupleBuffers.length < MIN_COUPLE_REFERENCES) {
    throw new ReferenceImageError(
      `At least ${MIN_COUPLE_REFERENCES} couple reference photos are required for accurate likeness.`,
      "couple",
    );
  }
  if (venueBuffers.length < MIN_VENUE_REFERENCES) {
    throw new ReferenceImageError(
      `At least ${MIN_VENUE_REFERENCES} venue reference photos are required. The venue owner must upload complete venue coverage before generation.`,
      "venue",
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
      if (
        hammingDistance(coupleQualities[i]!.perceptualHash, coupleQualities[j]!.perceptualHash) <=
        NEAR_DUPLICATE_HAMMING
      ) {
        throw new ReferenceImageError(
          `Couple photos ${i + 1} and ${j + 1} look nearly identical. Upload distinct angles or expressions for better likeness.`,
          "couple",
        );
      }
    }
  }
}
