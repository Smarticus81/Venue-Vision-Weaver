import sharp from "sharp";
import type { ReferenceAspectRatio } from "./referenceImage.js";
import { logger } from "./logger.js";
import {
  VENUE_MEDIA_COVERAGE_LABELS,
  isVenueMediaCoverage,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";
import { GalleryQualityError } from "./galleryQuality.js";
import {
  prepareReferenceImage,
  REFERENCE_TARGET_MIN_EDGE_PX,
} from "./referenceImagePreparation.js";

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_INTERACTIONS_API_REVISION =
  process.env.GEMINI_INTERACTIONS_API_REVISION ?? "2026-05-20";
const DEFAULT_IMAGE_MODELS = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
];
const MAX_TOTAL_REFERENCE_IMAGES = 14;
const MAX_COUPLE_REFERENCES = 3;
const GENERATED_MIN_EDGE_PX = Number(process.env.GENERATED_IMAGE_MIN_EDGE_PX ?? "1024");
const GENERATED_MIN_CONTRAST = Number(process.env.GENERATED_IMAGE_MIN_CONTRAST ?? "8");
const GENERATED_MIN_SHARPNESS = Number(process.env.GENERATED_IMAGE_MIN_SHARPNESS ?? "6");
const GENERATED_MIN_BRIGHTNESS = Number(process.env.GENERATED_IMAGE_MIN_BRIGHTNESS ?? "18");
const GENERATED_MAX_BRIGHTNESS = Number(process.env.GENERATED_IMAGE_MAX_BRIGHTNESS ?? "246");

type ImagePart = { text?: string; inlineData?: { mimeType: string; data: string } };
type InteractionInput =
  | { type: "text"; text: string }
  | { type: "image"; mime_type: string; data: string };
type VenueReferenceInput = {
  buffer: Buffer;
  coverage?: VenueMediaCoverage | null;
};

function geminiApiBase(): string {
  return (process.env.GEMINI_API_BASE_URL ?? DEFAULT_GEMINI_API_BASE).replace(/\/$/, "");
}

class StillImageBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StillImageBlockedError";
  }
}

type StillAspectRatio = ReferenceAspectRatio;

interface GeneratedStillResult {
  buffer: Buffer;
  model: string;
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }[];
    };
    finishReason?: string;
    safetyRatings?: { category?: string; probability?: string; blocked?: boolean }[];
  }[];
  promptFeedback?: {
    blockReason?: string;
    safetyRatings?: { category?: string; probability?: string; blocked?: boolean }[];
  };
  error?: { message?: string; code?: number; status?: string };
}

interface GeminiInteractionResponse {
  output_image?: { mime_type?: string; mimeType?: string; data?: string };
  outputImage?: { mime_type?: string; mimeType?: string; data?: string };
  error?: { message?: string; code?: number; status?: string };
}

function extractImageBytes(json: GeminiResponse): Buffer | null {
  const candidates = json.candidates ?? [];
  for (const c of candidates) {
    const parts = c.content?.parts ?? [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        return Buffer.from(p.inlineData.data, "base64");
      }
    }
  }
  return null;
}

function extractInteractionImageBytes(json: GeminiInteractionResponse): Buffer | null {
  const direct = json.output_image?.data ?? json.outputImage?.data;
  if (direct) return Buffer.from(direct, "base64");
  return null;
}

function findTextNote(json: GeminiResponse): string {
  const candidates = json.candidates ?? [];
  for (const c of candidates) {
    const parts = c.content?.parts ?? [];
    for (const p of parts) {
      if (p.text) return p.text.slice(0, 300);
    }
  }
  return "";
}

function isGemini3ImageModel(model: string): boolean {
  return /^gemini-3(?:\.\d+)?-(?:pro|flash|flash-lite)-image$/i.test(model);
}

function useInteractionsApiForImageGeneration(model: string): boolean {
  return isGemini3ImageModel(model) && process.env.GEMINI_USE_INTERACTIONS_API === "true";
}

function referenceLimitsForModel(model: string): { couple: number; venue: number } {
  if (model === "gemini-3-pro-image") {
    return { couple: 3, venue: 6 };
  }
  if (model === "gemini-3.1-flash-image") {
    return { couple: 3, venue: 10 };
  }
  if (model === "gemini-2.5-flash-image") {
    return { couple: 2, venue: 1 };
  }
  return { couple: MAX_COUPLE_REFERENCES, venue: MAX_TOTAL_REFERENCE_IMAGES - MAX_COUPLE_REFERENCES };
}

function normalizedVenueCoverage(value: unknown): VenueMediaCoverage | null {
  return isVenueMediaCoverage(value) ? value : null;
}

function venueCoverageLabel(coverage?: VenueMediaCoverage | null): string | null {
  return coverage ? VENUE_MEDIA_COVERAGE_LABELS[coverage] : null;
}

function buildReferencePayload(params: {
  model: string;
  prompt: string;
  aspectInstruction: string;
  normalizedCoupleRefs: Buffer[];
  normalizedVenueRefs: VenueReferenceInput[];
}): {
  fullPrompt: string;
  imageParts: ImagePart[];
  interactionInputs: InteractionInput[];
  coupleRefCount: number;
  venueRefCount: number;
} {
  const limits = referenceLimitsForModel(params.model);
  const coupleRefs = params.normalizedCoupleRefs.slice(0, limits.couple);
  const venueRefs = params.normalizedVenueRefs.slice(
    0,
    Math.max(1, Math.min(limits.venue, MAX_TOTAL_REFERENCE_IMAGES - coupleRefs.length)),
  );
  const venueImageIndex = coupleRefs.length + 1;
  const coupleImageLabels = coupleRefs.map((_, i) => `INPUT IMAGE ${i + 1}`).join(", ");
  const venueImageLabels = venueRefs
    .map((_, i) => `INPUT IMAGE ${venueImageIndex + i}`)
    .join(", ");
  const venueCoverageSummary = venueRefs
    .map((ref, i) => {
      const label = venueCoverageLabel(ref.coverage);
      return label ? `INPUT IMAGE ${venueImageIndex + i}: ${label}` : null;
    })
    .filter((line): line is string => Boolean(line))
    .join("; ");
  const expectedRoleLines = [
    "INPUT IMAGE 1 is expected to be the together reference that calibrates the relationship, relative scale, shared skin/lighting context, and how Partner A and Partner B appear as a pair.",
    "INPUT IMAGE 2 is expected to be the clearest face-forward reference for Partner A.",
    "INPUT IMAGE 3 is expected to be the clearest face-forward reference for Partner B.",
  ];
  const coupleRoleSummary = [
    ...expectedRoleLines.slice(0, coupleRefs.length),
    "If the uploaded order differs, infer Partner A and Partner B from all couple references together, but never collapse the two identities into one averaged face.",
  ].join(" ");
  const fullPrompt =
    `${params.prompt}\n\n` +
    `COUPLE IDENTITY MANIFEST (${coupleImageLabels}): Treat these inputs as multiple identity observations of the same two real adult partners. First infer two stable identities, Partner A and Partner B, from all reference images together. Preserve each partner's exact facial geometry, eyes, eyebrows, nose, mouth, jaw, ears, skin tone, hair color, hairline, glasses, freckles, moles, age, build, and natural expression cues. Both partners must remain individually recognizable, not averaged into generic wedding faces.\n` +
    `COUPLE REFERENCE ROLES: ${coupleRoleSummary}\n` +
    `IDENTITY HARD CONSTRAINT: The output may change clothing, pose, and lighting for the wedding scene, but it may not substitute, beautify, slim, de-age, gender-swap, face-swap, merge, hide, or stylize either partner. If references disagree, use the clearest frontal face for identity and the remaining references only to confirm secondary traits.\n` +
    `VENUE SCENE MANIFEST (${venueImageLabels}): The wedding happens at this exact venue. INPUT IMAGE ${venueImageIndex} is the mandatory scene anchor: preserve its real architecture, layout, materials, decor, windows, fixtures, scale, color temperature, and light direction. Remaining venue images are factual context for the same venue and must support the scene without inventing a generic ballroom, chapel, hotel, garden, or studio.\n` +
    (venueCoverageSummary
      ? `VENUE COVERAGE ROLES: ${venueCoverageSummary}. Use these roles to choose the correct real venue feature for this scene while preserving the exact architecture from the matching uploaded reference.\n`
      : "") +
    `COMPOSITING HARD CONSTRAINT: integrate the exact couple naturally into the exact venue photograph with realistic scale, perspective, contact shadows, lens depth, matching light direction, and believable camera optics. Keep both faces crisp, unobstructed, front-readable, and fully visible. Do not crop through faces. Do not add extra people.\n` +
    `Output: one photorealistic ${params.aspectInstruction} cinematic wedding photograph with both people from the couple references together inside the venue. Instant recognition required. No text, captions, watermarks, or logos.`;

  const imageParts: ImagePart[] = [];
  const interactionInputs: InteractionInput[] = [{ type: "text", text: fullPrompt }];
  coupleRefs.forEach((buf, index) => {
    const role =
      index === 0
        ? "TOGETHER REFERENCE - use to establish both partners as a pair, their relative scale, and any shared identity context"
        : index === 1
          ? "PARTNER A FACE REFERENCE - use as the clearest identity observation for Partner A when it matches the uploaded content"
          : "PARTNER B FACE REFERENCE - use as the clearest identity observation for Partner B when it matches the uploaded content";
    const label =
      `INPUT IMAGE ${index + 1}: COUPLE IDENTITY REFERENCE ${index + 1} (${role}). ` +
      "Use this only to preserve Partner A and Partner B likenesses. Extract identity traits; ignore clothing/background unless useful for identity. If the stated role does not match the photo content, infer the correct identity mapping from all couple references together.";
    imageParts.push(
      { text: label },
      { inlineData: { mimeType: "image/jpeg", data: buf.toString("base64") } },
    );
    interactionInputs.push(
      { type: "text", text: label },
      { type: "image", mime_type: "image/jpeg", data: buf.toString("base64") },
    );
  });
  venueRefs.forEach((ref, index) => {
    const inputIndex = venueImageIndex + index;
    const coverage = venueCoverageLabel(ref.coverage);
    const fidelity =
      index === 0
        ? "SCENE ANCHOR"
        : index < 6
          ? "HIGH-FIDELITY CONTEXT REFERENCE"
          : "BROAD CONTEXT REFERENCE";
    const label =
      `INPUT IMAGE ${inputIndex}: VENUE ${fidelity} ${index + 1}${coverage ? ` (${coverage})` : ""}. ` +
      "Use this to preserve the real venue's architecture, layout, materials, decor, windows, fixtures, scale, and lighting.";
    imageParts.push(
      { text: label },
      { inlineData: { mimeType: "image/jpeg", data: ref.buffer.toString("base64") } },
    );
    interactionInputs.push(
      { type: "text", text: label },
      { type: "image", mime_type: "image/jpeg", data: ref.buffer.toString("base64") },
    );
  });

  return {
    fullPrompt,
    imageParts,
    interactionInputs,
    coupleRefCount: coupleRefs.length,
    venueRefCount: venueRefs.length,
  };
}

function expectedRatio(ratio: StillAspectRatio): number {
  switch (ratio) {
    case "16:9":
      return 16 / 9;
    case "9:16":
      return 9 / 16;
    case "3:4":
      return 3 / 4;
    case "4:3":
      return 4 / 3;
    case "1:1":
    default:
      return 1;
  }
}

export function configuredImageModels(): string[] {
  const explicit = process.env.GEMINI_IMAGE_MODELS;
  if (explicit) {
    return explicit
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
  }

  const primary =
    process.env.GEMINI_IMAGE_MODEL ??
    process.env.NANO_BANANA_MODEL ??
    DEFAULT_IMAGE_MODELS[0]!;
  const fallbacks = (process.env.GEMINI_IMAGE_FALLBACK_MODELS ?? DEFAULT_IMAGE_MODELS.slice(1).join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

function imageSizeForModel(model: string): string | undefined {
  if (process.env.GEMINI_IMAGE_SIZE) return process.env.GEMINI_IMAGE_SIZE;
  return model.includes("2.5") ? undefined : "2K";
}

function isModelAvailabilityFailure(status: number, body: string): boolean {
  if (status === 404 || status === 429 || status >= 500) return true;
  if (status === 400) {
    return /model|not found|not supported|unavailable|invalid model/i.test(body);
  }
  return false;
}

function pixelStats(pixels: Buffer): { mean: number; stdev: number } {
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

async function validateGeneratedStill(buffer: Buffer, aspectRatio: StillAspectRatio): Promise<void> {
  if (buffer.length < 40_000) {
    throw new Error(`Generated still is unusably small (${buffer.length} bytes).`);
  }

  const image = sharp(buffer, { limitInputPixels: 64_000_000 }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new Error("Generated still is not a readable image.");
  }

  if (width < GENERATED_MIN_EDGE_PX || height < GENERATED_MIN_EDGE_PX) {
    throw new Error(
      `Generated still is too low resolution (${width}x${height}); minimum edge is ${GENERATED_MIN_EDGE_PX}px.`,
    );
  }

  const relativeDelta = Math.abs(width / height - expectedRatio(aspectRatio)) / expectedRatio(aspectRatio);
  if (relativeDelta > 0.18) {
    throw new Error(
      `Generated still aspect ratio is wrong (${width}x${height}); expected ${aspectRatio}.`,
    );
  }

  const { data: pixels, info } = await image
    .clone()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .resize(256, 256, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { mean: brightness, stdev: contrast } = pixelStats(pixels);
  const sharpness = laplacianVariance(pixels, info.width, info.height);

  if (brightness < GENERATED_MIN_BRIGHTNESS) {
    throw new Error(`Generated still is too dark for production use (brightness ${brightness.toFixed(1)}).`);
  }
  if (brightness > GENERATED_MAX_BRIGHTNESS) {
    throw new Error(`Generated still is too washed out for production use (brightness ${brightness.toFixed(1)}).`);
  }
  if (contrast < GENERATED_MIN_CONTRAST) {
    throw new Error(`Generated still has too little contrast for production use (${contrast.toFixed(1)}).`);
  }
  if (sharpness < GENERATED_MIN_SHARPNESS) {
    throw new Error(`Generated still appears blurry or low-detail (sharpness ${sharpness.toFixed(1)}).`);
  }
}

/**
 * Generate one gallery still using the configured Gemini native image model.
 * Couple references are sent first to prioritize identity preservation, followed
 * by ranked venue references that anchor the scene to the real venue.
 */
export async function generateCinematicStillWithMetadata(params: {
  prompt: string;
  coupleReference: { buffer: Buffer; mimeType: string };
  coupleReferences?: { buffer: Buffer; mimeType: string }[];
  venueReference: { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };
  venueReferences?: { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null }[];
  aspectRatio: StillAspectRatio;
}): Promise<GeneratedStillResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_AI_API_KEY (or GEMINI_API_KEY) is required for Gemini image generation.",
    );
  }

  const { prompt, coupleReference, venueReference, aspectRatio } = params;
  const coupleRefs =
    params.coupleReferences?.filter((r) => r.buffer?.length).slice(0, MAX_COUPLE_REFERENCES) ?? [];
  if (coupleRefs.length === 0 && coupleReference.buffer?.length) {
    coupleRefs.push(coupleReference);
  }
  if (coupleRefs.length === 0) {
    throw new Error("Couple reference photo is empty - cannot generate a likeness-focused gallery.");
  }
  if (!venueReference.buffer?.length) {
    throw new Error("Venue reference photo is empty - cannot generate a venue-anchored gallery.");
  }

  const venueRefs =
    params.venueReferences
      ?.filter((r) => r.buffer?.length)
      .slice(0, Math.max(1, MAX_TOTAL_REFERENCE_IMAGES - coupleRefs.length)) ?? [];
  if (venueRefs.length === 0 && venueReference.buffer?.length) {
    venueRefs.push(venueReference);
  }
  if (venueRefs.length === 0) {
    throw new Error("Venue reference photo is empty - cannot generate a venue-anchored gallery.");
  }

  const preparedCoupleRefs = await Promise.all(
    coupleRefs.map((r) => prepareReferenceImage(r)),
  );
  const preparedVenueRefs = await Promise.all(
    venueRefs.map(async (r) => ({
      prepared: await prepareReferenceImage(r),
      coverage: normalizedVenueCoverage(r.coverage),
    })),
  );
  const normalizedCoupleRefs = preparedCoupleRefs.map((reference) => reference.buffer);
  const normalizedVenueRefs = preparedVenueRefs.map((reference) => ({
    buffer: reference.prepared.buffer,
    coverage: reference.coverage,
  }));

  logger.info(
    {
      targetMinEdgePx: REFERENCE_TARGET_MIN_EDGE_PX,
      coupleUpscaled: preparedCoupleRefs.filter((reference) => reference.upscaled).length,
      venueUpscaled: preparedVenueRefs.filter((reference) => reference.prepared.upscaled).length,
      coupleDimensions: preparedCoupleRefs.map(
        (reference) =>
          `${reference.sourceWidth}x${reference.sourceHeight}->${reference.width}x${reference.height}`,
      ),
      venueDimensions: preparedVenueRefs.map(
        ({ prepared }) =>
          `${prepared.sourceWidth}x${prepared.sourceHeight}->${prepared.width}x${prepared.height}`,
      ),
    },
    "Prepared and upscaled reference images for generation",
  );

  const aspectInstruction = aspectRatioInstruction(aspectRatio);

  const models = configuredImageModels();
  let lastError: unknown = null;

  for (const model of models) {
    const imageSize = imageSizeForModel(model);
    const referencePayload = buildReferencePayload({
      model,
      prompt,
      aspectInstruction,
      normalizedCoupleRefs,
      normalizedVenueRefs,
    });
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: referencePayload.fullPrompt }, ...referencePayload.imageParts],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio,
          ...(imageSize ? { imageSize } : {}),
        },
        temperature: 0.25,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      ],
    };

    logger.info(
      {
        model,
        imageSize: imageSize ?? "model-default",
        promptSnippet: prompt.slice(0, 160),
        aspectRatio,
        coupleRefCount: referencePayload.coupleRefCount,
        venueRefCount: referencePayload.venueRefCount,
        referenceLimitProfile: referenceLimitsForModel(model),
        coupleBytes: normalizedCoupleRefs[0]?.length ?? 0,
        venueBytes: normalizedVenueRefs[0]?.buffer.length ?? 0,
      },
      "Submitting Gemini native image multi-reference fusion",
    );

    if (useInteractionsApiForImageGeneration(model)) {
      const body = {
        model,
        input: referencePayload.interactionInputs,
        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: aspectRatio,
          ...(imageSize ? { image_size: imageSize } : {}),
        },
      };

      const url = `${geminiApiBase()}/interactions`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
          "Api-Revision": GEMINI_INTERACTIONS_API_REVISION,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        const error = new Error(
          `Gemini image model ${model} interactions request failed (${res.status}): ${text.slice(0, 800)}`,
        );
        lastError = error;
        if (models.length > 1 && isModelAvailabilityFailure(res.status, text)) {
          logger.warn({ err: error, model, status: res.status }, "Gemini image model unavailable; trying fallback");
          continue;
        }
        throw error;
      }

      let json: GeminiInteractionResponse;
      try {
        json = JSON.parse(text) as GeminiInteractionResponse;
      } catch {
        throw new Error(`Gemini image model ${model} returned non-JSON body: ${text.slice(0, 400)}`);
      }
      if (json.error) {
        throw new Error(`Gemini image model ${model} error: ${json.error.message ?? JSON.stringify(json.error)}`);
      }

      const imageBuffer = extractInteractionImageBytes(json);
      if (!imageBuffer) {
        throw new Error(`Gemini image model ${model} returned no interaction output_image data.`);
      }
      await validateGeneratedStill(imageBuffer, aspectRatio);

      logger.info(
        {
          model,
          sizeBytes: imageBuffer.length,
          api: "interactions",
        },
        "Gemini image model rendered validated scene still",
      );
      return { buffer: imageBuffer, model };
    }

    const url = `${geminiApiBase()}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      const error = new Error(`Gemini image model ${model} request failed (${res.status}): ${text.slice(0, 800)}`);
      lastError = error;
      if (models.length > 1 && isModelAvailabilityFailure(res.status, text)) {
        logger.warn({ err: error, model, status: res.status }, "Gemini image model unavailable; trying fallback");
        continue;
      }
      throw error;
    }

    let json: GeminiResponse;
    try {
      json = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new Error(`Gemini image model ${model} returned non-JSON body: ${text.slice(0, 400)}`);
    }

    if (json.error) {
      throw new Error(`Gemini image model ${model} error: ${json.error.message ?? JSON.stringify(json.error)}`);
    }

    if (json.promptFeedback?.blockReason) {
      throw new StillImageBlockedError(
        `Gemini image model blocked the prompt (${json.promptFeedback.blockReason}). Try different photos.`,
      );
    }

    const finish = json.candidates?.[0]?.finishReason;
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      const blockedRatings = json.candidates?.[0]?.safetyRatings?.filter((r) => r.blocked) ?? [];
      if (blockedRatings.length > 0) {
        throw new StillImageBlockedError(
          `Gemini image model blocked the output for safety (${blockedRatings.map((r) => r.category).join(", ")}).`,
        );
      }
    }

    const imageBuffer = extractImageBytes(json);
    if (!imageBuffer) {
      const note = findTextNote(json);
      throw new Error(
        `Gemini image model ${model} returned no image data. finishReason=${finish ?? "unknown"} ${note ? `note=${note}` : ""}`,
      );
    }
    await validateGeneratedStill(imageBuffer, aspectRatio);

    logger.info(
      {
        model,
        sizeBytes: imageBuffer.length,
      },
      "Gemini image model rendered validated scene still",
    );
    return { buffer: imageBuffer, model };
  }

  throw lastError instanceof Error ? lastError : new Error("Gemini image model request failed.");
}

function aspectRatioInstruction(ratio: StillAspectRatio): string {
  switch (ratio) {
    case "16:9":
      return "wide landscape (16:9)";
    case "9:16":
      return "tall portrait (9:16)";
    case "3:4":
      return "portrait (3:4)";
    case "4:3":
      return "landscape (4:3)";
    case "1:1":
    default:
      return "square (1:1)";
  }
}

export function userMessageForStillError(err: unknown): string {
  if (err instanceof StillImageBlockedError) {
    return "A reference photo was flagged by content safety. Upload different photos of the real couple (no celebrities, public figures, or restricted likenesses).";
  }

  if (err instanceof GalleryQualityError) {
    const r = err.report;
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    const partnerMin = Math.min(r.partnerOneLikenessScore, r.partnerTwoLikenessScore);
    const notes = [
      `face match ${pct(partnerMin)}`,
      `venue match ${pct(r.venueScore)}`,
      `realism ${pct(r.compositionScore)}`,
    ];
    if (!r.facesVisible) notes.push("faces were not clearly visible");
    if (!r.exactlyTwoPartners || !r.partnerIdentitySeparation) {
      notes.push("both partners' identities could not be kept distinct");
    }
    if (r.extraPeople) notes.push("extra people appeared");
    if (r.textArtifacts) notes.push("text artifacts appeared");
    return (
      `We couldn't render an accurate enough gallery from these photos, even after several attempts ` +
      `(closest attempt: ${notes.join(", ")}). Clear, sharp, well-lit photos of both faces give the ` +
      `best results - swap in stronger couple photos and try again. Your venue credit was refunded.`
    );
  }

  const e = err as {
    message?: string;
    status?: number;
    body?: { detail?: string };
  };
  const detail =
    (typeof e?.body?.detail === "string" ? e.body.detail : "") +
    " " +
    (e?.message ?? "");

  if (
    (err as { name?: string })?.name === "GalleryQualityError" ||
    /failed quality gate|likeness|venueScore|compositionScore/i.test(detail)
  ) {
    return "We couldn't render an accurate enough gallery from these photos, even after several attempts. Photos with both faces clearly visible, sharp, and well lit give the best results - swap in stronger couple photos and try again. Your venue credit was refunded.";
  }

  if (
    e?.status === 402 ||
    /exhausted balance|user is locked|top up your balance|insufficient[_ ]?quota|insufficient[_ ]?credit|RESOURCE_EXHAUSTED/i.test(
      detail,
    )
  ) {
    return "The Google AI account that powers the AI is out of credit. An admin needs to top up the Gemini API quota before new galleries can render. Your venue credit was refunded.";
  }

  if (err instanceof Error) {
    if (err.message.includes("GOOGLE_AI_API_KEY") || err.message.includes("GEMINI_API_KEY")) {
      return "Image generation is not configured on this server (missing Gemini API key). Your venue credit was refunded.";
    }
    if (e?.status === 403 || /forbidden|PERMISSION_DENIED/i.test(err.message)) {
      return "The Gemini API rejected the request (Forbidden). API key is invalid, blocked, or out of credit. Your venue credit was refunded.";
    }
    return (detail.trim() || err.message).slice(0, 320);
  }
  return "Still image generation failed. Please try again. Your venue credit was refunded.";
}
