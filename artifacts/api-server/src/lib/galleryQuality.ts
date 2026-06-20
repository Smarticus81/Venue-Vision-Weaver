import sharp from "sharp";
import { logger } from "./logger.js";
import type { WeddingScene } from "./scenePlan.js";
import {
  VENUE_MEDIA_COVERAGE_LABELS,
  isVenueMediaCoverage,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";

type ImageRef = { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1";
const QUALITY_MODEL = process.env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro";
const QUALITY_ENABLED = process.env.GALLERY_QUALITY_GATE !== "off";
const MIN_LIKENESS_SCORE = Number(process.env.GALLERY_MIN_LIKENESS_SCORE ?? "0.82");
const MIN_PARTNER_LIKENESS_SCORE = Number(process.env.GALLERY_MIN_PARTNER_LIKENESS_SCORE ?? "0.78");
const MIN_VENUE_SCORE = Number(process.env.GALLERY_MIN_VENUE_SCORE ?? "0.8");
const MIN_COMPOSITION_SCORE = Number(process.env.GALLERY_MIN_COMPOSITION_SCORE ?? "0.74");
const MAX_TOTAL_JUDGE_IMAGES = 14;
const MAX_COUPLE_JUDGE_REFERENCES = 3;

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
  ) {
    super(message);
    this.name = "GalleryQualityError";
  }
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

async function normalizeForJudge(image: ImageRef): Promise<Buffer> {
  return sharp(image.buffer)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

function venueCoverageLabel(coverage: unknown): string | null {
  return isVenueMediaCoverage(coverage) ? VENUE_MEDIA_COVERAGE_LABELS[coverage] : null;
}

function numberInRange(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`Quality judge returned no JSON object: ${text.slice(0, 240)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function extractText(json: GeminiQualityResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text ?? "").join("\n").trim();
}

function normalizeReport(raw: Record<string, unknown>): GalleryQualityReport {
  const reasonsRaw = Array.isArray(raw.reasons) ? raw.reasons : [];
  return {
    likenessScore: numberInRange(raw.likenessScore),
    partnerOneLikenessScore: numberInRange(raw.partnerOneLikenessScore),
    partnerTwoLikenessScore: numberInRange(raw.partnerTwoLikenessScore),
    partnerIdentitySeparation: raw.partnerIdentitySeparation === true,
    venueScore: numberInRange(raw.venueScore),
    compositionScore: numberInRange(raw.compositionScore),
    exactlyTwoPartners: raw.exactlyTwoPartners === true,
    facesVisible: raw.facesVisible === true,
    extraPeople: raw.extraPeople === true,
    textArtifacts: raw.textArtifacts === true,
    pass: raw.pass === true,
    reasons: reasonsRaw
      .filter((reason): reason is string => typeof reason === "string")
      .map((reason) => reason.slice(0, 180)),
  };
}

function thresholdFailures(report: GalleryQualityReport): string[] {
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

export async function assertGalleryFrameQuality(params: {
  sessionId: number;
  scene: WeddingScene;
  generated: ImageRef;
  coupleReferences: ImageRef[];
  venueReferences: ImageRef[];
}): Promise<GalleryQualityReport | null> {
  if (!QUALITY_ENABLED) return null;

  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is required for gallery quality evaluation.");
  }

  const coupleRefs = params.coupleReferences.slice(0, MAX_COUPLE_JUDGE_REFERENCES);
  const maxVenueRefs = Math.max(1, MAX_TOTAL_JUDGE_IMAGES - 1 - coupleRefs.length);
  const venueRefs = params.venueReferences.slice(0, maxVenueRefs);
  const generated = await normalizeForJudge(params.generated);
  const normalizedCoupleRefs = await Promise.all(coupleRefs.map((ref) => normalizeForJudge(ref)));
  const normalizedVenueRefs = await Promise.all(venueRefs.map((ref) => normalizeForJudge(ref)));
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

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0,
    },
  };

  const url = `${GEMINI_API_BASE}/models/${QUALITY_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gallery quality judge failed (${res.status}): ${text.slice(0, 800)}`);
  }

  const json = JSON.parse(text) as GeminiQualityResponse;
  if (json.error) {
    throw new Error(`Gallery quality judge error: ${json.error.message ?? "unknown"}`);
  }

  const report = normalizeReport(parseJsonObject(extractText(json)));
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
    );
  }

  return report;
}
