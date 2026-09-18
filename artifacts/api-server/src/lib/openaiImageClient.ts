import sharp from "sharp";
import type { ReferenceAspectRatio } from "./referenceImage.js";
import { logger } from "./logger.js";
import { StillImageBlockedError, StillImageRequestError } from "./stillImageErrors.js";

/**
 * OpenAI Image API transport for gallery stills.
 *
 * gpt-image-2.5 (released 2026-09-08) ships as two API models:
 *   - gpt-image-2.5-sunburst: the precision model, tuned for edits that must
 *     preserve the subjects and structures in the reference images.
 *   - gpt-image-2.5-flare:    the fast model for high-volume generation.
 *
 * Every gallery still is a multi-reference composite (couple identity photos +
 * venue photos), so this client always calls the edits endpoint
 * (`POST /v1/images/edits`, multipart/form-data with repeated `image[]` parts)
 * rather than `/v1/images/generations`. gpt-image models always return
 * base64 in `data[].b64_json`; `response_format` is rejected and must not be
 * sent.
 */

const DEFAULT_OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_QUALITY = "high";
const DEFAULT_INPUT_FIDELITY = "high";
const DEFAULT_OUTPUT_FORMAT = "jpeg";
const DEFAULT_OUTPUT_COMPRESSION = 95;
const DEFAULT_TIMEOUT_MS = 180_000;

/** Mirrors GENERATED_IMAGE_MIN_EDGE_PX in stillImageClient's output validation. */
function generatedMinEdgePx(): number {
  const parsed = Number(process.env.GENERATED_IMAGE_MIN_EDGE_PX ?? "1024");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1024;
}

/** Hard ceiling of the edits endpoint for gpt-image models. */
export const OPENAI_MAX_REFERENCE_IMAGES = 16;

const SUPPORTED_QUALITIES = new Set(["low", "medium", "high", "xhigh", "max", "auto"]);
const SUPPORTED_OUTPUT_FORMATS = new Set(["png", "jpeg", "webp"]);

/**
 * Preferred render sizes. Every edge is a multiple of 16, no edge exceeds
 * 3840px, the long:short ratio stays under 3:1, and the total pixel count sits
 * inside the 655,360 - 8,294,400 window the API accepts for custom sizes.
 */
const PREFERRED_SIZES: Record<ReferenceAspectRatio, string> = {
  "1:1": "1536x1536",
  "4:3": "1792x1344",
  "3:4": "1344x1792",
  "16:9": "2048x1152",
  "9:16": "1152x2048",
};

/**
 * The three sizes every gpt-image model accepts. Used as the retry size when a
 * custom WIDTHxHEIGHT request is rejected; the returned frame is then cropped
 * back to the requested aspect ratio.
 */
const STANDARD_SIZES: Record<ReferenceAspectRatio, string> = {
  "1:1": "1024x1024",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
};

interface OpenAiImageResponse {
  data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string; param?: string };
}

export interface OpenAiReferenceImage {
  buffer: Buffer;
  filename: string;
}

export interface OpenAiStillResult {
  buffer: Buffer;
  size: string;
  quality: string;
  cropped: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** True for any OpenAI image model id (gpt-image-2.5-*, gpt-image-2, ...). */
export function isOpenAiImageModel(model: string): boolean {
  return /^gpt-image-/i.test(model.trim());
}

export function openaiApiBase(): string {
  return (process.env.OPENAI_API_BASE_URL ?? DEFAULT_OPENAI_API_BASE).replace(/\/$/, "");
}

export function openaiApiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key ? key : undefined;
}

function requestTimeoutMs(): number {
  const parsed = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function openaiImageQuality(): string {
  const configured = process.env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();
  if (configured && SUPPORTED_QUALITIES.has(configured)) return configured;
  return DEFAULT_QUALITY;
}

function openaiInputFidelity(): string {
  const configured = process.env.OPENAI_IMAGE_INPUT_FIDELITY?.trim().toLowerCase();
  return configured === "low" ? "low" : DEFAULT_INPUT_FIDELITY;
}

function openaiOutputFormat(): string {
  const configured = process.env.OPENAI_IMAGE_OUTPUT_FORMAT?.trim().toLowerCase();
  if (configured && SUPPORTED_OUTPUT_FORMATS.has(configured)) return configured;
  return DEFAULT_OUTPUT_FORMAT;
}

function openaiOutputCompression(outputFormat: string): number | undefined {
  if (outputFormat === "png") return undefined;
  const parsed = Number(process.env.OPENAI_IMAGE_OUTPUT_COMPRESSION ?? DEFAULT_OUTPUT_COMPRESSION);
  if (!Number.isFinite(parsed)) return DEFAULT_OUTPUT_COMPRESSION;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

/** Preferred render size for a scene, overridable with OPENAI_IMAGE_SIZE. */
export function openaiImageSize(aspectRatio: ReferenceAspectRatio): string {
  const configured = process.env.OPENAI_IMAGE_SIZE?.trim();
  if (configured) return configured;
  return PREFERRED_SIZES[aspectRatio] ?? PREFERRED_SIZES["1:1"];
}

export function openaiStandardImageSize(aspectRatio: ReferenceAspectRatio): string {
  return STANDARD_SIZES[aspectRatio] ?? STANDARD_SIZES["1:1"];
}

function aspectRatioValue(ratio: ReferenceAspectRatio): number {
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

/**
 * Center-crop a frame whose aspect ratio drifted from the scene's target.
 * gpt-image honours custom sizes exactly, so this only bites when a request
 * fell back to one of the three standard sizes.
 */
async function conformAspectRatio(
  buffer: Buffer,
  aspectRatio: ReferenceAspectRatio,
): Promise<{ buffer: Buffer; cropped: boolean }> {
  const target = aspectRatioValue(aspectRatio);
  const image = sharp(buffer, { limitInputPixels: 64_000_000 }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return { buffer, cropped: false };

  const actual = width / height;
  if (Math.abs(actual - target) / target <= 0.02) return { buffer, cropped: false };

  const cropWidth = actual > target ? Math.round(height * target) : width;
  const cropHeight = actual > target ? height : Math.round(width / target);
  if (cropWidth < 1 || cropHeight < 1) return { buffer, cropped: false };

  const pipeline = image.extract({
    left: Math.max(0, Math.round((width - cropWidth) / 2)),
    top: Math.max(0, Math.round((height - cropHeight) / 2)),
    width: Math.min(width, cropWidth),
    height: Math.min(height, cropHeight),
  });

  // Cropping a standard-size render down to a wide or tall scene can push the
  // short edge under the delivery floor, so scale it back up afterwards.
  const minEdge = generatedMinEdgePx();
  const shortEdge = Math.min(cropWidth, cropHeight);
  let finalWidth = cropWidth;
  let finalHeight = cropHeight;
  if (shortEdge < minEdge) {
    const scale = minEdge / shortEdge;
    finalWidth = Math.round(cropWidth * scale);
    finalHeight = Math.round(cropHeight * scale);
    pipeline.resize(finalWidth, finalHeight, { kernel: "lanczos3", fit: "fill" });
  }

  const cropped = await pipeline.toBuffer();

  logger.info(
    {
      from: `${width}x${height}`,
      cropTo: `${cropWidth}x${cropHeight}`,
      to: `${finalWidth}x${finalHeight}`,
      aspectRatio,
    },
    "Cropped OpenAI still to the scene aspect ratio",
  );
  return { buffer: cropped, cropped: true };
}

function isModelAvailabilityFailure(status: number, body: string): boolean {
  if (status === 404 || status === 429 || status >= 500) return true;
  if (status === 400) {
    return /model|not found|not supported|unavailable|invalid model|unsupported_value/i.test(body);
  }
  return false;
}

function isSizeRejection(status: number, body: string): boolean {
  if (status !== 400) return false;
  return /\bsize\b|dimension|resolution|multiple of 16|aspect ratio/i.test(body);
}

function isContentBlock(status: number, body: string): boolean {
  if (status !== 400 && status !== 403) return false;
  return /moderation_blocked|content[_ ]policy|safety system|image_generation_user_error.*safety/i.test(
    body,
  );
}

function buildEditsForm(params: {
  model: string;
  prompt: string;
  size: string;
  images: OpenAiReferenceImage[];
}): FormData {
  const outputFormat = openaiOutputFormat();
  const compression = openaiOutputCompression(outputFormat);
  const form = new FormData();

  form.append("model", params.model);
  form.append("prompt", params.prompt);
  form.append("n", "1");
  form.append("size", params.size);
  form.append("quality", openaiImageQuality());
  form.append("input_fidelity", openaiInputFidelity());
  form.append("output_format", outputFormat);
  if (compression !== undefined) {
    form.append("output_compression", String(compression));
  }
  const moderation = process.env.OPENAI_IMAGE_MODERATION?.trim().toLowerCase();
  if (moderation === "low" || moderation === "auto") {
    form.append("moderation", moderation);
  }

  // Repeated `image[]` parts, in the order the prompt manifest describes them.
  // `response_format` is deliberately never sent: gpt-image models reject it
  // and always answer with base64.
  for (const image of params.images) {
    form.append(
      "image[]",
      new Blob([new Uint8Array(image.buffer)], { type: "image/jpeg" }),
      image.filename,
    );
  }

  return form;
}

async function postEdits(params: {
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  images: OpenAiReferenceImage[];
}): Promise<OpenAiImageResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
  };
  const organization = process.env.OPENAI_ORG_ID?.trim();
  if (organization) headers["OpenAI-Organization"] = organization;
  const project = process.env.OPENAI_PROJECT_ID?.trim();
  if (project) headers["OpenAI-Project"] = project;

  const res = await fetch(`${openaiApiBase()}/images/edits`, {
    method: "POST",
    headers,
    body: buildEditsForm(params),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });

  const text = await res.text();
  if (!res.ok) {
    if (isContentBlock(res.status, text)) {
      throw new StillImageBlockedError(
        `OpenAI image model ${params.model} blocked the request for safety. Try different photos.`,
      );
    }
    throw new StillImageRequestError({
      message: `OpenAI image model ${params.model} request failed (${res.status}): ${text.slice(0, 800)}`,
      status: res.status,
      body: text,
      retryWithFallbackModel: isModelAvailabilityFailure(res.status, text),
    });
  }

  let json: OpenAiImageResponse;
  try {
    json = JSON.parse(text) as OpenAiImageResponse;
  } catch {
    throw new Error(
      `OpenAI image model ${params.model} returned non-JSON body: ${text.slice(0, 400)}`,
    );
  }

  if (json.error) {
    throw new Error(
      `OpenAI image model ${params.model} error: ${json.error.message ?? JSON.stringify(json.error)}`,
    );
  }

  return json;
}

/**
 * Render one still with an OpenAI image model.
 *
 * `images` must already be JPEG-encoded and ordered exactly as the prompt's
 * INPUT IMAGE manifest describes them.
 */
export async function generateStillWithOpenAi(params: {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio: ReferenceAspectRatio;
  images: OpenAiReferenceImage[];
}): Promise<OpenAiStillResult> {
  if (params.images.length === 0) {
    throw new Error("OpenAI image generation requires at least one reference image.");
  }
  if (params.images.length > OPENAI_MAX_REFERENCE_IMAGES) {
    throw new Error(
      `OpenAI image edits accept at most ${OPENAI_MAX_REFERENCE_IMAGES} reference images; got ${params.images.length}.`,
    );
  }

  const preferredSize = openaiImageSize(params.aspectRatio);
  const standardSize = openaiStandardImageSize(params.aspectRatio);

  let size = preferredSize;
  let json: OpenAiImageResponse;
  try {
    json = await postEdits({ ...params, size });
  } catch (err) {
    const sizeRejected =
      err instanceof StillImageRequestError &&
      isSizeRejection(err.status, err.body) &&
      preferredSize !== standardSize;
    if (!sizeRejected) throw err;
    logger.warn(
      { model: params.model, rejectedSize: preferredSize, retrySize: standardSize },
      "OpenAI rejected the custom render size; retrying at a standard size",
    );
    size = standardSize;
    json = await postEdits({ ...params, size });
  }

  const b64 = json.data?.find((entry) => entry.b64_json)?.b64_json;
  if (!b64) {
    throw new Error(`OpenAI image model ${params.model} returned no b64_json image data.`);
  }

  const raw = Buffer.from(b64, "base64");
  const { buffer, cropped } = await conformAspectRatio(raw, params.aspectRatio);

  return {
    buffer,
    size,
    quality: openaiImageQuality(),
    cropped,
    usage: {
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    },
  };
}
