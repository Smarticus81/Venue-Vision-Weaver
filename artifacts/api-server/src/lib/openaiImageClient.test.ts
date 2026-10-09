import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import sharp from "sharp";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.LOG_LEVEL ??= "silent";

const { conformAspectRatio, generateStillWithOpenAi } = await import("./openaiImageClient.js");
const { isModelAvailabilityFailure, StillImageBlockedError, StillImageRequestError } = await import(
  "./stillImageErrors.js"
);
const { generateCinematicStillWithMetadata, configuredImageModelsFromEnv, imageModelFallbackStats } =
  await import("./stillImageClient.js");

/** A noisy JPEG that passes the generated-still checks (size, contrast, sharpness). */
async function renderedStill(width: number, height: number): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function reference(): Promise<{ buffer: Buffer; mimeType: string }> {
  return {
    buffer: await sharp(randomBytes(400 * 400 * 3), { raw: { width: 400, height: 400, channels: 3 } })
      .jpeg()
      .toBuffer(),
    mimeType: "image/jpeg",
  };
}

/**
 * A provider that never answers. AbortSignal.timeout timers do not keep the
 * event loop alive (the server's listener does in production), so hold a
 * ref'd timer until the request is aborted.
 */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    const keepAlive = setTimeout(() => reject(new Error("request was never aborted")), 10_000);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(init.signal!.reason);
    });
  });
}

function b64Response(image: Buffer): Response {
  return new Response(
    JSON.stringify({ data: [{ b64_json: image.toString("base64") }], usage: { input_tokens: 900, output_tokens: 4000 } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("only explicit unavailability moves the chain to the next model", () => {
  assert.equal(isModelAvailabilityFailure(404, ""), true);
  assert.equal(isModelAvailabilityFailure(429, ""), true);
  assert.equal(isModelAvailabilityFailure(503, ""), true);
  assert.equal(isModelAvailabilityFailure(0, ""), true, "no response (timeout/network) falls back");
  assert.equal(
    isModelAvailabilityFailure(400, JSON.stringify({ error: { code: "model_not_found", message: "The model does not exist" } })),
    true,
  );
  assert.equal(
    isModelAvailabilityFailure(400, JSON.stringify({ error: { code: "unsupported_value", param: "quality", message: "model rejects quality" } })),
    false,
    "a bad parameter is a request bug, not a reason to reroute production to a weaker model",
  );
  assert.equal(isModelAvailabilityFailure(400, "Invalid value for 'model' parameter"), false);
  assert.equal(isModelAvailabilityFailure(401, ""), false);
});

test("conformAspectRatio crops a standard-size fallback render to the scene and restores the minimum edge", async () => {
  const standard = await renderedStill(1536, 1024);
  const { buffer, cropped } = await conformAspectRatio(standard, "16:9");
  const meta = await sharp(buffer).metadata();
  assert.equal(cropped, true);
  assert.ok(Math.abs(meta.width! / meta.height! - 16 / 9) < 0.01);
  assert.ok(Math.min(meta.width!, meta.height!) >= 1024);
  const untouched = await conformAspectRatio(await renderedStill(1536, 1536), "1:1");
  assert.equal(untouched.cropped, false);
});

test("a rejected custom size retries once at the standard size", async () => {
  const sizes: string[] = [];
  const rendered = await withFetch(
    (async (_input: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      sizes.push(String(form.get("size")));
      assert.equal(form.get("moderation"), null, "no undocumented moderation override is sent");
      if (sizes.length === 1) {
        return new Response(JSON.stringify({ error: { message: "Invalid size: must be a multiple of 16" } }), { status: 400 });
      }
      return b64Response(await renderedStill(1536, 1024));
    }) as typeof fetch,
    () =>
      generateStillWithOpenAi({
        apiKey: "sk-test",
        model: "gpt-image-2.5-sunburst",
        prompt: "scene",
        aspectRatio: "16:9",
        images: [{ buffer: Buffer.from("x"), filename: "input-1.jpg" }],
      }),
  );
  assert.deepEqual(sizes, ["2048x1152", "1536x1024"]);
  assert.equal(rendered.size, "1536x1024");
  assert.equal(rendered.cropped, true);
  assert.deepEqual(rendered.usage, { inputTokens: 900, outputTokens: 4000 });
});

test("a request that never answers becomes a fallback-eligible timeout error", async () => {
  await withEnv({ OPENAI_IMAGE_TIMEOUT_MS: "40" }, () =>
    withFetch(
      ((_input: string | URL | Request, init?: RequestInit) => hangUntilAborted(init)) as typeof fetch,
      async () => {
        await assert.rejects(
          generateStillWithOpenAi({
            apiKey: "sk-test",
            model: "gpt-image-2.5-sunburst",
            prompt: "scene",
            aspectRatio: "3:4",
            images: [{ buffer: Buffer.from("x"), filename: "input-1.jpg" }],
          }),
          (err: unknown) =>
            err instanceof StillImageRequestError &&
            err.status === 0 &&
            err.timedOut &&
            err.retryWithFallbackModel &&
            err.model === "gpt-image-2.5-sunburst",
        );
      },
    ),
  );
});

test("a content-policy refusal is a blocked error, never a fallback", async () => {
  await withFetch(
    (async () =>
      new Response(JSON.stringify({ error: { code: "moderation_blocked", message: "safety system" } }), {
        status: 400,
      })) as typeof fetch,
    async () => {
      await assert.rejects(
        generateStillWithOpenAi({
          apiKey: "sk-test",
          model: "gpt-image-2.5-sunburst",
          prompt: "scene",
          aspectRatio: "1:1",
          images: [{ buffer: Buffer.from("x"), filename: "input-1.jpg" }],
        }),
        StillImageBlockedError,
      );
    },
  );
});

test("the chain falls back to the next model after a timeout and reports which model rendered", async () => {
  const still = await renderedStill(1536, 1536);
  const couple = [await reference(), await reference()];
  const venue = await reference();
  const models: string[] = [];
  const before = imageModelFallbackStats();
  const result = await withEnv(
    {
      OPENAI_API_KEY: "sk-test",
      OPENAI_API_BASE_URL: "https://mock-openai.invalid/v1",
      OPENAI_IMAGE_TIMEOUT_MS: "40",
      IMAGE_MODELS: "gpt-image-2.5-sunburst,gpt-image-2.5-flare",
    },
    () =>
      withFetch(
        ((_input: string | URL | Request, init?: RequestInit) => {
          const model = String((init?.body as FormData).get("model"));
          models.push(model);
          if (model === "gpt-image-2.5-sunburst") return hangUntilAborted(init);
          return Promise.resolve(b64Response(still));
        }) as typeof fetch,
        () =>
          generateCinematicStillWithMetadata({
            prompt: "scene",
            coupleReference: couple[0]!,
            coupleReferences: couple,
            venueReference: venue,
            venueReferences: [venue],
            aspectRatio: "1:1",
          }),
      ),
  );
  assert.deepEqual(models, ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]);
  assert.equal(result.model, "gpt-image-2.5-flare");
  assert.equal(result.primaryModel, "gpt-image-2.5-sunburst");
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.fallbackFrom, [{ model: "gpt-image-2.5-sunburst", reason: "timeout" }]);
  assert.deepEqual(result.usage, { inputTokens: 900, outputTokens: 4000 });
  assert.equal(imageModelFallbackStats().fallbacks, before.fallbacks + 1);
});

test("a bad-parameter 400 from the primary model fails instead of silently rerouting", async () => {
  const couple = [await reference(), await reference()];
  const models: string[] = [];
  await withEnv(
    {
      OPENAI_API_KEY: "sk-test",
      IMAGE_MODELS: "gpt-image-2.5-sunburst,gpt-image-2.5-flare",
    },
    () =>
      withFetch(
        (async (_input: string | URL | Request, init?: RequestInit) => {
          models.push(String((init?.body as FormData).get("model")));
          return new Response(JSON.stringify({ error: { code: "unsupported_value", param: "input_fidelity" } }), {
            status: 400,
          });
        }) as typeof fetch,
        async () => {
          await assert.rejects(
            generateCinematicStillWithMetadata({
              prompt: "scene",
              coupleReference: couple[0]!,
              coupleReferences: couple,
              venueReference: couple[1]!,
              venueReferences: [couple[1]!],
              aspectRatio: "1:1",
            }),
            (err: unknown) => err instanceof StillImageRequestError && err.status === 400,
          );
        },
      ),
  );
  assert.deepEqual(models, ["gpt-image-2.5-sunburst"]);
});

test("the Gemini fallback sends its key in the x-goog-api-key header, never the URL", async () => {
  const still = await renderedStill(1536, 1536);
  const couple = [await reference(), await reference()];
  const seen: { url: string; key?: string }[] = [];
  const result = await withEnv(
    {
      OPENAI_API_KEY: undefined,
      GOOGLE_AI_API_KEY: "google-test-key",
      GEMINI_API_BASE_URL: "https://mock-gemini.invalid/v1beta",
      IMAGE_MODELS: "gemini-3-pro-image",
    },
    () =>
      withFetch(
        (async (input: string | URL | Request, init?: RequestInit) => {
          seen.push({ url: String(input), key: (init?.headers as Record<string, string>)["x-goog-api-key"] });
          return new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: still.toString("base64") } }] }, finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 1300 },
            }),
            { status: 200 },
          );
        }) as typeof fetch,
        () =>
          generateCinematicStillWithMetadata({
            prompt: "scene",
            coupleReference: couple[0]!,
            coupleReferences: couple,
            venueReference: couple[1]!,
            venueReferences: [couple[1]!],
            aspectRatio: "1:1",
          }),
      ),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://mock-gemini.invalid/v1beta/models/gemini-3-pro-image:generateContent");
  assert.equal(seen[0]!.key, "google-test-key");
  assert.equal(result.model, "gemini-3-pro-image");
  assert.deepEqual(result.usage, { inputTokens: 1200, outputTokens: 1300 });
});

test("configuredImageModelsFromEnv reads the provider-neutral chain with legacy fallbacks", () => {
  assert.deepEqual(configuredImageModelsFromEnv({}), [
    "gpt-image-2.5-sunburst",
    "gpt-image-2.5-flare",
    "gemini-3-pro-image",
  ]);
  assert.deepEqual(configuredImageModelsFromEnv({ IMAGE_MODEL: "gpt-image-2.5-flare", IMAGE_FALLBACK_MODELS: "gpt-image-2.5-flare,gemini-3-pro-image" }), [
    "gpt-image-2.5-flare",
    "gemini-3-pro-image",
  ]);
  assert.deepEqual(configuredImageModelsFromEnv({ IMAGE_MODELS: " a , b " }), ["a", "b"]);
});
