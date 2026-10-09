import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.LOG_LEVEL ??= "silent";

const {
  GalleryJudgeUnavailableError,
  GalleryQualityError,
  JudgeFormatError,
  acceptanceFloorFailures,
  judgeGalleryFrame,
  parseJudgeReport,
  qualityRetryGuidanceForError,
  thresholdFailures,
} = await import("./galleryQuality.js");
const { describeGalleryFailure, userMessageForStillError } = await import("./stillImageClient.js");
const { ReferenceImageError } = await import("./referenceImageQuality.js");
const { GalleryStorageError, SessionDeadlineError, StillImageBlockedError, StillImageRequestError } =
  await import("./stillImageErrors.js");

const passingReport = {
  likenessScore: 0.9,
  partnerOneLikenessScore: 0.88,
  partnerTwoLikenessScore: 0.86,
  partnerIdentitySeparation: true,
  venueScore: 0.85,
  compositionScore: 0.8,
  exactlyTwoPartners: true,
  facesVisible: true,
  extraPeople: false,
  textArtifacts: false,
  pass: true,
  reasons: ["looks right"],
};

const scene = {
  id: "grand-venue",
  title: "Grand Venue",
  aspectRatio: "16:9" as const,
  coupleAction: "Wide shot",
  venueBeat: "Venue dominates",
};

async function tinyJpeg(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).jpeg().toBuffer();
}

function geminiAnswer(text: string, status = 200): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("parseJudgeReport validates a complete verdict, clamps scores and accepts fenced JSON", () => {
  const report = parseJudgeReport(
    "```json\n" + JSON.stringify({ ...passingReport, venueScore: 1.4, compositionScore: "0.75" }) + "\n```",
  );
  assert.equal(report.venueScore, 1);
  assert.equal(report.compositionScore, 0.75);
  assert.equal(report.pass, true);
  assert.deepEqual(report.reasons, ["looks right"]);
});

test("parseJudgeReport rejects a verdict with a missing integrity flag instead of coercing it to false", () => {
  const { facesVisible: _dropped, ...partial } = passingReport;
  assert.throws(() => parseJudgeReport(JSON.stringify(partial)), (err: unknown) => {
    assert.ok(err instanceof JudgeFormatError);
    assert.match((err as Error).message, /facesVisible/);
    return true;
  });
  assert.throws(() => parseJudgeReport("not json at all"), JudgeFormatError);
});

test("threshold and floor checks separate below-target frames from unusable ones", () => {
  assert.deepEqual(thresholdFailures(passingReport), []);
  const belowTarget = { ...passingReport, partnerTwoLikenessScore: 0.7, pass: false };
  assert.equal(thresholdFailures(belowTarget).length, 1);
  assert.deepEqual(acceptanceFloorFailures(belowTarget), [], "0.70 clears the 0.66 partner floor");
  const unusable = { ...passingReport, extraPeople: true, venueScore: 0.5 };
  const floors = acceptanceFloorFailures(unusable);
  assert.ok(floors.includes("extra people detected"));
  assert.ok(floors.some((failure) => failure.startsWith("venue 0.50")));
});

test("retry guidance targets the specific weakness of the rejected frame", () => {
  const err = new GalleryQualityError(
    "failed",
    { ...passingReport, partnerOneLikenessScore: 0.5, partnerIdentitySeparation: false, pass: false },
    { buffer: Buffer.from("x"), mimeType: "image/jpeg" },
    "gpt-image-2.5-sunburst",
  );
  const guidance = qualityRetryGuidanceForError(err);
  assert.ok(guidance?.includes("partner one likeness was weak"));
  assert.ok(guidance?.includes("two distinct real partners"));
  assert.equal(qualityRetryGuidanceForError(new Error("other")), null);
});

test("judgeGalleryFrame retries outages and malformed answers on the same frame, using the header key", async () => {
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_AI_API_KEY = "judge-key";
  process.env.GEMINI_API_BASE_URL = "https://mock-gemini.invalid/v1beta";
  const calls: { url: string; key: string | undefined }[] = [];
  const answers = [
    () => new Response("overloaded", { status: 503 }),
    () => geminiAnswer(JSON.stringify({ likenessScore: 0.9 })),
    () => geminiAnswer(JSON.stringify(passingReport)),
  ];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), key: (init?.headers as Record<string, string>)["x-goog-api-key"] });
    return answers[calls.length - 1]!();
  }) as typeof fetch;
  try {
    const image = await tinyJpeg({ r: 120, g: 90, b: 70 });
    const report = await judgeGalleryFrame(
      {
        sessionId: 1,
        scene,
        generated: { buffer: image, mimeType: "image/jpeg" },
        coupleReferences: [{ buffer: image, mimeType: "image/jpeg" }],
        venueReferences: [{ buffer: image, mimeType: "image/jpeg", coverage: "exterior" }],
      },
      { retryDelaysMs: [0, 0] },
    );
    assert.equal(report.pass, true);
    assert.equal(calls.length, 3, "two judge failures, one verdict, no re-render");
    for (const call of calls) {
      assert.equal(call.key, "judge-key");
      assert.ok(!call.url.includes("key="), "the API key never travels in the URL");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("judgeGalleryFrame gives up at once on a credential error and reports the judge unavailable", async () => {
  const originalFetch = globalThis.fetch;
  process.env.GOOGLE_AI_API_KEY = "judge-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("bad key", { status: 401 });
  }) as typeof fetch;
  try {
    const image = await tinyJpeg({ r: 20, g: 90, b: 70 });
    await assert.rejects(
      judgeGalleryFrame(
        {
          sessionId: 1,
          scene,
          generated: { buffer: image, mimeType: "image/jpeg" },
          coupleReferences: [{ buffer: image, mimeType: "image/jpeg" }],
          venueReferences: [{ buffer: image, mimeType: "image/jpeg" }],
        },
        { retryDelaysMs: [0, 0] },
      ),
      (err: unknown) => err instanceof GalleryJudgeUnavailableError && !err.retryable,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failure copy for the couple is fixed text; raw provider detail goes to the owner only", () => {
  const raw = new StillImageRequestError({
    message: "OpenAI image model gpt-image-2.5-sunburst request failed (500): internal stack trace at /srv/app.js:12",
    status: 500,
    body: "internal stack trace",
    retryWithFallbackModel: true,
  });
  const failure = describeGalleryFailure(raw);
  assert.equal(failure.category, "provider_unavailable");
  assert.ok(!failure.coupleMessage.includes("stack"), "couple copy never echoes provider text");
  assert.ok(failure.detail.includes("internal stack trace"), "owner detail keeps the raw cause");

  const storage = describeGalleryFailure(new GalleryStorageError("bucket 503 for /objects/uploads/abc"));
  assert.equal(storage.category, "storage");
  assert.ok(!storage.coupleMessage.includes("bucket"));
  assert.ok(!/photo/i.test(storage.coupleMessage), "a storage outage is not blamed on the couple's photos");

  assert.equal(describeGalleryFailure(new SessionDeadlineError(900_000)).category, "timeout");
  assert.equal(describeGalleryFailure(new StillImageBlockedError("blocked")).category, "blocked");
  assert.equal(describeGalleryFailure(new Error("ffmpeg exited with code 1: /tmp/x")).category, "unknown");
  assert.ok(!userMessageForStillError(new Error("ffmpeg exited with code 1: /tmp/x")).includes("ffmpeg"));
});

test("a Gemini 429 RESOURCE_EXHAUSTED is a rate limit, not an empty account", () => {
  const limited = new StillImageRequestError({
    message: 'Gemini image model gemini-3-pro-image request failed (429): {"error":{"status":"RESOURCE_EXHAUSTED"}}',
    status: 429,
    body: '{"error":{"status":"RESOURCE_EXHAUSTED"}}',
    retryWithFallbackModel: true,
  });
  assert.equal(describeGalleryFailure(limited).category, "provider_rate_limit");
  const billing = new StillImageRequestError({
    message: "OpenAI image model gpt-image-2.5-sunburst request failed (429): insufficient_quota",
    status: 429,
    body: "insufficient_quota",
    retryWithFallbackModel: true,
  });
  assert.equal(describeGalleryFailure(billing).category, "provider_billing");
});

test("couple photo problems quote our own validation text; venue setup problems never blame the couple", () => {
  const couple = describeGalleryFailure(new ReferenceImageError("Couple photo 2 appears blurry. Upload a sharper image.", "couple"));
  assert.equal(couple.category, "couple_photos");
  assert.match(couple.coupleMessage, /Couple photo 2 appears blurry/);
  const venue = describeGalleryFailure(
    new ReferenceImageError("At least 5 venue reference photos are required. The venue owner must upload complete venue coverage before generation.", "venue"),
  );
  assert.equal(venue.category, "venue_setup");
  assert.ok(!venue.coupleMessage.includes("owner must upload"));
});

test("a quality failure names the closest scores for the owner only", () => {
  const err = new GalleryQualityError(
    "below floor",
    { ...passingReport, partnerOneLikenessScore: 0.4, pass: false },
    { buffer: Buffer.from("x"), mimeType: "image/jpeg" },
    "gpt-image-2.5-sunburst",
  );
  const failure = describeGalleryFailure(err);
  assert.equal(failure.category, "quality");
  assert.match(failure.detail, /face match 40%/);
  assert.ok(!failure.coupleMessage.includes("%"));
});
