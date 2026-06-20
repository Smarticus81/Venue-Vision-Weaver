import dotenv from "dotenv";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VENUE_QA_COVERAGE_ORDER = [
  "exterior",
  "ceremony",
  "reception",
  "detail",
  "natural_light",
] as const;

type VenueQaCoverage = (typeof VENUE_QA_COVERAGE_ORDER)[number];
type ImageRef = {
  buffer: Buffer;
  mimeType: string;
  file: string;
  sha256: string;
  coverage?: VenueQaCoverage;
};

type CoupleInputEvidence = {
  file: string;
  sha256: string;
};

type VenueInputEvidence = CoupleInputEvidence & {
  coverage: VenueQaCoverage | null;
};

interface CliOptions {
  coupleDir: string;
  venueDir: string;
  outDir: string;
  styleId: string;
  coupleName: string | null;
  allowNonpassing: boolean;
  consentConfirmed: boolean;
}

interface FrameQaReport {
  sceneId: string;
  sceneTitle: string;
  aspectRatio: string;
  rawPath: string;
  polishedPath: string;
  attempts: number;
  model: string;
  venueReferences: VenueInputEvidence[];
  qualityReport: unknown;
}

interface QaSummary {
  frameCount: number;
  automatedPass: boolean;
  manualReviewRequired: boolean;
  reelReady: boolean;
  totalAttempts: number;
  maxAttemptsOnFrame: number;
  minLikenessScore: number | null;
  minPartnerScore: number | null;
  minVenueScore: number | null;
  minCompositionScore: number | null;
  warnings: string[];
}

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true });

const QA_THRESHOLDS = {
  likeness: Number(process.env.GALLERY_MIN_LIKENESS_SCORE ?? "0.82"),
  partner: Number(process.env.GALLERY_MIN_PARTNER_LIKENESS_SCORE ?? "0.78"),
  venue: Number(process.env.GALLERY_MIN_VENUE_SCORE ?? "0.8"),
  composition: Number(process.env.GALLERY_MIN_COMPOSITION_SCORE ?? "0.74"),
};

function usage(): never {
  console.error(
    [
      "Usage:",
      "  pnpm run gallery:qa -- --couple ./samples/couple --venue ./samples/venue [--out ./qa-output/live] [--style cinematic-editorial] [--couple-name \"Avery & Morgan\"]",
      "",
      "Required:",
      "  --couple   Folder with 2-3 clear couple reference images.",
      "  --venue    Folder with at least 5 venue reference images ordered by coverage:",
      "             1 exterior/facade, 2 ceremony, 3 reception, 4 detail, 5 natural-light view.",
      "  --consent-confirmed  Confirm the couple and venue references are authorized for this QA run.",
      "  --allow-nonpassing  Exit 0 even if the automated QA summary fails (local plumbing only).",
      "",
      "Environment:",
      "  GOOGLE_AI_API_KEY or GEMINI_API_KEY must be set.",
      "  GALLERY_QUALITY_GATE=off can disable judge scoring for local plumbing tests.",
    ].join("\n"),
  );
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) usage();
    const key = arg.slice(2);
    if (key === "allow-nonpassing" || key === "consent-confirmed") {
      flags.add(key);
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) usage();
    values.set(key, value);
    i++;
  }

  const couple = values.get("couple");
  const venue = values.get("venue");
  if (!couple || !venue) usage();
  const allowNonpassing = flags.has("allow-nonpassing");
  const consentConfirmed = flags.has("consent-confirmed");
  if (!consentConfirmed && !allowNonpassing) {
    throw new Error(
      "Gallery QA requires --consent-confirmed when using production gating. Use --allow-nonpassing only for local plumbing checks.",
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    coupleDir: resolveFromRepo(couple),
    venueDir: resolveFromRepo(venue),
    outDir: resolveFromRepo(values.get("out") ?? `qa-output/gallery-${stamp}`),
    styleId: values.get("style") ?? "cinematic-editorial",
    coupleName: values.get("couple-name") ?? null,
    allowNonpassing,
    consentConfirmed,
  };
}

function resolveFromRepo(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function mimeTypeFor(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return null;
}

async function loadImageRefs(dir: string): Promise<ImageRef[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => mimeTypeFor(file))
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    files.map(async (file) => {
      const buffer = await readFile(file);
      return {
        file,
        mimeType: mimeTypeFor(file)!,
        buffer,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      };
    }),
  );
}

function withVenueCoverage(refs: ImageRef[]): ImageRef[] {
  return refs.map((ref, index) => ({
    ...ref,
    coverage: VENUE_QA_COVERAGE_ORDER[index] ?? undefined,
  }));
}

function assertInputs(coupleRefs: ImageRef[], venueRefs: ImageRef[]): void {
  if (coupleRefs.length < 2 || coupleRefs.length > 3) {
    throw new Error(
      `Expected 2-3 couple images, found ${coupleRefs.length}. Keep only the clearest couple references in the folder.`,
    );
  }
  if (venueRefs.length < 5) {
    throw new Error(
      `Expected at least 5 venue images, found ${venueRefs.length}. Add facade, ceremony, reception, detail, and natural-light coverage.`,
    );
  }
}

function rel(file: string): string {
  return path.relative(repoRoot, file).replace(/\\/g, "/");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function srcFromReportPath(fromDir: string, reportPath: string): string {
  return escapeHtml(path.relative(fromDir, path.resolve(repoRoot, reportPath)).replace(/\\/g, "/"));
}

function scoreCell(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return numeric.toFixed(2);
}

function numericScore(report: unknown, key: string): number | null {
  if (!report || typeof report !== "object") return null;
  const value = (report as Record<string, unknown>)[key];
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function minNullable(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length > 0 ? Math.min(...numbers) : null;
}

function summarizeQa(report: {
  frames: FrameQaReport[];
  reelPath?: string;
  failed?: string;
}): QaSummary {
  const framePasses = report.frames.map((frame) => {
    const q = frame.qualityReport as Record<string, unknown> | null;
    return q?.pass === true;
  });
  const warnings: string[] = [];
  if (report.frames.length !== 4) warnings.push(`Expected 4 frames; found ${report.frames.length}.`);
  if (!report.reelPath) warnings.push("Motion reel was not produced.");
  if (report.failed) warnings.push(`Generation failed: ${report.failed}`);
  if (framePasses.some((pass) => !pass)) warnings.push("One or more frames did not pass the automated judge.");
  if (
    report.frames.some((frame) => {
      const q = frame.qualityReport as Record<string, unknown> | null;
      return q && q.partnerIdentitySeparation !== true;
    })
  ) {
    warnings.push("One or more frames did not preserve two distinct partner identities.");
  }
  const minLikenessScore = minNullable(
    report.frames.map((frame) => numericScore(frame.qualityReport, "likenessScore")),
  );
  const minPartnerScore = minNullable(
    report.frames.flatMap((frame) => [
      numericScore(frame.qualityReport, "partnerOneLikenessScore"),
      numericScore(frame.qualityReport, "partnerTwoLikenessScore"),
    ]),
  );
  const minVenueScore = minNullable(
    report.frames.map((frame) => numericScore(frame.qualityReport, "venueScore")),
  );
  const minCompositionScore = minNullable(
    report.frames.map((frame) => numericScore(frame.qualityReport, "compositionScore")),
  );
  if (minLikenessScore === null) warnings.push("Automated likeness scores are missing.");
  if (minPartnerScore === null) warnings.push("Automated per-partner likeness scores are missing.");
  if (minVenueScore === null) warnings.push("Automated venue scores are missing.");
  if (minCompositionScore === null) warnings.push("Automated composition scores are missing.");
  if (minLikenessScore !== null && minLikenessScore < QA_THRESHOLDS.likeness) {
    warnings.push(`Minimum likeness score ${minLikenessScore.toFixed(2)} is below ${QA_THRESHOLDS.likeness}.`);
  }
  if (minPartnerScore !== null && minPartnerScore < QA_THRESHOLDS.partner) {
    warnings.push(`Minimum partner score ${minPartnerScore.toFixed(2)} is below ${QA_THRESHOLDS.partner}.`);
  }
  if (minVenueScore !== null && minVenueScore < QA_THRESHOLDS.venue) {
    warnings.push(`Minimum venue score ${minVenueScore.toFixed(2)} is below ${QA_THRESHOLDS.venue}.`);
  }
  if (minCompositionScore !== null && minCompositionScore < QA_THRESHOLDS.composition) {
    warnings.push(
      `Minimum composition score ${minCompositionScore.toFixed(2)} is below ${QA_THRESHOLDS.composition}.`,
    );
  }

  return {
    frameCount: report.frames.length,
    automatedPass:
      !report.failed &&
      report.frames.length === 4 &&
      Boolean(report.reelPath) &&
      framePasses.every(Boolean) &&
      warnings.length === 0,
    manualReviewRequired: true,
    reelReady: Boolean(report.reelPath),
    totalAttempts: report.frames.reduce((sum, frame) => sum + frame.attempts, 0),
    maxAttemptsOnFrame: Math.max(0, ...report.frames.map((frame) => frame.attempts)),
    minLikenessScore,
    minPartnerScore,
    minVenueScore,
    minCompositionScore,
    warnings,
  };
}

function qualitySummary(report: unknown): string {
  if (!report || typeof report !== "object") return "Quality gate off or unavailable";
  const q = report as Record<string, unknown>;
  const reasons = Array.isArray(q.reasons)
    ? q.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  return [
    `Pass: ${q.pass === true ? "yes" : "no"}`,
    `Likeness: ${scoreCell(q.likenessScore)}`,
    `Partner 1: ${scoreCell(q.partnerOneLikenessScore)}`,
    `Partner 2: ${scoreCell(q.partnerTwoLikenessScore)}`,
    `Distinct identities: ${q.partnerIdentitySeparation === true ? "yes" : "no"}`,
    `Venue: ${scoreCell(q.venueScore)}`,
    `Composition: ${scoreCell(q.compositionScore)}`,
    `Exactly two partners: ${q.exactlyTwoPartners === true ? "yes" : "no"}`,
    `Faces visible: ${q.facesVisible === true ? "yes" : "no"}`,
    `Extra people: ${q.extraPeople === true ? "yes" : "no"}`,
    `Text artifacts: ${q.textArtifacts === true ? "yes" : "no"}`,
    reasons.length ? `Reasons: ${reasons.join("; ")}` : "",
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join("<br />");
}

async function writeHtmlReview(params: {
  outDir: string;
  report: {
    generatedAt: string;
    style: { id: string; name: string };
    models: {
      image: string;
      imageFallbacks: string[];
      imageSize: string;
      quality: string;
      qualityGate: string;
    };
    inputs: {
      couple: CoupleInputEvidence[];
      venue: VenueInputEvidence[];
      consentConfirmed: boolean;
    };
    frames: FrameQaReport[];
    summary?: QaSummary;
    reelPath?: string;
    failed?: string;
    operatorReview: string[];
  };
}): Promise<string> {
  const { outDir, report } = params;
  const htmlPath = path.join(outDir, "review.html");
  const coupleImages = report.inputs.couple
    .map(
      (ref, index) =>
        `<figure><img src="${srcFromReportPath(outDir, ref.file)}" alt="Couple reference ${index + 1}" /><figcaption>${escapeHtml(path.basename(ref.file))}<br />sha256 ${escapeHtml(ref.sha256.slice(0, 12))}</figcaption></figure>`,
    )
    .join("");
  const venueImages = report.inputs.venue
    .map((ref, index) => {
      const coverage = ref.coverage ? ` - ${ref.coverage.replace("_", " ")}` : "";
      return `<figure><img src="${srcFromReportPath(outDir, ref.file)}" alt="Venue reference ${index + 1}" /><figcaption>${index + 1}. ${escapeHtml(path.basename(ref.file))}${escapeHtml(coverage)}<br />sha256 ${escapeHtml(ref.sha256.slice(0, 12))}</figcaption></figure>`;
    })
    .join("");
  const frames = report.frames
    .map((frame, index) => {
      const venueRefs = frame.venueReferences
        .map((ref) => {
          const label = ref.coverage
            ? `${ref.coverage.replace("_", " ")} venue reference`
            : "Venue reference";
          return `<figure><img src="${srcFromReportPath(outDir, ref.file)}" alt="${escapeHtml(label)} used for ${escapeHtml(frame.sceneTitle)}" /><figcaption>${escapeHtml(label)}<br />sha256 ${escapeHtml(ref.sha256.slice(0, 12))}</figcaption></figure>`;
        })
        .join("");
      return `<section class="frame">
        <header>
          <div>
            <p class="eyebrow">Frame ${index + 1}</p>
            <h2>${escapeHtml(frame.sceneTitle)}</h2>
            <p>${escapeHtml(frame.sceneId)} | ${escapeHtml(frame.aspectRatio)} | model ${escapeHtml(frame.model)} | attempts ${frame.attempts}</p>
          </div>
          <div class="score">${qualitySummary(frame.qualityReport)}</div>
        </header>
        <div class="frame-grid">
          <figure><img src="${srcFromReportPath(outDir, frame.rawPath)}" alt="Raw generated frame ${index + 1}" /><figcaption>Raw generation</figcaption></figure>
          <figure><img src="${srcFromReportPath(outDir, frame.polishedPath)}" alt="Polished generated frame ${index + 1}" /><figcaption>Polished still</figcaption></figure>
          <div class="used-refs"><h3>Venue refs used</h3><div>${venueRefs}</div></div>
        </div>
      </section>`;
    })
    .join("");
  const checklist = report.operatorReview
    .map((item) => `<label><input type="checkbox" /> ${escapeHtml(item)}</label>`)
    .join("");
  const summary = report.summary ?? summarizeQa(report);
  const warnings = summary.warnings.length
    ? `<ul>${summary.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : "<p>No automated warnings. Manual review is still recommended before production launch.</p>";
  const summaryHtml = `<section class="panel">
    <p class="eyebrow">Automated summary</p>
    <div class="summary-grid">
      <div><strong>Automated pass</strong><span>${summary.automatedPass ? "yes" : "no"}</span></div>
      <div><strong>Manual review</strong><span>${summary.manualReviewRequired ? "required" : "not required"}</span></div>
      <div><strong>Frames</strong><span>${summary.frameCount}/4</span></div>
      <div><strong>Reel</strong><span>${summary.reelReady ? "ready" : "missing"}</span></div>
      <div><strong>Total attempts</strong><span>${summary.totalAttempts}</span></div>
      <div><strong>Max attempts</strong><span>${summary.maxAttemptsOnFrame}</span></div>
      <div><strong>Min likeness</strong><span>${scoreCell(summary.minLikenessScore)}</span></div>
      <div><strong>Min partner</strong><span>${scoreCell(summary.minPartnerScore)}</span></div>
      <div><strong>Min venue</strong><span>${scoreCell(summary.minVenueScore)}</span></div>
      <div><strong>Min composition</strong><span>${scoreCell(summary.minCompositionScore)}</span></div>
    </div>
    <div class="warnings">${warnings}</div>
  </section>`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>glimpse gallery QA review</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f4ef; color: #24211d; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1360px; margin: 0 auto; }
    h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; margin: 0; }
    h1 { font-size: clamp(32px, 5vw, 64px); line-height: 0.95; }
    h2 { font-size: 30px; }
    h3 { font-size: 18px; }
    p { color: #665f55; line-height: 1.55; }
    img { display: block; width: 100%; height: auto; background: #e9e2d7; }
    figure { margin: 0; border: 1px solid #ded4c6; background: #fffdf9; }
    figcaption { padding: 10px 12px; color: #665f55; font-size: 13px; }
    .hero, .panel, .frame { background: #fffdf9; border: 1px solid #ded4c6; padding: 24px; margin-bottom: 24px; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr); gap: 24px; align-items: start; }
    .eyebrow { margin: 0 0 8px; color: #b8955a; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; }
    .meta { display: grid; gap: 8px; font-size: 14px; color: #3d3832; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .summary-grid div { border: 1px solid #e7ded2; background: #fbf8f2; padding: 12px; }
    .summary-grid strong { display: block; color: #665f55; font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 6px; }
    .summary-grid span { color: #24211d; font-size: 20px; }
    .warnings { margin-top: 14px; color: #665f55; }
    .warnings ul { margin: 0; padding-left: 20px; }
    .refs { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .checklist { display: grid; gap: 10px; }
    .checklist label { padding: 12px; border: 1px solid #e7ded2; background: #fbf8f2; }
    .frame header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 360px); gap: 18px; margin-bottom: 18px; }
    .score { border: 1px solid #e7ded2; background: #fbf8f2; padding: 12px; font-size: 13px; line-height: 1.5; color: #3d3832; }
    .frame-grid { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(260px, 1fr) minmax(220px, 0.65fr); gap: 14px; align-items: start; }
    .used-refs { border: 1px solid #ded4c6; background: #fffdf9; padding: 12px; }
    .used-refs div { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; margin-top: 10px; }
    video { width: 100%; max-height: 70vh; background: #111; }
    @media (max-width: 820px) { body { padding: 16px; } .hero, .frame header, .frame-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <div>
      <p class="eyebrow">glimpse gallery QA</p>
      <h1>Live likeness and venue review</h1>
      <p>Use this page after a real generation run to judge whether the couple is instantly recognizable and naturally blended into the uploaded venue photographs.</p>
    </div>
    <div class="meta">
      <div><strong>Generated:</strong> ${escapeHtml(report.generatedAt)}</div>
      <div><strong>Style:</strong> ${escapeHtml(report.style.name)} (${escapeHtml(report.style.id)})</div>
      <div><strong>Image model:</strong> ${escapeHtml(report.models.image)}</div>
      <div><strong>Fallbacks:</strong> ${escapeHtml(report.models.imageFallbacks.join(", ") || "none")}</div>
      <div><strong>Quality judge:</strong> ${escapeHtml(report.models.quality)} (${escapeHtml(report.models.qualityGate)})</div>
      ${report.failed ? `<div><strong>Failure:</strong> ${escapeHtml(report.failed)}</div>` : ""}
    </div>
  </section>

  <section class="panel">
    <p class="eyebrow">Operator checklist</p>
    <div class="checklist">${checklist}</div>
  </section>

  ${summaryHtml}

  <section class="panel">
    <p class="eyebrow">Couple references</p>
    <div class="refs">${coupleImages}</div>
  </section>

  <section class="panel">
    <p class="eyebrow">Venue references</p>
    <div class="refs">${venueImages}</div>
  </section>

  ${frames}

  ${
    report.reelPath
      ? `<section class="panel"><p class="eyebrow">Motion reel</p><video src="${srcFromReportPath(outDir, report.reelPath)}" controls playsinline></video></section>`
      : ""
  }
</main>
</body>
</html>`;
  await writeFile(htmlPath, html);
  return htmlPath;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const [
    { polishGalleryFrame },
    { renderGalleryFrameWithQuality, userMessageForStillError },
    { planGalleryScenes },
    { buildKenBurnsSlideshow },
    { findGalleryStyle, GALLERY_STYLES },
    { configuredImageModels },
    { assertReferenceImagesValid },
  ] = await Promise.all([
    import("../lib/galleryFrame.js"),
    import("../lib/galleryGeneration.js"),
    import("../lib/scenePlan.js"),
    import("../lib/motionReel.js"),
    import("../lib/galleryStyles.js"),
    import("../lib/stillImageClient.js"),
    import("../lib/referenceImage.js"),
  ]);
  const style = findGalleryStyle(options.styleId) ?? GALLERY_STYLES[0]!;
  const sessionId = Date.now();

  const [coupleRefs, rawVenueRefs] = await Promise.all([
    loadImageRefs(options.coupleDir),
    loadImageRefs(options.venueDir),
  ]);
  const venueRefs = withVenueCoverage(rawVenueRefs);
  assertInputs(coupleRefs, venueRefs);
  await assertReferenceImagesValid(coupleRefs, venueRefs);
  await mkdir(options.outDir, { recursive: true });

  const report: {
    generatedAt: string;
    style: { id: string; name: string };
    models: {
      image: string;
      imageFallbacks: string[];
      imageSize: string;
      quality: string;
      qualityGate: string;
    };
    inputs: {
      couple: CoupleInputEvidence[];
      venue: VenueInputEvidence[];
      consentConfirmed: boolean;
    };
    frames: FrameQaReport[];
    summary?: QaSummary;
    reelPath?: string;
    failed?: string;
    operatorReview: string[];
  } = {
    generatedAt: new Date().toISOString(),
    style: { id: style.id, name: style.name },
    models: {
      image: configuredImageModels()[0] ?? "gemini-3-pro-image",
      imageFallbacks: configuredImageModels().slice(1),
      imageSize: process.env.GEMINI_IMAGE_SIZE ?? "2K",
      quality: process.env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro",
      qualityGate: process.env.GALLERY_QUALITY_GATE === "off" ? "off" : "on",
    },
    inputs: {
      couple: coupleRefs.map((ref) => ({
        file: rel(ref.file),
        sha256: ref.sha256,
      })),
      venue: venueRefs.map((ref) => ({
        file: rel(ref.file),
        coverage: ref.coverage ?? null,
        sha256: ref.sha256,
      })),
      consentConfirmed: options.consentConfirmed,
    },
    frames: [],
    operatorReview: [
      "Open each polished still and confirm both faces are instantly recognizable.",
      "Confirm the first five venue references map to exterior, ceremony, reception, detail, and natural-light coverage.",
      "Confirm the venue is the uploaded venue, not a generic replacement.",
      "Confirm the couple appears naturally composited with correct scale, shadows, lighting, and no extra people.",
      "Open the MP4 reel and confirm branding/motion is acceptable for a sales follow-up.",
    ],
  };

  try {
    const polishedFrames: Buffer[] = [];
    const scenes = planGalleryScenes();

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!;
      const result = await renderGalleryFrameWithQuality({
        sessionId,
        scene,
        style,
        sceneIndex: i,
        coupleBuffers: coupleRefs,
        venueBuffers: venueRefs,
      });

      const baseName = `${String(i + 1).padStart(2, "0")}-${scene.id}`;
      const rawPath = path.join(options.outDir, `${baseName}.raw.jpg`);
      const polishedPath = path.join(options.outDir, `${baseName}.jpg`);
      const polished = await polishGalleryFrame(result.raw, {
        coupleName: options.coupleName,
        sceneIndex: i,
      });

      await writeFile(rawPath, result.raw);
      await writeFile(polishedPath, polished);
      polishedFrames.push(polished);

      report.frames.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        aspectRatio: scene.aspectRatio,
        rawPath: rel(rawPath),
        polishedPath: rel(polishedPath),
        attempts: result.attempts,
        model: result.model,
        venueReferences: result.venueReferenceIndexes.map((index) => ({
          file: rel(venueRefs[index]!.file),
          coverage: venueRefs[index]!.coverage ?? null,
          sha256: venueRefs[index]!.sha256,
        })),
        qualityReport: result.qualityReport,
      });
    }

    const reel = await buildKenBurnsSlideshow(polishedFrames, 4);
    const reelPath = path.join(options.outDir, "glimpse-motion-reel.mp4");
    await writeFile(reelPath, reel);
    report.reelPath = rel(reelPath);
  } catch (err) {
    report.failed = userMessageForStillError(err);
    report.summary = summarizeQa(report);
    const reviewPath = await writeHtmlReview({ outDir: options.outDir, report });
    await writeFile(
      path.join(options.outDir, "quality-report.json"),
      JSON.stringify(report, null, 2),
    );
    console.error(`Review page: ${rel(reviewPath)}`);
    throw err;
  }

  report.summary = summarizeQa(report);
  const reviewPath = await writeHtmlReview({ outDir: options.outDir, report });
  await writeFile(
    path.join(options.outDir, "quality-report.json"),
    JSON.stringify(report, null, 2),
  );

  console.log(`Gallery QA complete: ${rel(options.outDir)}`);
  console.log(`Frames: ${report.frames.length}, reel: ${report.reelPath}`);
  console.log(
    `Automated pass: ${report.summary.automatedPass ? "yes" : "no"}; manual review: required; min partner score: ${scoreCell(report.summary.minPartnerScore)}`,
  );
  console.log(`Report: ${rel(path.join(options.outDir, "quality-report.json"))}`);
  console.log(`Review: ${rel(reviewPath)}`);
  if (!report.summary.automatedPass && !options.allowNonpassing) {
    throw new Error(
      "Gallery QA did not pass the automated production gate. Review quality-report.json and rerun with --allow-nonpassing only for local plumbing tests.",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
