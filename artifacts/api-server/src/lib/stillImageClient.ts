import sharp from "sharp";
import type { ReferenceAspectRatio } from "./referenceImage.js";
import { logger } from "./logger.js";
import {
  VENUE_MEDIA_COVERAGE_LABELS,
  isVenueMediaCoverage,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";
import { GalleryJudgeUnavailableError, GalleryQualityError } from "./galleryQuality.js";
import {
  prepareReferenceImage,
  REFERENCE_TARGET_MIN_EDGE_PX,
  type PreparedReferenceImage,
} from "./referenceImagePreparation.js";
import { ReferenceImageError } from "./referenceImageQuality.js";
import {
  GalleryStorageError,
  SessionDeadlineError,
  StillImageBlockedError,
  StillImageRequestError,
  isAbortOrTimeoutError,
  isModelAvailabilityFailure,
  tagErrorWithModel,
} from "./stillImageErrors.js";
import {
  generateStillWithOpenAi,
  isOpenAiImageModel,
  openaiApiKey,
  openaiImageQuality,
  openaiImageSize,
  OPENAI_MAX_REFERENCE_IMAGES,
  type OpenAiReferenceImage,
} from "./openaiImageClient.js";

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_IMAGE_TIMEOUT_MS = 180_000;
/**
 * Production model chain. gpt-image-2.5-sunburst is the primary renderer: it is
 * OpenAI's precision image model, tuned for edits that preserve the subjects
 * and structures of the reference images, which is exactly what a gallery still
 * needs (both partners' faces plus the real venue architecture).
 * gpt-image-2.5-flare is the faster sibling and takes over when Sunburst is
 * unavailable; the Gemini native image models remain as a last-resort fallback.
 */
const DEFAULT_IMAGE_MODELS = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gemini-3-pro-image",
];
const MAX_TOTAL_REFERENCE_IMAGES = 14;
const MAX_COUPLE_REFERENCES = 3;
const GENERATED_MIN_EDGE_PX = Number(process.env.GENERATED_IMAGE_MIN_EDGE_PX ?? "1024");
const GENERATED_MIN_CONTRAST = Number(process.env.GENERATED_IMAGE_MIN_CONTRAST ?? "8");
const GENERATED_MIN_SHARPNESS = Number(process.env.GENERATED_IMAGE_MIN_SHARPNESS ?? "6");
const GENERATED_MIN_BRIGHTNESS = Number(process.env.GENERATED_IMAGE_MIN_BRIGHTNESS ?? "18");
const GENERATED_MAX_BRIGHTNESS = Number(process.env.GENERATED_IMAGE_MAX_BRIGHTNESS ?? "246");

type ImagePart = { text?: string; inlineData?: { mimeType: string; data: string } };
type VenueReferenceInput = {
  buffer: Buffer;
  coverage?: VenueMediaCoverage | null;
};

function geminiApiBase(): string {
  return (process.env.GEMINI_API_BASE_URL ?? DEFAULT_GEMINI_API_BASE).replace(/\/$/, "");
}

function geminiImageTimeoutMs(): number {
  const parsed = Number(process.env.GEMINI_IMAGE_TIMEOUT_MS ?? DEFAULT_GEMINI_IMAGE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GEMINI_IMAGE_TIMEOUT_MS;
}

function geminiApiKey(): string | undefined {
  const key = (process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY)?.trim();
  return key ? key : undefined;
}

type StillAspectRatio = ReferenceAspectRatio;

/** One rendered still plus what it cost to make (render telemetry stores these). */
export interface GeneratedStillResult {
  buffer: Buffer;
  /** The model that produced the frame. */
  model: string;
  /** First model of the configured chain. */
  primaryModel: string;
  /** True when an earlier model in the chain was skipped or unavailable. */
  fallbackUsed: boolean;
  /** Models skipped before `model` rendered, with the reason. */
  fallbackFrom: { model: string; reason: string }[];
  size: string | null;
  quality: string | null;
  usage: { inputTokens?: number; outputTokens?: number } | null;
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
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
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

function referenceLimitsForModel(model: string): { couple: number; venue: number } {
  if (isOpenAiImageModel(model)) {
    // The edits endpoint accepts up to 16 reference images; stay inside both
    // that ceiling and the pipeline's own MAX_TOTAL_REFERENCE_IMAGES budget.
    const venue = Math.min(
      OPENAI_MAX_REFERENCE_IMAGES - MAX_COUPLE_REFERENCES,
      MAX_TOTAL_REFERENCE_IMAGES - MAX_COUPLE_REFERENCES,
    );
    return { couple: MAX_COUPLE_REFERENCES, venue };
  }
  if (model === "gemini-3-pro-image") {
    return { couple: 3, venue: 6 };
  }
  if (model === "gemini-3.1-flash-image") {
    return { couple: 3, venue: 10 };
  }
  return { couple: MAX_COUPLE_REFERENCES, venue: MAX_TOTAL_REFERENCE_IMAGES - MAX_COUPLE_REFERENCES };
}

function normalizedVenueCoverage(value: unknown): VenueMediaCoverage | null {
  return isVenueMediaCoverage(value) ? value : null;
}

function venueCoverageLabel(coverage?: VenueMediaCoverage | null): string | null {
  return coverage ? VENUE_MEDIA_COVERAGE_LABELS[coverage] : null;
}

interface ReferenceManifest {
  /** Prompt with the identity, venue and compositing manifest (Gemini text part). */
  fullPrompt: string;
  /** Same prompt with the ordered INPUT IMAGE labels folded in (OpenAI has no per-image text slot). */
  openAiPrompt: string;
  coupleRefs: Buffer[];
  venueRefs: VenueReferenceInput[];
  labels: string[];
}

function buildReferenceManifest(params: {
  model: string;
  prompt: string;
  aspectInstruction: string;
  normalizedCoupleRefs: Buffer[];
  normalizedVenueRefs: VenueReferenceInput[];
}): ReferenceManifest {
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
  const promptBody =
    `${params.prompt}\n\n` +
    `COUPLE IDENTITY MANIFEST (${coupleImageLabels}): Treat these inputs as multiple identity observations of the same two real adult partners. First infer two stable identities, Partner A and Partner B, from all reference images together. Preserve each partner's exact facial geometry, eyes, eyebrows, nose, mouth, jaw, ears, skin tone, hair color, hairline, glasses, freckles, moles, age, build, and natural expression cues. Both partners must remain individually recognizable, not averaged into generic wedding faces.\n` +
    `COUPLE REFERENCE ROLES: ${coupleRoleSummary}\n` +
    `IDENTITY HARD CONSTRAINT: The output may change clothing, pose, and lighting for the wedding scene, but it may not substitute, beautify, slim, de-age, gender-swap, face-swap, merge, hide, or stylize either partner. If references disagree, use the clearest frontal face for identity and the remaining references only to confirm secondary traits.\n` +
    `VENUE SCENE MANIFEST (${venueImageLabels}): The wedding happens at this exact venue. INPUT IMAGE ${venueImageIndex} is the mandatory scene anchor: preserve its real architecture, layout, materials, decor, windows, fixtures, scale, color temperature, and light direction. Remaining venue images are factual context for the same venue and must support the scene without inventing a generic ballroom, chapel, hotel, garden, or studio.\n` +
    (venueCoverageSummary
      ? `VENUE COVERAGE ROLES: ${venueCoverageSummary}. Use these roles to choose the correct real venue feature for this scene while preserving the exact architecture from the matching uploaded reference.\n`
      : "") +
    `COMPOSITING HARD CONSTRAINT: integrate the exact couple naturally into the exact venue photograph with realistic scale, perspective, contact shadows, lens depth, matching light direction, and believable camera optics. Keep both faces crisp, unobstructed, front-readable, and fully visible. Do not crop through faces. Do not add extra people.\n`;
  const outputLine = `Output: one photorealistic ${params.aspectInstruction} cinematic wedding photograph with both people from the couple references together inside the venue. Instant recognition required. No text, captions, watermarks, or logos.`;

  const labels: string[] = [];
  coupleRefs.forEach((_, index) => {
    const role =
      index === 0
        ? "TOGETHER REFERENCE - use to establish both partners as a pair, their relative scale, and any shared identity context"
        : index === 1
          ? "PARTNER A FACE REFERENCE - use as the clearest identity observation for Partner A when it matches the uploaded content"
          : "PARTNER B FACE REFERENCE - use as the clearest identity observation for Partner B when it matches the uploaded content";
    labels.push(
      `INPUT IMAGE ${index + 1}: COUPLE IDENTITY REFERENCE ${index + 1} (${role}). ` +
        "Use this only to preserve Partner A and Partner B likenesses. Extract identity traits; ignore clothing/background unless useful for identity. If the stated role does not match the photo content, infer the correct identity mapping from all couple references together.",
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
    labels.push(
      `INPUT IMAGE ${inputIndex}: VENUE ${fidelity} ${index + 1}${coverage ? ` (${coverage})` : ""}. ` +
        "Use this to preserve the real venue's architecture, layout, materials, decor, windows, fixtures, scale, and lighting.",
    );
  });

  return {
    fullPrompt: `${promptBody}${outputLine}`,
    openAiPrompt:
      `${promptBody}` +
      `INPUT IMAGE ORDER MANIFEST: the attached reference images are supplied in exactly this order.\n` +
      `${labels.join("\n")}\n` +
      `${outputLine}`,
    coupleRefs,
    venueRefs,
    labels,
  };
}

/** OpenAI transport payload: files uploaded in exactly the manifest order. */
function openAiReferences(manifest: ReferenceManifest): OpenAiReferenceImage[] {
  const coupleCount = manifest.coupleRefs.length;
  return [
    ...manifest.coupleRefs.map((buffer, index) => ({
      buffer,
      filename: `input-${index + 1}-couple.jpg`,
    })),
    ...manifest.venueRefs.map((ref, index) => ({
      buffer: ref.buffer,
      filename: `input-${coupleCount + index + 1}-venue.jpg`,
    })),
  ];
}

/** Gemini transport payload: a text label before each inline image. */
function geminiImageParts(manifest: ReferenceManifest): ImagePart[] {
  const buffers = [...manifest.coupleRefs, ...manifest.venueRefs.map((ref) => ref.buffer)];
  return buffers.flatMap((buffer, index) => [
    { text: manifest.labels[index]! },
    { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } },
  ]);
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

type EnvLike = Record<string, string | undefined>;

/**
 * Ordered image model chain. `IMAGE_MODEL*` are the provider-neutral names;
 * the legacy `GEMINI_IMAGE_*` names still work so existing deployments keep
 * booting without an env change. envValidation.ts mirrors this resolution.
 */
export function configuredImageModelsFromEnv(env: EnvLike): string[] {
  const explicit = env.IMAGE_MODELS ?? env.GEMINI_IMAGE_MODELS;
  if (explicit) {
    return explicit
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
  }

  const primary =
    env.IMAGE_MODEL ??
    env.GEMINI_IMAGE_MODEL ??
    env.NANO_BANANA_MODEL ??
    DEFAULT_IMAGE_MODELS[0]!;
  const fallbacks = (
    env.IMAGE_FALLBACK_MODELS ??
    env.GEMINI_IMAGE_FALLBACK_MODELS ??
    DEFAULT_IMAGE_MODELS.slice(1).join(",")
  )
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

export function configuredImageModels(): string[] {
  return configuredImageModelsFromEnv(process.env);
}

function imageSizeForModel(): string {
  return process.env.GEMINI_IMAGE_SIZE?.trim() || "2K";
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

/** Output a provider returned that cannot ship (wrong size, blank, blurry...). */
export class GeneratedStillRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratedStillRejectedError";
  }
}

async function validateGeneratedStill(buffer: Buffer, aspectRatio: StillAspectRatio): Promise<void> {
  if (buffer.length < 40_000) {
    throw new GeneratedStillRejectedError(`Generated still is unusably small (${buffer.length} bytes).`);
  }

  const image = sharp(buffer, { limitInputPixels: 64_000_000 }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    throw new GeneratedStillRejectedError("Generated still is not a readable image.");
  }

  if (width < GENERATED_MIN_EDGE_PX || height < GENERATED_MIN_EDGE_PX) {
    throw new GeneratedStillRejectedError(
      `Generated still is too low resolution (${width}x${height}); minimum edge is ${GENERATED_MIN_EDGE_PX}px.`,
    );
  }

  const relativeDelta = Math.abs(width / height - expectedRatio(aspectRatio)) / expectedRatio(aspectRatio);
  if (relativeDelta > 0.18) {
    throw new GeneratedStillRejectedError(
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
    throw new GeneratedStillRejectedError(`Generated still is too dark for production use (brightness ${brightness.toFixed(1)}).`);
  }
  if (brightness > GENERATED_MAX_BRIGHTNESS) {
    throw new GeneratedStillRejectedError(`Generated still is too washed out for production use (brightness ${brightness.toFixed(1)}).`);
  }
  if (contrast < GENERATED_MIN_CONTRAST) {
    throw new GeneratedStillRejectedError(`Generated still has too little contrast for production use (${contrast.toFixed(1)}).`);
  }
  if (sharpness < GENERATED_MIN_SHARPNESS) {
    throw new GeneratedStillRejectedError(`Generated still appears blurry or low-detail (sharpness ${sharpness.toFixed(1)}).`);
  }
}

/*
 * Reference preparation (EXIF rotate, Lanczos resize, contrast stretch,
 * re-encode) is deterministic, so it runs once per source buffer and is
 * reused by every scene and attempt of a session. Keyed weakly on the buffer
 * object: the cache disappears with the session's buffers.
 */
const preparedReferenceCache = new WeakMap<Buffer, Promise<PreparedReferenceImage>>();

export function prepareReferenceImageOnce(image: {
  buffer: Buffer;
  mimeType: string;
}): Promise<PreparedReferenceImage> {
  const cached = preparedReferenceCache.get(image.buffer);
  if (cached) return cached;
  const pending = prepareReferenceImage(image);
  preparedReferenceCache.set(image.buffer, pending);
  pending.catch(() => preparedReferenceCache.delete(image.buffer));
  return pending;
}

/*
 * Fallback audit counters: how many renders ran, and how many of them were
 * produced by a model other than the configured primary. Exposed so the
 * operator console / readiness can show silent degradation at a glance; the
 * per-attempt truth lives in render_attempts.fallback_used.
 */
const fallbackCounters = { renders: 0, fallbacks: 0, byModel: new Map<string, number>() };

export function imageModelFallbackStats(): {
  renders: number;
  fallbacks: number;
  byModel: Record<string, number>;
} {
  return {
    renders: fallbackCounters.renders,
    fallbacks: fallbackCounters.fallbacks,
    byModel: Object.fromEntries(fallbackCounters.byModel),
  };
}

function countRender(result: GeneratedStillResult): void {
  fallbackCounters.renders += 1;
  if (!result.fallbackUsed) return;
  fallbackCounters.fallbacks += 1;
  fallbackCounters.byModel.set(result.model, (fallbackCounters.byModel.get(result.model) ?? 0) + 1);
  logger.warn(
    {
      event: "image_model_fallback",
      primaryModel: result.primaryModel,
      model: result.model,
      skipped: result.fallbackFrom,
    },
    "Gallery still rendered by a fallback image model",
  );
}

async function renderWithGemini(params: {
  apiKey: string;
  model: string;
  manifest: ReferenceManifest;
  aspectRatio: StillAspectRatio;
  signal?: AbortSignal;
}): Promise<{ buffer: Buffer; size: string; usage: GeneratedStillResult["usage"] }> {
  const { apiKey, model, manifest, aspectRatio } = params;
  const imageSize = imageSizeForModel();
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: manifest.fullPrompt }, ...geminiImageParts(manifest)],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio, imageSize },
      temperature: 0.25,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  const timeout = AbortSignal.timeout(geminiImageTimeoutMs());
  const signal = params.signal ? AbortSignal.any([timeout, params.signal]) : timeout;
  let res: Response;
  let text: string;
  try {
    // The key travels in the x-goog-api-key header, never the query string,
    // so it cannot leak into proxy or error logs that record URLs.
    res = await fetch(`${geminiApiBase()}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal,
    });
    text = await res.text();
  } catch (err) {
    if (params.signal?.aborted) throw err;
    const timedOut = isAbortOrTimeoutError(err);
    throw new StillImageRequestError({
      message: timedOut
        ? `Gemini image model ${model} did not answer within ${geminiImageTimeoutMs()}ms`
        : `Gemini image model ${model} request failed before a response: ${err instanceof Error ? err.message : String(err)}`,
      status: 0,
      body: "",
      retryWithFallbackModel: true,
      timedOut,
      model,
    });
  }

  if (!res.ok) {
    throw new StillImageRequestError({
      message: `Gemini image model ${model} request failed (${res.status}): ${text.slice(0, 800)}`,
      status: res.status,
      body: text,
      retryWithFallbackModel: isModelAvailabilityFailure(res.status, text),
      model,
    });
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
      model,
    );
  }

  const finish = json.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
    const blockedRatings = json.candidates?.[0]?.safetyRatings?.filter((r) => r.blocked) ?? [];
    if (blockedRatings.length > 0 || /SAFETY|PROHIBITED|BLOCKLIST|IMAGE_SAFETY/i.test(finish)) {
      throw new StillImageBlockedError(
        `Gemini image model blocked the output for safety (${
          blockedRatings.map((r) => r.category).join(", ") || finish
        }).`,
        model,
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
  return {
    buffer: imageBuffer,
    size: imageSize,
    usage: {
      inputTokens: json.usageMetadata?.promptTokenCount,
      outputTokens: json.usageMetadata?.candidatesTokenCount,
    },
  };
}

/**
 * Generate one gallery still with the configured image model chain.
 *
 * The chain leads with OpenAI's gpt-image-2.5 models through the
 * `/v1/images/edits` endpoint and falls back to the Gemini native image models
 * only when a model is unavailable (explicit model-not-found codes, 404, 429,
 * 5xx, or no answer before its timeout). Couple references are sent first to
 * prioritize identity preservation, followed by ranked venue references that
 * anchor the scene to the real venue. `signal` aborts the in-flight request
 * when the session deadline passes; that abort is rethrown untouched.
 */
export async function generateCinematicStillWithMetadata(params: {
  prompt: string;
  coupleReference: { buffer: Buffer; mimeType: string };
  coupleReferences?: { buffer: Buffer; mimeType: string }[];
  venueReference: { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };
  venueReferences?: { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null }[];
  aspectRatio: StillAspectRatio;
  signal?: AbortSignal;
}): Promise<GeneratedStillResult> {
  const googleKey = geminiApiKey();
  const openAiKey = openaiApiKey();
  if (!openAiKey && !googleKey) {
    throw new Error(
      "OPENAI_API_KEY (for gpt-image models) or GOOGLE_AI_API_KEY (for Gemini image models) is required for image generation.",
    );
  }

  const { prompt, coupleReference, venueReference, aspectRatio, signal } = params;
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

  const preparedCoupleRefs = await Promise.all(coupleRefs.map((r) => prepareReferenceImageOnce(r)));
  const preparedVenueRefs = await Promise.all(
    venueRefs.map(async (r) => ({
      prepared: await prepareReferenceImageOnce(r),
      coverage: normalizedVenueCoverage(r.coverage),
    })),
  );
  const normalizedCoupleRefs = preparedCoupleRefs.map((reference) => reference.buffer);
  const normalizedVenueRefs = preparedVenueRefs.map((reference) => ({
    buffer: reference.prepared.buffer,
    coverage: reference.coverage,
  }));

  logger.debug(
    {
      targetMinEdgePx: REFERENCE_TARGET_MIN_EDGE_PX,
      coupleUpscaled: preparedCoupleRefs.filter((reference) => reference.upscaled).length,
      venueUpscaled: preparedVenueRefs.filter((reference) => reference.prepared.upscaled).length,
    },
    "Prepared reference images for generation",
  );

  const aspectInstruction = aspectRatioInstruction(aspectRatio);
  const models = configuredImageModels();
  const primaryModel = models[0] ?? DEFAULT_IMAGE_MODELS[0]!;
  const fallbackFrom: { model: string; reason: string }[] = [];
  let lastError: unknown = null;

  for (const [index, model] of models.entries()) {
    signal?.throwIfAborted();
    const hasNext = index < models.length - 1;
    const manifest = buildReferenceManifest({
      model,
      prompt,
      aspectInstruction,
      normalizedCoupleRefs,
      normalizedVenueRefs,
    });

    const apiKey = isOpenAiImageModel(model) ? openAiKey : googleKey;
    if (!apiKey) {
      const error = new Error(
        isOpenAiImageModel(model)
          ? `OPENAI_API_KEY is required for OpenAI image model ${model}.`
          : `GOOGLE_AI_API_KEY (or GEMINI_API_KEY) is required for Gemini image model ${model}.`,
      );
      lastError = tagErrorWithModel(error, model);
      if (hasNext) {
        logger.warn({ model }, "Skipping image model: its API key is not configured");
        fallbackFrom.push({ model, reason: "api_key_missing" });
        continue;
      }
      throw lastError;
    }

    try {
      let rendered: { buffer: Buffer; size: string | null; quality: string | null; usage: GeneratedStillResult["usage"] };
      if (isOpenAiImageModel(model)) {
        logger.info(
          {
            model,
            size: openaiImageSize(aspectRatio),
            quality: openaiImageQuality(),
            aspectRatio,
            coupleRefCount: manifest.coupleRefs.length,
            venueRefCount: manifest.venueRefs.length,
          },
          "Submitting OpenAI image multi-reference edit",
        );
        const result = await generateStillWithOpenAi({
          apiKey,
          model,
          prompt: manifest.openAiPrompt,
          aspectRatio,
          images: openAiReferences(manifest),
          signal,
        });
        rendered = { buffer: result.buffer, size: result.size, quality: result.quality, usage: result.usage ?? null };
      } else {
        logger.info(
          {
            model,
            aspectRatio,
            coupleRefCount: manifest.coupleRefs.length,
            venueRefCount: manifest.venueRefs.length,
          },
          "Submitting Gemini native image multi-reference fusion",
        );
        const result = await renderWithGemini({ apiKey, model, manifest, aspectRatio, signal });
        rendered = { buffer: result.buffer, size: result.size, quality: null, usage: result.usage };
      }

      await validateGeneratedStill(rendered.buffer, aspectRatio);
      const still: GeneratedStillResult = {
        buffer: rendered.buffer,
        model,
        primaryModel,
        fallbackUsed: model !== primaryModel,
        fallbackFrom: [...fallbackFrom],
        size: rendered.size,
        quality: rendered.quality,
        usage: rendered.usage,
      };
      countRender(still);
      logger.info(
        {
          model,
          sizeBytes: still.buffer.length,
          size: still.size,
          inputTokens: still.usage?.inputTokens,
          outputTokens: still.usage?.outputTokens,
          fallbackUsed: still.fallbackUsed,
        },
        "Image model rendered validated scene still",
      );
      return still;
    } catch (err) {
      tagErrorWithModel(err, model);
      if (signal?.aborted) throw err;
      lastError = err;
      if (err instanceof StillImageRequestError && err.retryWithFallbackModel && hasNext) {
        logger.warn(
          { err, model, status: err.status, timedOut: err.timedOut },
          "Image model unavailable; trying the next model in the chain",
        );
        fallbackFrom.push({
          model,
          reason: err.timedOut ? "timeout" : err.status === 0 ? "network" : `http_${err.status}`,
        });
        continue;
      }
      throw err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Image model request failed.");
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

/* ------------------------------------------------------------------------
 * Failure copy. couple_sessions.error_message is served on the public share
 * page, so it is always one of a few fixed sentences (or, for couple photo
 * problems, our own validation text). The raw provider/storage/ffmpeg detail
 * goes to couple_sessions.failure_detail, which only owners and operators see.
 * --------------------------------------------------------------------- */

export type GalleryFailureCategory =
  | "blocked"
  | "quality"
  | "couple_photos"
  | "venue_setup"
  | "timeout"
  | "provider_billing"
  | "provider_auth"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "configuration"
  | "storage"
  | "unknown";

export interface GalleryFailure {
  category: GalleryFailureCategory;
  /** Safe to show the couple on the share page. */
  coupleMessage: string;
  /** Owner/operator detail with the raw cause. Never shown to the couple. */
  detail: string;
}

const COUPLE_MESSAGES = {
  blocked:
    "Our image service couldn't use one of these photos. Please try again with different photos of the two of you.",
  quality:
    "We couldn't create a close enough likeness from these photos. Clear, sharp, well-lit photos where both faces are easy to see work best. Please try again with different photos.",
  couplePhotosFallback:
    "Some of your photos couldn't be used. Please try again with clear, well-lit photos that show both of your faces.",
  venueSetup:
    "This venue hasn't finished setting up its gallery photos yet, so we couldn't create your gallery. Please let the venue know.",
  timeout:
    "Your gallery took longer than expected, so we stopped it. Please try again in a few minutes.",
  temporary:
    "We couldn't finish your gallery because of a temporary problem on our side. Please try again in a few minutes.",
} as const;

const MAX_FAILURE_DETAIL_CHARS = 2000;

function rawDetail(err: unknown): string {
  if (err instanceof StillImageRequestError) {
    return `${err.message}${err.body && !err.message.includes(err.body.slice(0, 80)) ? ` body=${err.body.slice(0, 600)}` : ""}`;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function withDetail(category: GalleryFailureCategory, coupleMessage: string, err: unknown, hint?: string): GalleryFailure {
  const detail = `[${category}] ${hint ? `${hint} ` : ""}${rawDetail(err)}`.slice(0, MAX_FAILURE_DETAIL_CHARS);
  return { category, coupleMessage, detail };
}

/** Classify a pipeline failure into couple-safe copy plus owner-facing detail. */
export function describeGalleryFailure(err: unknown): GalleryFailure {
  if (err instanceof SessionDeadlineError) {
    return withDetail("timeout", COUPLE_MESSAGES.timeout, err);
  }
  if (err instanceof StillImageBlockedError) {
    return withDetail("blocked", COUPLE_MESSAGES.blocked, err, "The image provider refused the photos on safety grounds.");
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
    return withDetail("quality", COUPLE_MESSAGES.quality, err, `Closest attempt: ${notes.join(", ")}.`);
  }
  if (err instanceof ReferenceImageError) {
    return err.subject === "couple"
      ? withDetail("couple_photos", `${err.message} Please try again with different photos.`, err)
      : withDetail("venue_setup", COUPLE_MESSAGES.venueSetup, err, "Venue reference photos are missing or unusable.");
  }
  if (err instanceof GalleryStorageError) {
    return withDetail("storage", COUPLE_MESSAGES.temporary, err);
  }
  if (err instanceof GalleryJudgeUnavailableError) {
    return withDetail("provider_unavailable", COUPLE_MESSAGES.temporary, err, "The quality judge was unavailable.");
  }

  const e = err as { status?: number; timedOut?: boolean } | null;
  const message = rawDetail(err);
  const provider = /openai|gpt-image/i.test(message) ? "OpenAI" : /gemini|google/i.test(message) ? "Google AI" : "image provider";

  if (e?.timedOut || isAbortOrTimeoutError(err) || /timed? ?out|did not answer within/i.test(message)) {
    return withDetail("timeout", COUPLE_MESSAGES.timeout, err);
  }
  if (/OPENAI_API_KEY|GOOGLE_AI_API_KEY|GEMINI_API_KEY|API key is required/i.test(message)) {
    return withDetail("configuration", COUPLE_MESSAGES.temporary, err, "Image generation is not configured on this server.");
  }
  // 429 first: a Gemini RESOURCE_EXHAUSTED rate limit is not an empty account.
  if (e?.status === 429 || /\(429\)|rate[_ ]?limit/i.test(message)) {
    const quota = /insufficient[_ ]?quota|billing|exhausted balance|top up/i.test(message);
    return quota
      ? withDetail("provider_billing", COUPLE_MESSAGES.temporary, err, `The ${provider} account is out of credit or quota; top it up.`)
      : withDetail("provider_rate_limit", COUPLE_MESSAGES.temporary, err, `The ${provider} API is rate limiting renders.`);
  }
  if (
    e?.status === 402 ||
    /exhausted balance|user is locked|top up your balance|insufficient[_ ]?quota|insufficient[_ ]?credit|billing[_ ]?hard[_ ]?limit/i.test(message) ||
    (/RESOURCE_EXHAUSTED/.test(message) && /quota|billing/i.test(message))
  ) {
    return withDetail("provider_billing", COUPLE_MESSAGES.temporary, err, `The ${provider} account is out of credit; an admin needs to top it up.`);
  }
  if (e?.status === 401 || e?.status === 403 || /invalid[_ ]?api[_ ]?key|\(401\)|\(403\)|PERMISSION_DENIED/i.test(message)) {
    return withDetail("provider_auth", COUPLE_MESSAGES.temporary, err, `The ${provider} API rejected the credentials; fix the API key.`);
  }
  if (err instanceof StillImageRequestError) {
    return withDetail("provider_unavailable", COUPLE_MESSAGES.temporary, err);
  }
  return withDetail("unknown", COUPLE_MESSAGES.temporary, err);
}

/** Couple-safe sentence for a pipeline failure (never raw provider text). */
export function userMessageForStillError(err: unknown): string {
  return describeGalleryFailure(err).coupleMessage;
}
