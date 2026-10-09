import sharp from "sharp";
import { z } from "zod";
import { logger } from "./logger.js";
import type { WeddingScene } from "./scenePlan.js";
import {
  VENUE_MEDIA_COVERAGE_LABELS,
  isVenueMediaCoverage,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";

type ImageRef = { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const QUALITY_MODEL = process.env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro";
const MIN_LIKENESS_SCORE = Number(process.env.GALLERY_MIN_LIKENESS_SCORE ?? "0.82");
const MIN_PARTNER_LIKENESS_SCORE = Number(process.env.GALLERY_MIN_PARTNER_LIKENESS_SCORE ?? "0.78");
const MIN_VENUE_SCORE = Number(process.env.GALLERY_MIN_VENUE_SCORE ?? "0.8");
const MIN_COMPOSITION_SCORE = Number(process.env.GALLERY_MIN_COMPOSITION_SCORE ?? "0.74");
// Acceptance floors: when no attempt reaches the strict targets above, the
// best-scoring attempt is still delivered if it clears these floors and every
// hard integrity check (two distinct real partners, faces visible, no extra
// people or text). Such frames are flagged "below target" on the owner's
// dashboard (generated_assets.quality_report + render_attempts) so imperfect
// input photos degrade the gallery gracefully instead of failing the session.
const FLOOR_LIKENESS_SCORE = Number(process.env.GALLERY_FLOOR_LIKENESS_SCORE ?? "0.7");
const FLOOR_PARTNER_LIKENESS_SCORE = Number(process.env.GALLERY_FLOOR_PARTNER_LIKENESS_SCORE ?? "0.66");
const FLOOR_VENUE_SCORE = Number(process.env.GALLERY_FLOOR_VENUE_SCORE ?? "0.68");
const FLOOR_COMPOSITION_SCORE = Number(process.env.GALLERY_FLOOR_COMPOSITION_SCORE ?? "0.6");
const MAX_TOTAL_JUDGE_IMAGES = 14;
const MAX_COUPLE_JUDGE_REFERENCES = 3;
const DEFAULT_JUDGE_TIMEOUT_MS = 90_000;
/** Judge calls per frame (first try + retries). Judge outages never trigger a new paid render. */
const JUDGE_ATTEMPTS = 3;
const DEFAULT_JUDGE_RETRY_DELAYS_MS = [1_500, 4_000];

function geminiApiBase(): string {
  return (process.env.GEMINI_API_BASE_URL ?? DEFAULT_GEMINI_API_BASE).replace(/\/$/, "");
}

function judgeTimeoutMs(): number {
  const parsed = Number(process.env.GALLERY_JUDGE_TIMEOUT_MS ?? DEFAULT_JUDGE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JUDGE_TIMEOUT_MS;
}

/** The quality gate runs unless GALLERY_QUALITY_GATE=off (local plumbing only). */
export function qualityGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GALLERY_QUALITY_GATE !== "off";
}

interface GeminiQualityResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  error?: { message?: string; code?: number; status?: string };
}

export interface GalleryQualityReport {
  likenessScore: number;
  partnerOneLikenessScore: number;
  partnerTwoLikenessScore: number;
  partnerIdentitySeparation: boolean;
  venueScore: number;
  compositionScore: number;
  exactlyTwoPartners: boolean;
  facesVisible: boolean;
  extraPeople: boolean;
  textArtifacts: boolean;
  pass: boolean;
  reasons: string[];
}

export class GalleryQualityError extends Error {
  constructor(
    message: string,
    public readonly report: GalleryQualityReport,
    public readonly generated: { buffer: Buffer; mimeType: string },
    public readonly generatedModel: string,
  ) {
    super(message);
    this.name = "GalleryQualityError";
  }
}

/**
 * The judge could not produce a verdict (outage, rate limit, malformed JSON,
 * missing key) even after retries. This says nothing about the frame, so it
 * must never be treated as a bad render.
 */
export class GalleryJudgeUnavailableError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GalleryJudgeUnavailableError";
  }
}

/**
 * Aggregate score used to rank below-target attempts so the best one can be
 * kept. The weakest partner likeness dominates: a gallery that loses one
 * partner's identity is worse than one that is slightly soft everywhere.
 */
export function frameQualityScore(report: GalleryQualityReport): number {
  const partnerMin = Math.min(
    report.partnerOneLikenessScore,
    report.partnerTwoLikenessScore,
  );
  return (
    partnerMin * 0.35 +
    report.likenessScore * 0.25 +
    report.venueScore * 0.25 +
    report.compositionScore * 0.15
  );
}

/**
 * Hard requirements for delivering a frame that missed the strict targets.
 * Integrity checks are never negotiable; scores may sit between the floor and
 * the target, in which case the frame ships flagged "below target".
 */
export function acceptanceFloorFailures(report: GalleryQualityReport): string[] {
  const failures: string[] = [];
  if (!report.partnerIdentitySeparation) {
    failures.push("generated partners do not map to two distinct real identities");
  }
  if (!report.exactlyTwoPartners) failures.push("output does not contain exactly two partners");
  if (!report.facesVisible) failures.push("faces are not clearly visible");
  if (report.extraPeople) failures.push("extra people detected");
  if (report.textArtifacts) failures.push("text/logo artifacts detected");
  if (report.likenessScore < FLOOR_LIKENESS_SCORE) {
    failures.push(`likeness ${report.likenessScore.toFixed(2)} < floor ${FLOOR_LIKENESS_SCORE}`);
  }
  if (report.partnerOneLikenessScore < FLOOR_PARTNER_LIKENESS_SCORE) {
    failures.push(
      `partner one likeness ${report.partnerOneLikenessScore.toFixed(2)} < floor ${FLOOR_PARTNER_LIKENESS_SCORE}`,
    );
  }
  if (report.partnerTwoLikenessScore < FLOOR_PARTNER_LIKENESS_SCORE) {
    failures.push(
      `partner two likeness ${report.partnerTwoLikenessScore.toFixed(2)} < floor ${FLOOR_PARTNER_LIKENESS_SCORE}`,
    );
  }
  if (report.venueScore < FLOOR_VENUE_SCORE) {
    failures.push(`venue ${report.venueScore.toFixed(2)} < floor ${FLOOR_VENUE_SCORE}`);
  }
  if (report.compositionScore < FLOOR_COMPOSITION_SCORE) {
    failures.push(`composition ${report.compositionScore.toFixed(2)} < floor ${FLOOR_COMPOSITION_SCORE}`);
  }
  return failures;
}

export function qualityRetryGuidanceForError(err: unknown): string | null {
  if (!(err instanceof GalleryQualityError)) return null;

  const r = err.report;
  const corrections: string[] = [];
  if (r.partnerOneLikenessScore < MIN_PARTNER_LIKENESS_SCORE) {
    corrections.push(
      `partner one likeness was weak (${r.partnerOneLikenessScore.toFixed(2)}); match that person's face shape, eyes, nose, mouth, jaw, hair, skin tone, age, and build more exactly`,
    );
  }
  if (r.partnerTwoLikenessScore < MIN_PARTNER_LIKENESS_SCORE) {
    corrections.push(
      `partner two likeness was weak (${r.partnerTwoLikenessScore.toFixed(2)}); match that person's face shape, eyes, nose, mouth, jaw, hair, skin tone, age, and build more exactly`,
    );
  }
  if (r.likenessScore < MIN_LIKENESS_SCORE) {
    corrections.push("preserve both real partners instead of using generic wedding faces");
  }
  if (!r.partnerIdentitySeparation) {
    corrections.push(
      "map the generated couple to two distinct real partners; do not duplicate one partner's face, merge identities, or let one accurate face compensate for the other",
    );
  }
  if (!r.exactlyTwoPartners) {
    corrections.push("show exactly the two partners from the references, no missing, merged, or additional people");
  }
  if (!r.facesVisible) {
    corrections.push("keep both faces fully visible, sharp, unobstructed, and not cropped");
  }
  if (r.venueScore < MIN_VENUE_SCORE) {
    corrections.push("preserve the exact venue architecture, materials, lighting, and layout from the uploaded venue references");
  }
  if (r.compositionScore < MIN_COMPOSITION_SCORE) {
    corrections.push("improve realistic scale, perspective, contact shadows, lighting direction, and lens depth");
  }
  if (r.extraPeople) corrections.push("remove all extra people");
  if (r.textArtifacts) corrections.push("remove text, logos, watermarks, and signage-like artifacts");
  corrections.push(...r.reasons.slice(0, 3));

  const unique = [...new Set(corrections.map((item) => item.trim()).filter(Boolean))];
  if (unique.length === 0) return null;

  return [
    "QUALITY RETRY CORRECTION: The previous generated image failed the production quality gate.",
    "Generate a fresh image for the same scene while fixing these issues:",
    unique.map((item) => `- ${item}`).join("\n"),
    "Do not compensate by hiding faces, changing the couple, changing the venue, adding people, adding text, or making the image less photorealistic.",
  ].join("\n");
}

/*
 * Judge-side normalization mirrors the generation-side reference cleanup
 * (contrast stretch + mild sharpen) so the judge compares the generated frame
 * against the same enhanced references the generator saw. References are
 * normalized once per buffer and reused for every scene and attempt.
 */
const judgeReferenceCache = new WeakMap<Buffer, Promise<Buffer>>();

function normalizeForJudgeUncached(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .normalize({ lower: 1, upper: 99 })
    .sharpen({ sigma: 0.8 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

function normalizeReferenceForJudge(image: ImageRef): Promise<Buffer> {
  const cached = judgeReferenceCache.get(image.buffer);
  if (cached) return cached;
  const pending = normalizeForJudgeUncached(image.buffer);
  judgeReferenceCache.set(image.buffer, pending);
  pending.catch(() => judgeReferenceCache.delete(image.buffer));
  return pending;
}

function venueCoverageLabel(coverage: unknown): string | null {
  return isVenueMediaCoverage(coverage) ? VENUE_MEDIA_COVERAGE_LABELS[coverage] : null;
}

const score = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
  z.number().finite().transform((n) => Math.max(0, Math.min(1, n))),
);

/**
 * The judge's verdict, validated. Every score and integrity flag is required:
 * a response that drops a field is a judge format error (retried), never a
 * silent `false` that fails a good frame.
 */
const judgeReportSchema = z.object({
  likenessScore: score,
  partnerOneLikenessScore: score,
  partnerTwoLikenessScore: score,
  partnerIdentitySeparation: z.boolean(),
  venueScore: score,
  compositionScore: score,
  exactlyTwoPartners: z.boolean(),
  facesVisible: z.boolean(),
  extraPeople: z.boolean(),
  textArtifacts: z.boolean(),
  pass: z.boolean(),
  reasons: z
    .array(z.unknown())
    .optional()
    .transform((items) =>
      (items ?? [])
        .filter((reason): reason is string => typeof reason === "string")
        .map((reason) => reason.slice(0, 180)),
    ),
});

/** Thrown for a judge answer that is not a complete, well-formed verdict. */
export class JudgeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeFormatError";
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new JudgeFormatError(`Quality judge returned no JSON object: ${text.slice(0, 240)}`);
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new JudgeFormatError(`Quality judge returned malformed JSON: ${text.slice(0, 240)}`);
  }
}

/** Parse the judge's text answer into a validated report (throws JudgeFormatError). */
export function parseJudgeReport(text: string): GalleryQualityReport {
  const parsed = judgeReportSchema.safeParse(parseJsonObject(text));
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    throw new JudgeFormatError(`Quality judge report is missing or has invalid fields: ${fields}`);
  }
  return parsed.data;
}

function extractText(json: GeminiQualityResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("\n").trim();
}

export function thresholdFailures(report: GalleryQualityReport): string[] {
  const failures: string[] = [];
  if (report.likenessScore < MIN_LIKENESS_SCORE) {
    failures.push(`likeness ${report.likenessScore.toFixed(2)} < ${MIN_LIKENESS_SCORE}`);
  }
  if (report.partnerOneLikenessScore < MIN_PARTNER_LIKENESS_SCORE) {
    failures.push(
      `partner one likeness ${report.partnerOneLikenessScore.toFixed(2)} < ${MIN_PARTNER_LIKENESS_SCORE}`,
    );
  }
  if (report.partnerTwoLikenessScore < MIN_PARTNER_LIKENESS_SCORE) {
    failures.push(
      `partner two likeness ${report.partnerTwoLikenessScore.toFixed(2)} < ${MIN_PARTNER_LIKENESS_SCORE}`,
    );
  }
  if (report.venueScore < MIN_VENUE_SCORE) {
    failures.push(`venue ${report.venueScore.toFixed(2)} < ${MIN_VENUE_SCORE}`);
  }
  if (report.compositionScore < MIN_COMPOSITION_SCORE) {
    failures.push(
      `composition ${report.compositionScore.toFixed(2)} < ${MIN_COMPOSITION_SCORE}`,
    );
  }
  if (!report.partnerIdentitySeparation) {
    failures.push("generated partners do not map to two distinct real identities");
  }
  if (!report.exactlyTwoPartners) failures.push("output does not contain exactly two partners");
  if (!report.facesVisible) failures.push("faces are not clearly visible");
  if (report.extraPeople) failures.push("extra people detected");
  if (report.textArtifacts) failures.push("text/logo artifacts detected");
  return failures;
}

export interface JudgeFrameParams {
  sessionId: number;
  scene: WeddingScene;
  generated: ImageRef;
  generatedModel?: string;
  coupleReferences: ImageRef[];
  venueReferences: ImageRef[];
  /** Aborts the in-flight judge call (session deadline). */
  signal?: AbortSignal;
}

export interface JudgeOptions {
  /** Delays between judge attempts; defaults to 1.5s then 4s. Tests pass zeros. */
  retryDelaysMs?: number[];
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function buildJudgeRequest(params: JudgeFrameParams): Promise<string> {
  const coupleRefs = params.coupleReferences.slice(0, MAX_COUPLE_JUDGE_REFERENCES);
  const maxVenueRefs = Math.max(1, MAX_TOTAL_JUDGE_IMAGES - 1 - coupleRefs.length);
  const venueRefs = params.venueReferences.slice(0, maxVenueRefs);
  const generated = await normalizeForJudgeUncached(params.generated.buffer);
  const normalizedCoupleRefs = await Promise.all(coupleRefs.map((ref) => normalizeReferenceForJudge(ref)));
  const normalizedVenueRefs = await Promise.all(venueRefs.map((ref) => normalizeReferenceForJudge(ref)));
  const venueCoverageSummary = venueRefs
    .map((ref, index) => {
      const label = venueCoverageLabel(ref.coverage);
      return label ? `VENUE REFERENCE ${index + 1}: ${label}` : null;
    })
    .filter((line): line is string => Boolean(line))
    .join("; ");

  const prompt = [
    "You are the final production quality gate for a venue sales gallery.",
    "Compare the GENERATED IMAGE to the COUPLE REFERENCES and VENUE REFERENCES.",
    "Score only whether the generated image preserves the same two people's facial likeness and the same real venue. Do not identify the people by name.",
    "Score partnerOneLikenessScore and partnerTwoLikenessScore separately so one accurate face cannot hide one replaced or generic face. Match each generated person to the best corresponding real partner across all couple references; do not rely on left-to-right position because reference poses may swap sides.",
    "Set partnerIdentitySeparation=true only when the two generated people clearly map to two distinct real partners from the couple references. Set it false if both generated faces look like the same reference person, if identities are merged, if one partner is replaced by a generic face, or if the assignment is ambiguous.",
    "Be conservative: if either generated face could plausibly be a different person, that partner score must be below 0.78. If venue architecture, materials, layout, or signature lighting are generic or invented, venueScore must be below 0.80.",
    venueCoverageSummary
      ? `Venue reference coverage roles: ${venueCoverageSummary}. Use these roles when deciding whether the generated venue matches the intended real venue feature for this scene.`
      : "",
    `Scene: ${params.scene.title}.`,
    "Return only JSON with this exact shape:",
    '{"likenessScore":0.0,"partnerOneLikenessScore":0.0,"partnerTwoLikenessScore":0.0,"partnerIdentitySeparation":true,"venueScore":0.0,"compositionScore":0.0,"exactlyTwoPartners":true,"facesVisible":true,"extraPeople":false,"textArtifacts":false,"pass":true,"reasons":["short reason"]}',
    "Scoring guidance: likenessScore requires both generated faces to match the two distinct real partners; partner scores are per-person facial identity after best identity matching; partnerIdentitySeparation requires two separate real identities rather than duplication or averaging; venueScore requires recognizable architecture/materials/light/layout from references; compositionScore requires realistic scale, perspective, lighting, shadows, and no obvious paste-in artifacts.",
    "Set pass=false for wrong people, either partner replaced by a generic face, missing partner, generic/replaced venue, obscured faces, extra people, visible text, logos, watermarks, severe artifacts, or unrealistic compositing.",
  ].join("\n");

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: prompt },
    { text: "GENERATED IMAGE" },
    { inlineData: { mimeType: "image/jpeg", data: generated.toString("base64") } },
  ];

  normalizedCoupleRefs.forEach((buffer, index) => {
    const coupleRole =
      index === 0
        ? "TOGETHER REFERENCE"
        : index === 1
          ? "EXPECTED PARTNER A FACE REFERENCE"
          : "EXPECTED PARTNER B FACE REFERENCE";
    parts.push(
      { text: `COUPLE REFERENCE ${index + 1}: ${coupleRole}. If the actual photo content differs, infer the two-partner mapping from all couple references.` },
      { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } },
    );
  });

  normalizedVenueRefs.forEach((buffer, index) => {
    const coverage = venueCoverageLabel(venueRefs[index]?.coverage);
    const label = `VENUE REFERENCE ${index + 1}${coverage ? `: ${coverage}` : ""}`;
    parts.push(
      { text: label },
      { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } },
    );
  });

  return JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  });
}

/** One judge call. Throws GalleryJudgeUnavailableError (retryable or not) or JudgeFormatError. */
async function callJudgeOnce(apiKey: string, body: string, signal?: AbortSignal): Promise<GalleryQualityReport> {
  const timeout = AbortSignal.timeout(judgeTimeoutMs());
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${geminiApiBase()}/models/${QUALITY_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body,
      signal: combined,
    });
    text = await res.text();
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new GalleryJudgeUnavailableError(
      `Gallery quality judge request failed: ${err instanceof Error ? err.message : String(err)}`,
      true,
    );
  }
  if (!res.ok) {
    // 408/429/5xx are outages worth retrying; other 4xx (bad key, bad request)
    // will not fix themselves within a session.
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw new GalleryJudgeUnavailableError(
      `Gallery quality judge failed (${res.status}): ${text.slice(0, 600)}`,
      retryable,
    );
  }
  let json: GeminiQualityResponse;
  try {
    json = JSON.parse(text) as GeminiQualityResponse;
  } catch {
    throw new JudgeFormatError(`Gallery quality judge returned non-JSON body: ${text.slice(0, 240)}`);
  }
  if (json.error) {
    throw new GalleryJudgeUnavailableError(
      `Gallery quality judge error: ${json.error.message ?? "unknown"}`,
      true,
    );
  }
  return parseJudgeReport(extractText(json));
}

/**
 * Ask the judge for a verdict on one generated frame, retrying judge outages
 * and malformed answers on the SAME frame (up to JUDGE_ATTEMPTS calls with
 * backoff). Never re-renders. Throws GalleryJudgeUnavailableError when no
 * verdict could be obtained.
 */
export async function judgeGalleryFrame(
  params: JudgeFrameParams,
  options: JudgeOptions = {},
): Promise<GalleryQualityReport> {
  const apiKey = (process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY)?.trim();
  if (!apiKey) {
    throw new GalleryJudgeUnavailableError(
      "Gemini API key (GOOGLE_AI_API_KEY) is required for gallery quality evaluation.",
      false,
    );
  }
  const body = await buildJudgeRequest(params);
  const delays = options.retryDelaysMs ?? DEFAULT_JUDGE_RETRY_DELAYS_MS;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= JUDGE_ATTEMPTS; attempt++) {
    params.signal?.throwIfAborted();
    try {
      return await callJudgeOnce(apiKey, body, params.signal);
    } catch (err) {
      if (params.signal?.aborted) throw err;
      lastErr = err;
      const retryable =
        err instanceof JudgeFormatError ||
        (err instanceof GalleryJudgeUnavailableError && err.retryable);
      logger.warn(
        { err, sessionId: params.sessionId, sceneId: params.scene.id, attempt, retryable },
        "Gallery quality judge attempt failed",
      );
      if (!retryable || attempt === JUDGE_ATTEMPTS) break;
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0, params.signal);
    }
  }
  if (lastErr instanceof GalleryJudgeUnavailableError) throw lastErr;
  throw new GalleryJudgeUnavailableError(
    `Gallery quality judge gave no usable verdict after ${JUDGE_ATTEMPTS} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
    true,
  );
}

/**
 * Judge a frame and enforce the strict targets. Returns the report on pass,
 * null when the gate is disabled; throws GalleryQualityError when the frame
 * missed a target and GalleryJudgeUnavailableError when no verdict exists.
 */
export async function assertGalleryFrameQuality(
  params: JudgeFrameParams,
  options: JudgeOptions = {},
): Promise<GalleryQualityReport | null> {
  if (!qualityGateEnabled()) return null;

  const report = await judgeGalleryFrame(params, options);
  const failures = thresholdFailures(report);
  logger.info(
    {
      sessionId: params.sessionId,
      sceneId: params.scene.id,
      model: QUALITY_MODEL,
      report,
      thresholds: {
        likeness: MIN_LIKENESS_SCORE,
        venue: MIN_VENUE_SCORE,
        composition: MIN_COMPOSITION_SCORE,
        partner: MIN_PARTNER_LIKENESS_SCORE,
      },
    },
    "Gallery frame quality evaluated",
  );

  if (!report.pass || failures.length > 0) {
    throw new GalleryQualityError(
      `Generated frame failed quality gate: ${[...failures, ...report.reasons].join("; ")}`,
      report,
      { buffer: params.generated.buffer, mimeType: params.generated.mimeType },
      params.generatedModel ?? "unknown",
    );
  }

  return report;
}
