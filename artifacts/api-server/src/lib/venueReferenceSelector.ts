import sharp from "sharp";
import type { WeddingScene } from "./scenePlan.js";
import { logger } from "./logger.js";
import {
  VENUE_MEDIA_COVERAGE_LABELS,
  isVenueMediaCoverage,
  preferredVenueCoveragesForScene,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";

type ImageRef = { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1";
const VENUE_SELECTOR_MODEL =
  process.env.GEMINI_VENUE_SELECTOR_MODEL ??
  process.env.GEMINI_QUALITY_MODEL ??
  "gemini-2.5-flash";

interface GeminiSelectorResponse {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
      }[];
    };
  }[];
  error?: { message?: string; code?: number; status?: string };
}

async function normalizeVenueReference(ref: ImageRef): Promise<Buffer> {
  return sharp(ref.buffer)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

function extractText(json: GeminiSelectorResponse): string {
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function parseRankedIndexes(text: string, maxIndex: number): number[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];

  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    rankedIndexes?: unknown;
  };
  if (!Array.isArray(parsed.rankedIndexes)) return [];

  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const value of parsed.rankedIndexes) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n <= maxIndex && !seen.has(n)) {
      seen.add(n);
      indexes.push(n);
    }
  }
  return indexes;
}

function legacyFallbackIndexes(sceneId: string, count: number): number[] {
  const preferred =
    sceneId === "portrait-vertical" ? [1, 3, 0, 2, 4] :
    sceneId === "intimate-moment" ? [3, 1, 0, 2, 4] :
    sceneId === "grand-venue" ? [0, 1, 4, 2, 3] :
    sceneId === "celebration" ? [4, 0, 3, 1, 2] :
    [0, 1, 2, 3, 4];
  return preferred.filter((index) => index < count);
}

function fallbackIndexes(sceneId: string, refs: ImageRef[]): number[] {
  const byCoverage = preferredVenueCoveragesForScene(sceneId).flatMap((coverage) =>
    refs.flatMap((ref, index) => (ref.coverage === coverage ? [index] : [])),
  );
  const ordered = [
    ...byCoverage,
    ...legacyFallbackIndexes(sceneId, refs.length),
    ...refs.map((_, index) => index),
  ];
  return [...new Set(ordered)];
}

function venueCoverageLabel(coverage: unknown): string | null {
  return isVenueMediaCoverage(coverage) ? VENUE_MEDIA_COVERAGE_LABELS[coverage] : null;
}

export async function rankVenueReferencesForScene(
  scene: WeddingScene,
  venueRefs: ImageRef[],
): Promise<number[]> {
  if (venueRefs.length <= 1) return venueRefs.map((_, index) => index);

  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return fallbackIndexes(scene.id, venueRefs);
  }

  try {
    const normalized = await Promise.all(venueRefs.map((ref) => normalizeVenueReference(ref)));
    const prompt = [
      "You are selecting venue reference photos for a wedding venue sales gallery.",
      "Rank the uploaded venue images by usefulness for the requested scene.",
      "Choose images that show the actual room/exterior/detail most relevant to the scene, not generic beauty.",
      "Prefer broad architectural anchors for wide venue scenes, ceremony/reception interiors for portraits, close architectural/decor details for intimate scenes, and exterior or natural-light views for celebration scenes.",
      `Preferred coverage roles for this scene, in order: ${preferredVenueCoveragesForScene(scene.id)
        .map((coverage) => VENUE_MEDIA_COVERAGE_LABELS[coverage])
        .join(", ")}.`,
      `Scene id: ${scene.id}`,
      `Scene title: ${scene.title}`,
      `Scene venue requirement: ${scene.venueBeat}`,
      "Return only JSON: {\"rankedIndexes\":[0,1,2],\"reason\":\"short\"}. Indexes are zero-based and refer to the order the images were provided.",
    ].join("\n");

    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];
    normalized.forEach((buffer, index) => {
      const coverage = venueCoverageLabel(venueRefs[index]?.coverage);
      parts.push(
        { text: `VENUE IMAGE INDEX ${index}${coverage ? `: ${coverage}` : ""}` },
        { inlineData: { mimeType: "image/jpeg", data: buffer.toString("base64") } },
      );
    });

    const url = `${GEMINI_API_BASE}/models/${VENUE_SELECTOR_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`venue selector failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const json = JSON.parse(text) as GeminiSelectorResponse;
    if (json.error) {
      throw new Error(`venue selector error: ${json.error.message ?? "unknown"}`);
    }

    const ranked = parseRankedIndexes(extractText(json), venueRefs.length - 1);
    if (ranked.length > 0) {
      logger.info(
        { sceneId: scene.id, model: VENUE_SELECTOR_MODEL, ranked },
        "Ranked venue references for scene",
      );
      return ranked;
    }
  } catch (err) {
    logger.warn({ err, sceneId: scene.id }, "Venue reference ranking failed; using fallback order");
  }

  return fallbackIndexes(scene.id, venueRefs);
}
