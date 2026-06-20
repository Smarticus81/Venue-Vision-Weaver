import assert from "node:assert/strict";
import fs from "node:fs";
import sharp from "sharp";

const uploadTokenModule = (await import(
  new URL("../../artifacts/api-server/src/lib/uploadToken.ts", import.meta.url).href
)) as {
  createCoupleUploadToken: (venueSlug: string, now?: number) => string;
  verifyCoupleUploadToken: (token: string, venueSlug: string, now?: number) => boolean;
};

const { createCoupleUploadToken, verifyCoupleUploadToken } = uploadTokenModule;

const objectAccessModule = (await import(
  new URL("../../artifacts/api-server/src/lib/objectAccess.ts", import.meta.url).href
)) as {
  canReadVenueMediaReference: (params: {
    publicVenueSlug?: string | null;
    venueSlug: string;
    ownerEmail?: string | null;
    venueOwnerEmail?: string | null;
  }) => boolean;
};

const { canReadVenueMediaReference } = objectAccessModule;

const venueMediaCoverageModule = (await import(
  new URL("../../artifacts/api-server/src/lib/venueMediaCoverage.ts", import.meta.url).href
)) as {
  VENUE_MEDIA_COVERAGES: readonly string[];
  venueMediaCoverageStatus: (media: Array<{ coverage?: string | null }>) => {
    ready: boolean;
    missing: string[];
  };
  preferredVenueCoveragesForScene: (sceneId: string) => string[];
};

const {
  VENUE_MEDIA_COVERAGES,
  venueMediaCoverageStatus,
  preferredVenueCoveragesForScene,
} = venueMediaCoverageModule;

const venueReferenceSelectorModule = (await import(
  new URL("../../artifacts/api-server/src/lib/venueReferenceSelector.ts", import.meta.url).href
)) as {
  rankVenueReferencesForScene: (
    scene: {
      id: string;
      title: string;
      aspectRatio: "1:1" | "3:4" | "4:3" | "16:9" | "9:16";
      coupleAction: string;
      venueBeat: string;
    },
    venueRefs: Array<{ buffer: Buffer; mimeType: string; coverage?: string | null }>,
  ) => Promise<number[]>;
};

const { rankVenueReferencesForScene } = venueReferenceSelectorModule;

const galleryQualityModule = (await import(
  new URL("../../artifacts/api-server/src/lib/galleryQuality.ts", import.meta.url).href
)) as {
  GalleryQualityError: new (
    message: string,
    report: {
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
    },
  ) => Error;
  qualityRetryGuidanceForError: (err: unknown) => string | null;
};

const { GalleryQualityError, qualityRetryGuidanceForError } = galleryQualityModule;

const stillImageModule = (await import(
  new URL("../../artifacts/api-server/src/lib/stillImageClient.ts", import.meta.url).href
)) as {
  configuredImageModels: () => string[];
  generateCinematicStillWithMetadata: (params: {
    prompt: string;
    coupleReference: { buffer: Buffer; mimeType: string };
    coupleReferences?: { buffer: Buffer; mimeType: string }[];
    venueReference: { buffer: Buffer; mimeType: string; coverage?: string | null };
    venueReferences?: { buffer: Buffer; mimeType: string; coverage?: string | null }[];
    aspectRatio: "1:1" | "3:4" | "4:3" | "16:9" | "9:16";
  }) => Promise<{ buffer: Buffer; model: string }>;
};

const { configuredImageModels, generateCinematicStillWithMetadata } = stillImageModule;

const motionReelModule = (await import(
  new URL("../../artifacts/api-server/src/lib/motionReel.ts", import.meta.url).href
)) as {
  assertUsableMotionReel: (buffer: Buffer) => void;
  buildReelTitleCard: (options: { venueName?: string | null }) => Promise<Buffer | null>;
  ffmpegExecutable: () => string;
};

const { assertUsableMotionReel, buildReelTitleCard, ffmpegExecutable } = motionReelModule;

const envValidationModule = (await import(
  new URL("../../artifacts/api-server/src/lib/envValidation.ts", import.meta.url).href
)) as {
  validateProductionEnvironment: (env: Record<string, string | undefined>) => string[];
};

const { validateProductionEnvironment } = envValidationModule;

const httpSecurityModule = (await import(
  new URL("../../artifacts/api-server/src/lib/httpSecurity.ts", import.meta.url).href
)) as {
  allowedCorsOrigins: (env: NodeJS.ProcessEnv) => Set<string>;
  isCorsOriginAllowed: (origin: string | undefined, env: NodeJS.ProcessEnv) => boolean;
};

const { allowedCorsOrigins, isCorsOriginAllowed } = httpSecurityModule;

const rateLimitModule = (await import(
  new URL("../../artifacts/api-server/src/lib/rateLimit.ts", import.meta.url).href
)) as {
  clientKey: (req: {
    ip?: string;
    socket: { remoteAddress?: string };
    headers: Record<string, string | string[] | undefined>;
  }) => string;
};

const { clientKey } = rateLimitModule;

const trustProxyModule = (await import(
  new URL("../../artifacts/api-server/src/lib/trustProxy.ts", import.meta.url).href
)) as {
  trustProxySetting: (env?: NodeJS.ProcessEnv) => boolean | number | string;
};

const { trustProxySetting } = trustProxyModule;

const sessionCleanupModule = (await import(
  new URL("../../artifacts/api-server/src/lib/sessionCleanupConfig.ts", import.meta.url).href
)) as {
  ownerAuthCleanupBatchSize: (env?: NodeJS.ProcessEnv) => number;
  staleProcessingSessionMinutes: (env?: NodeJS.ProcessEnv) => number;
  uploadIntentCleanupBatchSize: (env?: NodeJS.ProcessEnv) => number;
};

const { ownerAuthCleanupBatchSize, staleProcessingSessionMinutes, uploadIntentCleanupBatchSize } =
  sessionCleanupModule;

const sessionVisibilityModule = (await import(
  new URL("../../artifacts/api-server/src/lib/sessionVisibility.ts", import.meta.url).href
)) as {
  canExposeGeneratedAssetsToSharePage: (status: string) => boolean;
  canReadGeneratedAssetWithShareToken: (
    status: string,
    assets: Array<{ assetType: string; displayOrder: number }>,
  ) => boolean;
  hasCompletePublicGalleryAssets: (
    assets: Array<{ assetType: string; displayOrder: number }>,
  ) => boolean;
};

const {
  canExposeGeneratedAssetsToSharePage,
  canReadGeneratedAssetWithShareToken,
  hasCompletePublicGalleryAssets,
} = sessionVisibilityModule;

const referenceQualityModule = (await import(
  new URL("../../artifacts/api-server/src/lib/referenceImageQuality.ts", import.meta.url).href
)) as {
  assertReferenceImageQuality: (params: {
    buffer: Buffer;
    label: string;
    minEdgePx: number;
    profile: "couple" | "venue";
  }) => Promise<{ perceptualHash: string; sharpness: number; brightness: number; contrast: number }>;
  hammingDistance: (a: string, b: string) => number;
};

const { assertReferenceImageQuality, hammingDistance } = referenceQualityModule;

const venueResponseModule = (await import(
  new URL("../../artifacts/api-server/src/lib/venueResponse.ts", import.meta.url).href
)) as {
  ownerVenueResponse: (venue: {
    id: number;
    name: string;
    slug: string;
    tagline: string | null;
    description: string | null;
    ownerEmail: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    websiteUrl: string | null;
    bookingUrl: string | null;
    plan: string;
    creditsBalance: number;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    billingPeriodEnd: Date | null;
    createdAt: Date;
  }) => Record<string, unknown>;
};

const { ownerVenueResponse } = venueResponseModule;

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  UPLOAD_TOKEN_SECRET: process.env.UPLOAD_TOKEN_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  OWNER_SESSION_SECRET: process.env.OWNER_SESSION_SECRET,
  GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
  GEMINI_API_BASE_URL: process.env.GEMINI_API_BASE_URL,
  GEMINI_IMAGE_MODELS: process.env.GEMINI_IMAGE_MODELS,
  GEMINI_IMAGE_MODEL: process.env.GEMINI_IMAGE_MODEL,
  NANO_BANANA_MODEL: process.env.NANO_BANANA_MODEL,
  GEMINI_IMAGE_FALLBACK_MODELS: process.env.GEMINI_IMAGE_FALLBACK_MODELS,
  GEMINI_USE_INTERACTIONS_API: process.env.GEMINI_USE_INTERACTIONS_API,
  FFMPEG_PATH: process.env.FFMPEG_PATH,
};
const originalFetch = globalThis.fetch;

const objectStorageSource = fs.readFileSync(
  new URL("../../artifacts/api-server/src/lib/objectStorage.ts", import.meta.url),
  "utf8",
);
const storageRouteSource = fs.readFileSync(
  new URL("../../artifacts/api-server/src/routes/storage.ts", import.meta.url),
  "utf8",
);
const gallerySessionPipelineSource = fs.readFileSync(
  new URL("../../artifacts/api-server/src/lib/gallerySessionPipeline.ts", import.meta.url),
  "utf8",
);
const rateLimitSource = fs.readFileSync(
  new URL("../../artifacts/api-server/src/lib/rateLimit.ts", import.meta.url),
  "utf8",
);

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function svgImage(label: string): Buffer {
  const filler = "x".repeat(45_000);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
      `<rect width="1024" height="1024" fill="#f4efe8"/>` +
      `<circle cx="512" cy="420" r="220" fill="#b8955a" opacity="0.55"/>` +
      `<text x="512" y="532" font-size="72" text-anchor="middle" fill="#24211d">${label}</text>` +
      `<!--${filler}-->` +
      `</svg>`,
    "utf8",
  );
}

async function referenceQualityImage(kind: "good" | "dark" | "washed" | "blurry"): Promise<Buffer> {
  if (kind === "dark") {
    return sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: "#080808",
      },
    })
      .jpeg()
      .toBuffer();
  }
  if (kind === "washed") {
    return sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 3,
        background: "#fbfbfb",
      },
    })
      .jpeg()
      .toBuffer();
  }

  const cells: string[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const fill = (x + y) % 2 === 0 ? "#f2eadf" : "#4d3428";
      cells.push(`<rect x="${x * 64}" y="${y * 64}" width="64" height="64" fill="${fill}"/>`);
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
    cells.join("") +
    `<circle cx="512" cy="512" r="190" fill="#c08a6a"/>` +
    `<path d="M330 725 C460 600 560 600 700 725" fill="none" stroke="#1e1714" stroke-width="38" stroke-linecap="round"/>` +
    `</svg>`;
  const image = sharp(Buffer.from(svg)).jpeg();
  return (kind === "blurry" ? image.blur(30) : image).toBuffer();
}

try {
  process.env.NODE_ENV = "test";
  process.env.UPLOAD_TOKEN_SECRET = "test-secret-one";
  delete process.env.SESSION_SECRET;
  delete process.env.OWNER_SESSION_SECRET;
  delete process.env.GEMINI_IMAGE_MODELS;
  delete process.env.GEMINI_IMAGE_MODEL;
  delete process.env.NANO_BANANA_MODEL;
  delete process.env.GEMINI_IMAGE_FALLBACK_MODELS;

  const now = 1_000;
  const slug = "rosewood-estate";
  const token = createCoupleUploadToken(slug, now);

  assert.equal(verifyCoupleUploadToken(token, slug, now), true, "valid upload token");
  assert.equal(
    verifyCoupleUploadToken(token, "other-venue", now),
    false,
    "token is scoped to one venue",
  );
  assert.equal(
    verifyCoupleUploadToken(token, slug, now + 21 * 60 * 1_000),
    false,
    "token expires after the upload window",
  );
  assert.equal(verifyCoupleUploadToken("not-a-token", slug, now), false, "malformed token");

  const [encoded, signature] = token.split(".");
  assert.ok(encoded && signature, "token has payload and signature");
  const tamperedPayload = Buffer.from(`couple:${slug}:999999999`, "utf8").toString("base64url");
  assert.equal(
    verifyCoupleUploadToken(`${tamperedPayload}.${signature}`, slug, now),
    false,
    "tampered payload is rejected",
  );
  assert.equal(
    verifyCoupleUploadToken(`${encoded}.bad-signature`, slug, now),
    false,
    "tampered signature is rejected",
  );

  process.env.UPLOAD_TOKEN_SECRET = "test-secret-two";
  assert.equal(
    verifyCoupleUploadToken(token, slug, now),
    false,
    "secret rotation invalidates old upload tokens",
  );

  assert.equal(
    canReadVenueMediaReference({ publicVenueSlug: slug, venueSlug: slug }),
    true,
    "public venue media reads require the matching venue slug context",
  );
  assert.equal(
    canReadVenueMediaReference({ publicVenueSlug: "other-venue", venueSlug: slug }),
    false,
    "public venue media reads reject mismatched venue slug context",
  );
  assert.equal(
    canReadVenueMediaReference({
      venueSlug: slug,
      ownerEmail: "Owner@Venue.com",
      venueOwnerEmail: "owner@venue.com",
    }),
    true,
    "owner sessions can read their own venue media",
  );
  assert.equal(
    canReadVenueMediaReference({
      venueSlug: slug,
      ownerEmail: "intruder@example.com",
      venueOwnerEmail: "owner@venue.com",
    }),
    false,
    "other owners cannot read venue media by object path",
  );
  assert.deepEqual(
    VENUE_MEDIA_COVERAGES,
    ["exterior", "ceremony", "reception", "detail", "natural_light"],
    "venue media coverage contract captures the five required venue reference roles",
  );
  assert.equal(
    venueMediaCoverageStatus(VENUE_MEDIA_COVERAGES.map((coverage) => ({ coverage }))).ready,
    true,
    "venue media coverage is ready only when every required role is present",
  );
  assert.deepEqual(
    venueMediaCoverageStatus([
      { coverage: "exterior" },
      { coverage: "ceremony" },
      { coverage: "reception" },
      { coverage: "detail" },
    ]).missing,
    ["natural_light"],
    "venue media coverage reports the specific missing reference role",
  );
  assert.deepEqual(
    preferredVenueCoveragesForScene("grand-venue").slice(0, 3),
    ["exterior", "ceremony", "reception"],
    "grand venue scenes prioritize broad venue anchor coverage before visual fallback ranking",
  );
  const originalGoogleKeyForSelector = process.env.GOOGLE_AI_API_KEY;
  const originalGeminiKeyForSelector = process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const shuffledVenueRefs = [
      { buffer: Buffer.from("detail"), mimeType: "image/jpeg", coverage: "detail" },
      { buffer: Buffer.from("reception"), mimeType: "image/jpeg", coverage: "reception" },
      { buffer: Buffer.from("exterior"), mimeType: "image/jpeg", coverage: "exterior" },
      { buffer: Buffer.from("natural"), mimeType: "image/jpeg", coverage: "natural_light" },
      { buffer: Buffer.from("ceremony"), mimeType: "image/jpeg", coverage: "ceremony" },
    ];
    assert.deepEqual(
      (
        await rankVenueReferencesForScene(
          {
            id: "grand-venue",
            title: "Grand Venue",
            aspectRatio: "16:9",
            coupleAction: "Wide architecture with couple",
            venueBeat: "The venue dominates the frame.",
          },
          shuffledVenueRefs,
        )
      ).slice(0, 4),
      [2, 4, 1, 3],
      "venue reference selector fallback ranks shuffled media by scene-specific coverage metadata",
    );
  } finally {
    if (originalGoogleKeyForSelector === undefined) {
      delete process.env.GOOGLE_AI_API_KEY;
    } else {
      process.env.GOOGLE_AI_API_KEY = originalGoogleKeyForSelector;
    }
    if (originalGeminiKeyForSelector === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKeyForSelector;
    }
  }

  const productionEnv = {
    NODE_ENV: "production",
    PORT: "5000",
    DATABASE_URL: "postgresql://user:pass@aws-0-us.pooler.supabase.com:5432/postgres?sslmode=require",
    APP_BASE_URL: "https://glimpse.examplevenue.com",
    UPLOAD_TOKEN_SECRET: "long-upload-token-secret",
    SESSION_SECRET: "long-session-secret",
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_service_role_live_key_123",
    STRIPE_SECRET_KEY: "sk_live_1234567890abcdef",
    STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdef",
    STRIPE_PRICE_STARTER_MONTHLY: "price_123starter",
    STRIPE_PRICE_GROWTH_MONTHLY: "price_123growth",
    STRIPE_PRICE_CREDIT_PACK_10: "price_123pack10",
    RESEND_API_KEY: "re_live_real",
    EMAIL_FROM: "glimpse <noreply@examplevenue.com>",
    GOOGLE_AI_API_KEY: "AIzaProductionLikeKey123",
    GEMINI_IMAGE_MODEL: "gemini-3-pro-image",
    GEMINI_IMAGE_FALLBACK_MODELS: "gemini-3.1-flash-image",
    GEMINI_QUALITY_MODEL: "gemini-2.5-pro",
    GEMINI_IMAGE_SIZE: "2K",
    GALLERY_FRAME_ATTEMPTS: "4",
    GALLERY_QUALITY_GATE: "on",
    GENERATED_IMAGE_MIN_EDGE_PX: "1024",
    GENERATED_IMAGE_MIN_CONTRAST: "8",
    GENERATED_IMAGE_MIN_SHARPNESS: "6",
  };
  assert.deepEqual(
    validateProductionEnvironment(productionEnv),
    [],
    "complete production environment passes startup readiness validation",
  );

  const brokenProductionEnv = {
    ...productionEnv,
    APP_BASE_URL: "http://localhost:5000",
    GOOGLE_AI_API_KEY: "",
    GEMINI_API_KEY: "",
    SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    PRIVATE_OBJECT_DIR: "",
    PUBLIC_OBJECT_SEARCH_PATHS: "",
    GALLERY_QUALITY_GATE: "off",
    GALLERY_MIN_LIKENESS_SCORE: "0.6",
    GALLERY_MIN_PARTNER_LIKENESS_SCORE: "0.6",
    GALLERY_MIN_VENUE_SCORE: "0.6",
    GALLERY_MIN_COMPOSITION_SCORE: "0.6",
    GALLERY_FRAME_ATTEMPTS: "1",
    GENERATED_IMAGE_MIN_EDGE_PX: "512",
    GENERATED_IMAGE_MIN_CONTRAST: "2",
    GENERATED_IMAGE_MIN_SHARPNESS: "2",
    GEMINI_IMAGE_MODEL: "gemini-2.5-flash-image",
    GEMINI_QUALITY_MODEL: "gemini-2.5-flash",
    GEMINI_IMAGE_SIZE: "2k",
    GEMINI_API_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
    EMAIL_FROM: "glimpse <onboarding@resend.dev>",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_PRICE_STARTER_MONTHLY: "price_starter",
  };
  const envErrors = validateProductionEnvironment(brokenProductionEnv);
  assert.ok(
    envErrors.some((error) => error.includes("APP_BASE_URL must use https")),
    "production env rejects localhost/non-https public URLs",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GOOGLE_AI_API_KEY or GEMINI_API_KEY")),
    "production env requires Gemini credentials",
  );
  assert.ok(
    envErrors.some((error) => error.includes("Configure either Supabase storage")),
    "production env requires private object storage",
  );
  assert.ok(
    envErrors.some((error) => error.includes("SUPABASE_URL")),
    "production env rejects placeholder Supabase project URLs",
  );
  assert.ok(
    envErrors.some((error) => error.includes("live Stripe secret key")),
    "production env requires live Stripe secret keys",
  );
  assert.ok(
    envErrors.some((error) => error.includes("STRIPE_PRICE_STARTER_MONTHLY")),
    "production env rejects fake Stripe price labels",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GALLERY_QUALITY_GATE")),
    "production env keeps automated quality review enabled",
  );
  assert.ok(
    envErrors.some((error) => error.includes("gemini-3-pro-image")),
    "production env requires the Pro image model first for likeness quality",
  );
  assert.ok(
    envErrors.some((error) => error.includes("Gemini 3 native image models only")),
    "production env rejects lower-reference image fallbacks",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GALLERY_MIN_LIKENESS_SCORE")),
    "production env refuses weakened overall likeness thresholds",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GALLERY_MIN_PARTNER_LIKENESS_SCORE")),
    "production env refuses weakened per-partner likeness thresholds",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GALLERY_MIN_VENUE_SCORE")),
    "production env refuses weakened venue preservation thresholds",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GALLERY_FRAME_ATTEMPTS")),
    "production env requires enough retries for likeness repair",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GENERATED_IMAGE_MIN_EDGE_PX")),
    "production env requires high-resolution generated images",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GENERATED_IMAGE_MIN_CONTRAST")),
    "production env requires a generated-image contrast floor",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GENERATED_IMAGE_MIN_SHARPNESS")),
    "production env requires a generated-image sharpness floor",
  );
  assert.ok(
    envErrors.some((error) => error.includes("GEMINI_QUALITY_MODEL")),
    "production env requires a Pro quality judge",
  );
  assert.ok(
    envErrors.some((error) => error.includes("stable v1 Gemini API")),
    "production env rejects beta Gemini API base URLs",
  );

  const corsEnv = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://glimpse.examplevenue.com",
    RAILWAY_PUBLIC_DOMAIN: "glimpse-production.up.railway.app",
    CORS_ALLOWED_ORIGINS: "https://admin.examplevenue.com, https://kiosk.examplevenue.com/path",
  } as NodeJS.ProcessEnv;
  assert.deepEqual(
    [...allowedCorsOrigins(corsEnv)].sort(),
    [
      "https://admin.examplevenue.com",
      "https://glimpse-production.up.railway.app",
      "https://glimpse.examplevenue.com",
      "https://kiosk.examplevenue.com",
    ],
    "CORS allowlist normalizes configured production origins",
  );
  assert.equal(
    isCorsOriginAllowed("https://glimpse.examplevenue.com", corsEnv),
    true,
    "production CORS allows the configured public app origin",
  );
  assert.equal(
    isCorsOriginAllowed("https://evil.example", corsEnv),
    false,
    "production CORS rejects untrusted browser origins",
  );
  assert.equal(
    isCorsOriginAllowed(undefined, corsEnv),
    true,
    "production CORS still allows same-origin/server-to-server requests without an Origin header",
  );
  assert.equal(
    isCorsOriginAllowed("https://evil.example", { NODE_ENV: "development" } as NodeJS.ProcessEnv),
    true,
    "development CORS stays permissive for local tooling",
  );
  assert.equal(
    clientKey({
      ip: "10.0.0.7",
      socket: { remoteAddress: "10.0.0.8" },
      headers: { "x-forwarded-for": "203.0.113.1, 198.51.100.2" },
    }),
    "10.0.0.7",
    "rate limiting uses Express trusted client IP instead of spoofable forwarded headers",
  );
  assert.equal(
    clientKey({
      ip: "::ffff:192.0.2.10",
      socket: {},
      headers: {},
    }),
    "192.0.2.10",
    "rate limiting normalizes IPv4-mapped IPv6 client addresses",
  );
  assert.equal(
    trustProxySetting({ NODE_ENV: "production", RAILWAY_PUBLIC_DOMAIN: "glimpse.up.railway.app" } as NodeJS.ProcessEnv),
    1,
    "Railway production deployments trust exactly one proxy hop for req.ip",
  );
  assert.equal(
    trustProxySetting({ TRUST_PROXY: "2" } as NodeJS.ProcessEnv),
    2,
    "TRUST_PROXY can override proxy hop count explicitly",
  );
  assert.equal(
    staleProcessingSessionMinutes({} as NodeJS.ProcessEnv),
    90,
    "processing-session cleanup defaults to a gallery-safe stale window",
  );
  assert.equal(
    staleProcessingSessionMinutes({ STALE_PROCESSING_SESSION_MINUTES: "2" } as NodeJS.ProcessEnv),
    15,
    "processing-session cleanup refuses dangerously short stale windows",
  );
  assert.equal(
    staleProcessingSessionMinutes({ STALE_PROCESSING_SESSION_MINUTES: "99999" } as NodeJS.ProcessEnv),
    1440,
    "processing-session cleanup caps stale windows at one day",
  );
  assert.equal(
    staleProcessingSessionMinutes({ STALE_PROCESSING_SESSION_MINUTES: "not-a-number" } as NodeJS.ProcessEnv),
    90,
    "processing-session cleanup ignores invalid stale window config",
  );
  assert.equal(
    uploadIntentCleanupBatchSize({} as NodeJS.ProcessEnv),
    100,
    "expired upload-intent cleanup defaults to a bounded batch",
  );
  assert.equal(
    uploadIntentCleanupBatchSize({ UPLOAD_INTENT_CLEANUP_BATCH_SIZE: "2" } as NodeJS.ProcessEnv),
    10,
    "expired upload-intent cleanup refuses dangerously tiny batches",
  );
  assert.equal(
    uploadIntentCleanupBatchSize({ UPLOAD_INTENT_CLEANUP_BATCH_SIZE: "5000" } as NodeJS.ProcessEnv),
    1000,
    "expired upload-intent cleanup caps startup work",
  );
  assert.equal(
    ownerAuthCleanupBatchSize({} as NodeJS.ProcessEnv),
    500,
    "expired owner-auth cleanup defaults to a bounded batch",
  );
  assert.equal(
    ownerAuthCleanupBatchSize({ OWNER_AUTH_CLEANUP_BATCH_SIZE: "2" } as NodeJS.ProcessEnv),
    50,
    "expired owner-auth cleanup refuses dangerously tiny batches",
  );
  assert.equal(
    ownerAuthCleanupBatchSize({ OWNER_AUTH_CLEANUP_BATCH_SIZE: "99999" } as NodeJS.ProcessEnv),
    5000,
    "expired owner-auth cleanup caps startup work",
  );
  assert.equal(
    canExposeGeneratedAssetsToSharePage("processing"),
    false,
    "share-token session responses do not expose partial generated assets while processing",
  );
  assert.equal(
    canReadGeneratedAssetWithShareToken("processing", [
      { assetType: "image", displayOrder: 1 },
      { assetType: "image", displayOrder: 2 },
      { assetType: "image", displayOrder: 3 },
      { assetType: "image", displayOrder: 4 },
      { assetType: "video", displayOrder: 0 },
    ]),
    false,
    "share-token object reads reject generated assets until the gallery is ready",
  );
  assert.equal(
    hasCompletePublicGalleryAssets([
      { assetType: "image", displayOrder: 1 },
      { assetType: "image", displayOrder: 2 },
      { assetType: "image", displayOrder: 3 },
      { assetType: "video", displayOrder: 0 },
    ]),
    false,
    "public gallery visibility rejects incomplete V1 asset bundles",
  );
  assert.equal(
    hasCompletePublicGalleryAssets([
      { assetType: "video", displayOrder: 0 },
      { assetType: "image", displayOrder: 1 },
      { assetType: "image", displayOrder: 1 },
      { assetType: "image", displayOrder: 2 },
      { assetType: "image", displayOrder: 3 },
    ]),
    false,
    "public gallery visibility rejects duplicate still display slots",
  );
  assert.equal(
    hasCompletePublicGalleryAssets([
      { assetType: "video", displayOrder: 0 },
      { assetType: "image", displayOrder: 1 },
      { assetType: "image", displayOrder: 2 },
      { assetType: "image", displayOrder: 3 },
      { assetType: "image", displayOrder: 4 },
      { assetType: "image", displayOrder: 4 },
    ]),
    false,
    "public gallery visibility rejects extra stills beyond the four-frame V1 contract",
  );
  assert.equal(
    hasCompletePublicGalleryAssets([
      { assetType: "video", displayOrder: 0 },
      { assetType: "video", displayOrder: 0 },
      { assetType: "image", displayOrder: 1 },
      { assetType: "image", displayOrder: 2 },
      { assetType: "image", displayOrder: 3 },
      { assetType: "image", displayOrder: 4 },
    ]),
    false,
    "public gallery visibility rejects extra reels beyond the single motion reel V1 contract",
  );
  const completeGalleryAssets = [
    { assetType: "video", displayOrder: 0 },
    { assetType: "image", displayOrder: 1 },
    { assetType: "image", displayOrder: 2 },
    { assetType: "image", displayOrder: 3 },
    { assetType: "image", displayOrder: 4 },
  ];
  assert.equal(
    hasCompletePublicGalleryAssets(completeGalleryAssets),
    true,
    "public gallery visibility accepts four stills plus one motion reel",
  );
  const resetStuckSessionSource = fs.readFileSync(
    new URL("../../scripts/reset-stuck-session.cjs", import.meta.url),
    "utf8",
  );
  assert.match(
    resetStuckSessionSource,
    /mode === "ready"[\s\S]*COUNT\(\*\) AS total_assets[\s\S]*asset_type = 'image' AND display_order IN \(1, 2, 3, 4\)[\s\S]*asset_type = 'video' AND display_order = 0[\s\S]*total_assets = 5[\s\S]*required_stills = 4[\s\S]*required_reels = 1/s,
    "manual stuck-session ready reset requires the complete V1 gallery bundle",
  );
  assert.equal(
    canExposeGeneratedAssetsToSharePage("ready"),
    true,
    "share-token session responses expose generated assets after the gallery is ready",
  );
  assert.equal(
    canReadGeneratedAssetWithShareToken("ready", completeGalleryAssets),
    true,
    "share-token object reads allow generated assets after the ready gallery has a complete asset bundle",
  );
  const titleCard = await buildReelTitleCard({ venueName: "Willow & Stone <Estate>" });
  assert.ok(titleCard, "branded motion reel title card is produced when a venue name exists");
  const titleCardMeta = await sharp(titleCard).metadata();
  assert.equal(titleCardMeta.width, 1280, "motion reel title card uses 16:9 HD width");
  assert.equal(titleCardMeta.height, 720, "motion reel title card uses 16:9 HD height");
  await assert.rejects(
    async () => assertUsableMotionReel(Buffer.from("not-an-mp4")),
    /unusably small|valid MP4/,
    "motion reel validator rejects invalid stored video buffers",
  );
  delete process.env.FFMPEG_PATH;
  assert.equal(ffmpegExecutable(), "ffmpeg", "motion reel renderer uses PATH ffmpeg by default");
  process.env.FFMPEG_PATH = "C:/tools/ffmpeg/bin/ffmpeg.exe";
  assert.equal(
    ffmpegExecutable(),
    "C:/tools/ffmpeg/bin/ffmpeg.exe",
    "motion reel renderer honors FFMPEG_PATH for production deployments",
  );
  const creditsSchema = fs.readFileSync(
    new URL("../../lib/db/src/schema/credits.ts", import.meta.url),
    "utf8",
  );
  const bootstrapSql = fs.readFileSync(
    new URL("../../supabase/bootstrap.sql", import.meta.url),
    "utf8",
  );
  const productionPreflightSql = fs.readFileSync(
    new URL("../../supabase/production-v1-preflight.sql", import.meta.url),
    "utf8",
  );
  assert.match(
    creditsSchema,
    /credit_transactions_stripe_event_id_unique[\s\S]*IS NOT NULL/,
    "Drizzle credit schema keeps Stripe event idempotency unique only for non-null event IDs",
  );
  assert.match(
    bootstrapSql,
    /credit_transactions_stripe_event_id_unique[\s\S]*WHERE stripe_event_id IS NOT NULL/i,
    "Supabase bootstrap keeps Stripe event idempotency unique only for non-null event IDs",
  );
  assert.match(
    bootstrapSql,
    /generated_assets_object_key_unique[\s\S]*ON generated_assets \(object_key\)[\s\S]*generated_assets_session_slot_unique[\s\S]*ON generated_assets \(session_id, asset_type, display_order\)/i,
    "Supabase bootstrap enforces unique generated asset object keys and one asset per session slot",
  );
  assert.match(
    bootstrapSql,
    /CREATE TABLE IF NOT EXISTS upload_intents[\s\S]*object_key TEXT NOT NULL[\s\S]*venue_id INTEGER NOT NULL REFERENCES venues\(id\)[\s\S]*purpose TEXT NOT NULL[\s\S]*consumed_at TIMESTAMP/i,
    "Supabase bootstrap records authorized upload intents before objects can be attached to venues or sessions",
  );
  assert.match(
    bootstrapSql,
    /CREATE TABLE IF NOT EXISTS venue_media[\s\S]*coverage TEXT NOT NULL DEFAULT 'detail'[\s\S]*ALTER TABLE venue_media[\s\S]*ADD COLUMN IF NOT EXISTS coverage TEXT NOT NULL DEFAULT 'detail'/i,
    "Supabase bootstrap persists required venue photo coverage metadata",
  );
  assert.match(
    bootstrapSql,
    /owner_email TEXT NOT NULL[\s\S]*ALTER TABLE venues[\s\S]*ALTER COLUMN owner_email SET NOT NULL[\s\S]*couple_email TEXT NOT NULL[\s\S]*share_token TEXT NOT NULL UNIQUE[\s\S]*ALTER TABLE couple_sessions[\s\S]*ALTER COLUMN couple_email SET NOT NULL[\s\S]*ALTER COLUMN share_token SET NOT NULL/i,
    "Supabase bootstrap enforces owner email, couple email, and share token nullability required by V1",
  );
  assert.match(
    productionPreflightSql,
    /venues_missing_owner_email[\s\S]*couple_sessions_missing_couple_email[\s\S]*couple_sessions_missing_share_token[\s\S]*duplicate_generated_asset_object_keys[\s\S]*duplicate_generated_asset_session_slots/s,
    "production V1 preflight reports legacy rows that would block required identity and gallery asset constraints",
  );
  assert.match(
    productionPreflightSql,
    /venue_media_missing_or_invalid_coverage[\s\S]*venues_missing_required_media_coverage/s,
    "production V1 preflight reports venues that need explicit media coverage before launch",
  );
  const uploadSchema = fs.readFileSync(
    new URL("../../lib/db/src/schema/uploads.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    uploadSchema,
    /uploadIntentsTable[\s\S]*objectKey: text\("object_key"\)\.notNull\(\)[\s\S]*venueId: integer\("venue_id"\)\.notNull\(\)[\s\S]*purpose: text\("purpose"\)\.notNull\(\)[\s\S]*consumedAt: timestamp\("consumed_at"\)/s,
    "Drizzle schema includes venue-scoped upload intents with purpose and consumed state",
  );
  assert.match(
    objectStorageSource,
    /assertNormalizedUploadObjectPath\(objectPath: string\)[\s\S]*\/objects\\\/uploads[\s\S]*objectPath\.includes\("\.\."\)[\s\S]*objectPath\.includes\("\\\\"\)[\s\S]*invalid private upload object path/s,
    "object storage validates normalized private upload object paths",
  );
  const storageRoute = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/storage.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    storageRoute,
    /requireOwnerVenue\(req, res, venueSlug\)[\s\S]*verifyCoupleUploadToken\(uploadToken, venueSlug\)[\s\S]*db\.insert\(uploadIntentsTable\)\.values\({[\s\S]*objectKey: objectPath[\s\S]*venueId[\s\S]*purpose[\s\S]*contentType[\s\S]*sizeBytes: size[\s\S]*expiresAt/s,
    "upload URL requests authenticate owner/couple context and persist venue-scoped upload intents",
  );
  assert.match(
    storageRouteSource,
    /normalizeObjectEntityPath\(uploadURL\);\s*assertNormalizedUploadObjectPath\(objectPath\);[\s\S]*db\.insert\(uploadIntentsTable\)/s,
    "upload URL route validates normalized object paths before storing upload intents",
  );
  assert.match(
    gallerySessionPipelineSource,
    /normalizeObjectEntityPath\(uploadURL\);\s*assertNormalizedUploadObjectPath\(objectKey\);[\s\S]*fetch\(uploadURL/s,
    "gallery generation validates normalized object paths before uploading generated assets",
  );
  assert.match(
    gallerySessionPipelineSource,
    /selectVenueMediaForGeneration\(media:[\s\S]*for \(const coverage of VENUE_MEDIA_COVERAGES\)[\s\S]*media\.find\(\(item\) => item\.coverage === coverage\)[\s\S]*selected\.slice\(0, MAX_VENUE_REFERENCES_FOR_GALLERY\)[\s\S]*selectVenueMediaForGeneration\(venueMedia\)\.map/s,
    "gallery generation includes one venue media item per required coverage before filling extra reference slots",
  );
  assert.equal(
    /venueMedia\.slice\(0, MAX_VENUE_REFERENCES_FOR_GALLERY\)\.map/.test(gallerySessionPipelineSource),
    false,
    "gallery generation does not pre-slice venue media before preserving required coverage",
  );
  const uploadHookSource = fs.readFileSync(
    new URL("../../lib/object-storage-web/src/use-upload.ts", import.meta.url),
    "utf8",
  );
  const objectUploaderSource = fs.readFileSync(
    new URL("../../lib/object-storage-web/src/ObjectUploader.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    uploadHookSource,
    /MAX_IMAGE_UPLOAD_BYTES = 8 \* 1024 \* 1024[\s\S]*MIN_IMAGE_EDGE_PX = 1024[\s\S]*assertValidImageUpload\(file\)[\s\S]*fetch\(`\$\{basePath\}\/uploads\/request-url`/s,
    "shared upload hook validates image type, size, and dimensions before requesting upload URLs",
  );
  assert.match(
    objectUploaderSource,
    /maxFileSize = 8 \* 1024 \* 1024[\s\S]*allowedFileTypes = \["image\/jpeg", "image\/png", "image\/webp"\][\s\S]*allowedFileTypes/s,
    "Uppy uploader defaults match the production image upload type and size contract",
  );
  const databaseReadinessSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/databaseReadiness.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    databaseReadinessSource,
    /REQUIRED_DATABASE_TABLES[\s\S]*"upload_intents"[\s\S]*missingRequiredDatabaseTables[\s\S]*information_schema\.tables/s,
    "database readiness checks include the upload_intents table required by production upload security",
  );
  assert.match(
    databaseReadinessSource,
    /REQUIRED_DATABASE_COLUMNS[\s\S]*generated_assets[\s\S]*quality_report[\s\S]*owner_login_tokens[\s\S]*token_hash[\s\S]*owner_sessions[\s\S]*session_hash[\s\S]*missingRequiredDatabaseColumns[\s\S]*information_schema\.columns/s,
    "database readiness checks launch-critical owner auth and gallery metadata columns",
  );
  assert.match(
    databaseReadinessSource,
    /venue_media: \["id", "venue_id", "object_key", "coverage", "display_order", "created_at"\][\s\S]*REQUIRED_DATABASE_NOT_NULL_COLUMNS[\s\S]*venue_media: \["id", "venue_id", "object_key", "coverage", "display_order", "created_at"\]/s,
    "database readiness requires non-null venue media coverage metadata",
  );
  assert.match(
    databaseReadinessSource,
    /REQUIRED_DATABASE_NOT_NULL_COLUMNS[\s\S]*venues:[\s\S]*owner_email[\s\S]*couple_sessions:[\s\S]*couple_email[\s\S]*share_token[\s\S]*owner_login_tokens[\s\S]*token_hash[\s\S]*owner_sessions[\s\S]*revoked[\s\S]*nullableRequiredDatabaseColumns[\s\S]*is_nullable/s,
    "database readiness checks launch-critical venue owner, session identity, and owner-auth not-null column constraints",
  );
  assert.match(
    databaseReadinessSource,
    /REQUIRED_DATABASE_INDEXES[\s\S]*venues\.slug\.unique[\s\S]*upload_intents_object_key_unique[\s\S]*generated_assets_object_key_unique[\s\S]*generated_assets_session_slot_unique[\s\S]*credit_transactions_stripe_event_id_unique[\s\S]*is not null[\s\S]*owner_login_tokens\.token_hash\.unique[\s\S]*owner_sessions\.session_hash\.unique[\s\S]*missingRequiredDatabaseIndexes[\s\S]*pg_indexes/s,
    "database readiness checks public slug, upload, gallery asset, owner-auth, and Stripe webhook uniqueness indexes",
  );
  assert.match(
    databaseReadinessSource,
    /missingRequiredDatabaseSchema\(\)[\s\S]*missingRequiredDatabaseTables\(\)[\s\S]*missingRequiredDatabaseColumns\(\)[\s\S]*nullableRequiredDatabaseColumns\(\)[\s\S]*missingRequiredDatabaseIndexes\(\)/s,
    "database readiness exposes a full schema contract for production deployment checks",
  );
  const healthRoute = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/health.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    healthRoute,
    /missingRequiredDatabaseSchema\(\)[\s\S]*checks\.database = missingSchema\.length === 0 \? "ok" : "degraded"/s,
    "readiness endpoint degrades when required production database schema items are missing",
  );
  assert.match(
    healthRoute,
    /productionImageModelChainReady[\s\S]*models\[0\] === "gemini-3-pro-image"[\s\S]*models\.every[\s\S]*gemini-3[\s\S]*imageModel: productionImageModelChainReady\(\) \? "ok" : "degraded"/s,
    "readiness endpoint degrades when the production image model chain leaves Gemini 3 native image models",
  );
  const productionVerifier = fs.readFileSync(
    new URL("../../scripts/src/verify-production.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    productionVerifier,
    /checkDatabaseSchema[\s\S]*missingRequiredDatabaseSchema\(\)[\s\S]*Missing required schema items[\s\S]*tables, columns, and indexes[\s\S]*await checkDatabaseSchema\(\)/s,
    "production verifier checks required database tables, columns, and indexes before launch",
  );
  assert.match(
    productionVerifier,
    /checkSecuritySmoke[\s\S]*security-smoke\.ts[\s\S]*Gallery, auth, storage, billing, and source-contract smoke suite passed[\s\S]*await checkSecuritySmoke\(\)/s,
    "production verifier runs the source-contract smoke suite before launch",
  );
  assert.match(
    productionVerifier,
    /railwayUsesDockerfile[\s\S]*dockerfileInstallsFfmpeg[\s\S]*Railway deploys the Dockerfile and the Dockerfile installs ffmpeg[\s\S]*live --url readiness check still verifies runtime ffmpeg/s,
    "production verifier accepts Dockerfile-provisioned ffmpeg while preserving live runtime readiness verification",
  );
  assert.match(
    productionVerifier,
    /function checkGalleryQaEvidence[\s\S]*--skip-qa[\s\S]*--qa-report[\s\S]*manual-acceptance\.json[\s\S]*summary\?\.automatedPass !== true[\s\S]*manual acceptance is not true[\s\S]*checkGalleryQaEvidence\(\)/s,
    "production verifier requires automated gallery QA evidence and manual acceptance before launch",
  );
  assert.match(
    productionVerifier,
    /inputs\?: \{[\s\S]*consentConfirmed\?: unknown;[\s\S]*couple\?: unknown;[\s\S]*venue\?: unknown;[\s\S]*consentConfirmed !== true[\s\S]*consented couple and venue references/s,
    "production verifier requires gallery QA reports to confirm consented references",
  );
  assert.match(
    productionVerifier,
    /function isSha256[\s\S]*\^\[a-f0-9\]\{64\}\$[\s\S]*hasValidReferenceFingerprints\(report\.inputs\?\.couple, 2, 3\)[\s\S]*hasValidReferenceFingerprints\(report\.inputs\?\.venue, 5\)/s,
    "production verifier requires agent-readable SHA-256 fingerprints for QA input references",
  );
  const envExample = fs.readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
  const railwayEnvTemplate = fs.readFileSync(
    new URL("../../railway.env.template", import.meta.url),
    "utf8",
  );
  const galleryQaDocs = fs.readFileSync(
    new URL("../../docs/gallery-qa.md", import.meta.url),
    "utf8",
  );
  const galleryQaSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/tools/galleryQa.ts", import.meta.url),
    "utf8",
  );
  const openApiSpec = fs.readFileSync(
    new URL("../../lib/api-spec/openapi.yaml", import.meta.url),
    "utf8",
  );
  const productionReadinessDocs = fs.readFileSync(
    new URL("../../docs/production-readiness.md", import.meta.url),
    "utf8",
  );
  for (const [label, source] of [
    [".env.example", envExample],
    ["railway.env.template", railwayEnvTemplate],
    ["gallery QA docs", galleryQaDocs],
  ] as const) {
    assert.match(
      source,
      /GALLERY_FRAME_ATTEMPTS=4[\s\S]*GALLERY_MIN_LIKENESS_SCORE=0\.82[\s\S]*GALLERY_MIN_PARTNER_LIKENESS_SCORE=0\.78[\s\S]*GALLERY_MIN_VENUE_SCORE=0\.80[\s\S]*GALLERY_MIN_COMPOSITION_SCORE=0\.74/s,
      `${label} documents the production likeness and venue quality floor`,
    );
    assert.match(
      source,
      /GENERATED_IMAGE_MIN_CONTRAST=8[\s\S]*GENERATED_IMAGE_MIN_SHARPNESS=6/s,
      `${label} documents the generated-output local quality floor`,
    );
  }
  assert.match(
    railwayEnvTemplate,
    /UPLOAD_TOKEN_SECRET=generate-a-second-long-random-string[\s\S]*SUPABASE_STORAGE_BUCKET=glimpse[\s\S]*SUPABASE_PUBLIC_BUCKET=glimpse-public/s,
    "Railway env template includes authenticated upload token secret and glimpse storage buckets",
  );
  assert.match(
    openApiSpec,
    /VenueMediaItem:[\s\S]*required: \[id, venueId, objectKey, coverage, displayOrder, createdAt\][\s\S]*VenueMediaCoverage:[\s\S]*enum: \[exterior, ceremony, reception, detail, natural_light\][\s\S]*AddVenueMediaBody:[\s\S]*required: \[objectKey, coverage\]/s,
    "OpenAPI requires venue media coverage metadata in media responses and owner upload registration",
  );
  assert.match(
    productionReadinessDocs,
    /production-v1-preflight\.sql[\s\S]*row_count[\s\S]*owner emails[\s\S]*share tokens[\s\S]*venue media coverage metadata[\s\S]*unique\s+generated\s+gallery\s+asset slots/s,
    "production readiness docs require legacy data preflight before the stricter V1 schema contract",
  );
  assert.match(
    productionReadinessDocs,
    /source-contract smoke tests[\s\S]*gallery-only flow[\s\S]*protected\s+storage[\s\S]*Stripe idempotency[\s\S]*quality thresholds/s,
    "production readiness docs include the smoke suite in the runtime launch gate",
  );
  assert.match(
    productionReadinessDocs,
    /workstation without ffmpeg[\s\S]*railway\.toml[\s\S]*Dockerfile[\s\S]*installs ffmpeg[\s\S]*post-deploy `?--url`? readiness check remains mandatory/s,
    "production readiness docs explain Dockerfile-provisioned ffmpeg and live runtime verification",
  );
  assert.match(
    productionReadinessDocs,
    /fewer than 4 frame attempts/,
    "production readiness docs require the production retry floor",
  );
  assert.ok(
    productionReadinessDocs.includes("saved live gallery QA evidence") &&
      productionReadinessDocs.includes("quality-report.json") &&
      productionReadinessDocs.includes("input SHA-256 fingerprints") &&
      productionReadinessDocs.includes("manual acceptance marker") &&
      productionReadinessDocs.includes("manual-acceptance.json") &&
      productionReadinessDocs.includes("--skip-qa") &&
      productionReadinessDocs.includes("not claiming production"),
    "production readiness docs require saved gallery QA evidence and manual acceptance",
  );
  assert.match(
    galleryQaDocs,
    /manual-acceptance\.json[\s\S]*"accepted": true[\s\S]*reviewedBy[\s\S]*production verifier expects the QA report to pass automatically/s,
    "gallery QA docs explain manual acceptance evidence for the production verifier",
  );
  assert.match(
    galleryQaDocs,
    /--consent-confirmed[\s\S]*quality-report\.json[\s\S]*authorized for[\s\S]*inputs\.consentConfirmed/s,
    "gallery QA docs require consent confirmation evidence for production-gated QA",
  );
  assert.match(
    galleryQaDocs,
    /SHA-256 fingerprints[\s\S]*Agentic reviewers[\s\S]*exact consented images[\s\S]*valid SHA-256 fingerprints/s,
    "gallery QA docs explain agentic reviewer fingerprint evidence",
  );
  assert.match(
    galleryQaSource,
    /import\("\.\.\/lib\/referenceImage\.js"\)[\s\S]*assertInputs\(coupleRefs, venueRefs\);\s*await assertReferenceImagesValid\(coupleRefs, venueRefs\);/s,
    "gallery QA harness applies the same production reference-image validation as live sessions",
  );
  assert.match(
    galleryQaSource,
    /--consent-confirmed[\s\S]*!consentConfirmed && !allowNonpassing[\s\S]*Gallery QA requires --consent-confirmed[\s\S]*consentConfirmed: options\.consentConfirmed/s,
    "gallery QA harness records explicit consent confirmation for production-gated runs",
  );
  assert.match(
    galleryQaSource,
    /createHash\("sha256"\)\.update\(buffer\)\.digest\("hex"\)[\s\S]*couple: coupleRefs\.map[\s\S]*sha256: ref\.sha256[\s\S]*venue: venueRefs\.map[\s\S]*sha256: ref\.sha256/s,
    "gallery QA harness records SHA-256 fingerprints for agentic QA evidence",
  );
  assert.match(
    galleryQaSource,
    /VENUE_QA_COVERAGE_ORDER = \[[\s\S]*"exterior"[\s\S]*"ceremony"[\s\S]*"reception"[\s\S]*"detail"[\s\S]*"natural_light"[\s\S]*withVenueCoverage\(rawVenueRefs\)[\s\S]*coverage: venueRefs\[index\]!\.coverage \?\? null/s,
    "gallery QA harness tags local venue references with the same coverage roles used by production generation",
  );
  assert.match(
    galleryQaDocs,
    /same production reference validation as live sessions[\s\S]*at least 1024px on each side[\s\S]*couple references must not be near-duplicates/s,
    "gallery QA docs explain the live-session reference quality requirements",
  );
  assert.match(
    galleryQaDocs,
    /exterior\/facade, ceremony, reception, architectural detail, and natural-light views[\s\S]*local QA harness uses the filename\/order convention above to mirror those coverage slots/s,
    "gallery QA docs explain local venue ordering mirrors production coverage metadata",
  );
  const couplePreviewSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/pages/CouplePage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    couplePreviewSource,
    /COUPLE_REFERENCE_ROLES = \["Together", "Partner A", "Partner B"\][\s\S]*Upload in this order when possible: together, Partner A, then Partner B[\s\S]*distinct angles or expressions/s,
    "couple upload UI guides couples toward ordered partner-specific likeness references",
  );
  assert.match(
    galleryQaDocs,
    /photo 1 both partners together, photo 2 Partner A face-forward, and photo 3 Partner B face-forward/s,
    "gallery QA docs mirror the couple likeness reference guidance",
  );
  const serverIndex = fs.readFileSync(
    new URL("../../artifacts/api-server/src/index.ts", import.meta.url),
    "utf8",
  );
  const ownerAuthSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/ownerAuth.ts", import.meta.url),
    "utf8",
  );
  const venueRoutesSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/venues.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    ownerAuthSource,
    /isOwnerMutationOriginAllowed\(req[\s\S]*process\.env\.NODE_ENV !== "production"[\s\S]*isCorsOriginAllowed\(origin\)[\s\S]*refererOrigin[\s\S]*return false/s,
    "owner cookie mutation guard rejects missing or untrusted production origins",
  );
  assert.match(
    ownerAuthSource,
    /requireOwnerVenue\(req: Request, res: Response, slug: string\)[\s\S]*requireOwnerMutationOrigin\(req, res\)[\s\S]*getOwnerEmailFromRequest/s,
    "owner venue authorization checks request origin before using cookie-backed owner sessions",
  );
  assert.match(
    venueRoutesSource,
    /router\.post\("\/owners\/login"[\s\S]*requireOwnerMutationOrigin\(req, res\)[\s\S]*exchangeOwnerLoginToken\(token\)[\s\S]*res\.cookie\(OWNER_SESSION_COOKIE/s,
    "owner magic-link exchange checks request origin before consuming a token or setting the owner session cookie",
  );
  assert.match(
    venueRoutesSource,
    /router\.post\("\/owners\/logout"[\s\S]*requireOwnerMutationOrigin\(req, res\)[\s\S]*revokeOwnerSession\(req\)/s,
    "owner logout is protected by the same production origin guard as venue mutations",
  );
  assert.match(
    serverIndex,
    /cleanupExpiredUploadIntents[\s\S]*uploadIntentCleanupBatchSize\(\)[\s\S]*isNull\(uploadIntentsTable\.consumedAt\)[\s\S]*lt\(uploadIntentsTable\.expiresAt, new Date\(\)\)[\s\S]*deleteObjectEntity\(intent\.objectKey\)[\s\S]*delete\(uploadIntentsTable\)[\s\S]*cleanupExpiredUploadIntents\(\)/s,
    "server startup deletes expired unconsumed upload intents and their orphaned storage objects",
  );
  assert.match(
    serverIndex,
    /cleanupGeneratedAssetsForSession\(sessionId: number\)[\s\S]*generatedAssetsTable\.objectKey[\s\S]*delete\(generatedAssetsTable\)[\s\S]*deleteObjectEntity\(asset\.objectKey\)[\s\S]*cleanupOrphanedSessions[\s\S]*cleanupGeneratedAssetsForSession\(row\.id\)[\s\S]*refundCreditsForSession\(row\.id\)/s,
    "server startup deletes partial generated gallery assets before refunding stale processing sessions",
  );
  assert.match(
    serverIndex,
    /cleanupExpiredOwnerAuth[\s\S]*ownerAuthCleanupBatchSize\(\)[\s\S]*ownerLoginTokensTable[\s\S]*isNotNull\(ownerLoginTokensTable\.usedAt\)[\s\S]*ownerSessionsTable[\s\S]*eq\(ownerSessionsTable\.revoked, true\)[\s\S]*delete\(ownerLoginTokensTable\)[\s\S]*delete\(ownerSessionsTable\)[\s\S]*cleanupExpiredOwnerAuth\(\)/s,
    "server startup deletes expired or spent owner login tokens and expired or revoked owner sessions",
  );
  assert.match(
    rateLimitSource,
    /pruneExpiredBuckets\(now: number\)[\s\S]*rateBuckets\.size < 10_000[\s\S]*rateBuckets\.delete\(key\)[\s\S]*pruneExpiredBuckets\(now\)/s,
    "in-memory rate limiter prunes expired buckets to avoid unbounded growth on long-lived instances",
  );
  const sessionsRoute = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/sessions.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    sessionsRoute,
    /session = await db\.transaction[\s\S]*update\(venuesTable\)[\s\S]*gte\(venuesTable\.creditsBalance, neededCredits\)[\s\S]*update\(uploadIntentsTable\)[\s\S]*insert\(coupleSessionsTable\)[\s\S]*creditsCharged: neededCredits[\s\S]*insert\(coupleMediaTable\)[\s\S]*creditTransactionsTable/s,
    "session creation atomically checks/debits credits, consumes upload intents, creates the gallery, records couple media, and stores the debit",
  );
  assert.match(
    sessionsRoute,
    /findGalleryStyle\(styleId\)/,
    "session creation rejects invalid gallery styles before charging credits",
  );
  assert.match(
    sessionsRoute,
    /venueMediaForReadiness[\s\S]*select\({ coverage: venueMediaTable\.coverage }\)[\s\S]*venueMediaCoverageStatus\(venueMediaForReadiness\)[\s\S]*if \(!coverage\.ready\)[\s\S]*venueCoverageReadinessMessage\(coverage\.missing\)[\s\S]*const normalizedEmail/s,
    "session creation blocks incomplete venue coverage before debiting credits or consuming couple uploads",
  );
  assert.match(
    sessionsRoute,
    /session\.status !== "ready"[\s\S]*hasReadyEmailGalleryBundle\(session\.id\)[\s\S]*This gallery is not ready to email yet/s,
    "manual gallery email sends are blocked until the ready session has a complete public gallery bundle",
  );
  assert.match(
    sessionsRoute,
    /assertUploadIntentAvailable\(objectKey, venueId, "couple"\)[\s\S]*update\(uploadIntentsTable\)[\s\S]*set\({ consumedAt: new Date\(\) }\)[\s\S]*eq\(uploadIntentsTable\.purpose, "couple"\)[\s\S]*isNull\(uploadIntentsTable\.consumedAt\)[\s\S]*gte\(uploadIntentsTable\.expiresAt, new Date\(\)\)[\s\S]*insert\(coupleMediaTable\)/s,
    "couple session creation only attaches authorized, unexpired, unused couple upload intents",
  );
  assert.match(
    sessionsRoute,
    /readyGalleryThumbnailObjectKey\(sessionId: number, status: string\)[\s\S]*hasCompletePublicGalleryAssets\(assets\)[\s\S]*displayOrder === 1[\s\S]*readyGalleryThumbnailObjectKey\(session\.id, session\.status\)/s,
    "owner session lists only show thumbnails for ready sessions with a complete V1 gallery bundle",
  );
  const venuesRoute = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/venues.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    venuesRoute,
    /assertUploadIntentAvailable\(body\.data\.objectKey, venue\.id, "venue"\)[\s\S]*update\(uploadIntentsTable\)[\s\S]*set\({ consumedAt: new Date\(\) }\)[\s\S]*eq\(uploadIntentsTable\.purpose, "venue"\)[\s\S]*insert\(venueMediaTable\)/s,
    "venue media registration only attaches authorized, unexpired, unused venue upload intents",
  );
  assert.match(
    venuesRoute,
    /insert\(venueMediaTable\)[\s\S]*coverage: body\.data\.coverage[\s\S]*displayOrder: body\.data\.displayOrder/s,
    "venue media registration stores owner-selected coverage metadata for generation reference selection",
  );
  assert.match(
    venuesRoute,
    /assertVenueMediaDistinct[\s\S]*hammingDistance\(newQuality\.perceptualHash, existingQuality\.perceptualHash\)[\s\S]*looks nearly identical[\s\S]*assertVenueMediaDistinct\(venue\.id, body\.data\.objectKey, newQuality\)[\s\S]*insert\(venueMediaTable\)/s,
    "venue media registration rejects near-duplicate venue photos before they can satisfy the five-photo coverage gate",
  );
  assert.match(
    venuesRoute,
    /GET \/venues\/:slug\/media \(owner session\)[\s\S]*router\.get\("\/venues\/:slug\/media"[\s\S]*const venue = await requireOwnerVenue\(req, res, params\.data\.slug\);[\s\S]*where\(eq\(venueMediaTable\.venueId, venue\.id\)\)/s,
    "venue media management list is owner-session protected",
  );
  assert.match(
    venuesRoute,
    /DELETE \/venues\/:slug\/media\/:mediaId \(owner session\)[\s\S]*select\(\)[\s\S]*eq\(venueMediaTable\.venueId, venue\.id\)[\s\S]*deleteObjectEntity\(media\.objectKey\)[\s\S]*delete\(venueMediaTable\)/s,
    "venue media deletion removes the backing storage object before deleting the database row",
  );
  assert.match(
    venuesRoute,
    /readyGalleryThumbnailObjectKey\(sessionId: number, status: string\)[\s\S]*hasCompletePublicGalleryAssets\(assets\)[\s\S]*displayOrder === 1[\s\S]*readyGalleryThumbnailObjectKey\(session\.id, session\.status\)/s,
    "venue dashboard summaries only show thumbnails for ready sessions with a complete V1 gallery bundle",
  );
  assert.match(
    venuesRoute,
    /createOwnerLoginLink\(email, `\/profile\/\$\{venue\.slug\}`\)/s,
    "owner recovery emails route external venue links through owner profile URLs",
  );
  assert.match(
    openApiSpec,
    /\/sessions\/\{id\}:[\s\S]*\$ref: "#\/components\/schemas\/OwnerSessionDetailResponse"[\s\S]*\/sessions\/by-token\/\{shareToken\}:[\s\S]*Never returns PII like coupleEmail[\s\S]*\$ref: "#\/components\/schemas\/SessionDetailResponse"[\s\S]*OwnerSessionDetailResponse:[\s\S]*Only returned from owner-session protected endpoints/s,
    "OpenAPI separates owner session detail with coupleEmail from public token session detail",
  );
  const appUrlSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/appUrl.ts", import.meta.url),
    "utf8",
  );
  const emailSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/emailService.ts", import.meta.url),
    "utf8",
  );
  const billingRoute = fs.readFileSync(
    new URL("../../artifacts/api-server/src/routes/billing.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    appUrlSource,
    /ownerProfileUrlForSlug\(slug: string\): string[\s\S]*\/profile\/\$\{slug\}[\s\S]*ownerDashboardUrlForSlug = ownerProfileUrlForSlug/s,
    "external owner URL helper emits profile URLs while preserving dashboard alias compatibility",
  );
  assert.match(
    emailSource,
    /Open venue profile[\s\S]*Your glimpse venue profile login[\s\S]*ownerProfileUrlForSlug\(v\.slug\)[\s\S]*Venue profile links/s,
    "owner login and recovery emails use venue profile language and URLs",
  );
  assert.match(
    billingRoute,
    /success_url: `\$\{base\}\/profile\/\$\{slug\}\?billing=success`[\s\S]*cancel_url: `\$\{base\}\/profile\/\$\{slug\}\?billing=cancel`[\s\S]*return_url: `\$\{getAppBaseUrl\(\)\}\/profile\/\$\{slug\}`/s,
    "Stripe checkout and portal return owners through the venue profile route",
  );
  const galleryGenerationSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/galleryGeneration.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    galleryGenerationSource,
    /hasCompletePublicGalleryAssets\(publicAssets\)[\s\S]*refusing to mark session ready[\s\S]*update\(coupleSessionsTable\)[\s\S]*status: "ready"/s,
    "gallery generation refuses to mark sessions ready before the complete V1 asset bundle exists",
  );
  const appSource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/app.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    appSource,
    /session\.status === "ready"[\s\S]*hasCompletePublicGalleryAssets\(generatedAssets\)[\s\S]*thumbnailAsset[\s\S]*displayOrder === 1/s,
    "share-page Open Graph thumbnails are only emitted for ready sessions with a complete public gallery bundle",
  );
  const spaRouteSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/App.tsx", import.meta.url),
    "utf8",
  );
  const venueLandingSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/pages/VenueLandingPage.tsx", import.meta.url),
    "utf8",
  );
  const venueOwnerPageSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/pages/VenueOwnerPage.tsx", import.meta.url),
    "utf8",
  );
  const venueSiteHeaderSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/components/layout/VenueSiteHeader.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    spaRouteSource,
    /Route path="\/"[\s\S]*VenueLandingPage[\s\S]*Route path="\/owner"[\s\S]*Redirect to="\/\?owner=sign-in"[\s\S]*Route path="\/profile\/:slug"[\s\S]*RedirectVenueProfileToDashboard/s,
    "main site is venue-facing and legacy owner entry opens profile access separately from couple preview URLs",
  );
  assert.ok(
    venueLandingSource.includes("Start venue profile") &&
      venueLandingSource.includes("Access profile") &&
      venueLandingSource.includes("`/profile/${sampleSlug}`") &&
      venueLandingSource.includes("`/preview/${sampleSlug}`"),
    "venue landing page lets venues sign up, access profiles, and build couple links",
  );
  assert.match(
    venueLandingSource,
    /URLSearchParams\(window\.location\.search\)[\s\S]*params\.get\("owner"\) !== "sign-in"[\s\S]*setOwnerOpen\(true\)[\s\S]*window\.history\.replaceState/s,
    "venue landing page deep-links directly into the owner profile access dialog",
  );
  assert.match(
    venueSiteHeaderSource,
    /onClick=\{onSignIn \?\? \(\(\) => setLocation\("\/\?owner=sign-in"\)\)\}/s,
    "shared venue header sign-in opens the main site's owner profile access flow",
  );
  assert.match(
    venueOwnerPageSource,
    /VENUE_MEDIA_COVERAGE_OPTIONS[\s\S]*exterior[\s\S]*ceremony[\s\S]*reception[\s\S]*detail[\s\S]*natural_light[\s\S]*selectedCoverage[\s\S]*data: \{ objectKey: result\.objectPath, coverage: selectedCoverage/s,
    "owner dashboard requires explicit venue photo coverage selection before media registration",
  );
  const couplePageSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/pages/CouplePage.tsx", import.meta.url),
    "utf8",
  );
  const sharePageSource = fs.readFileSync(
    new URL("../../artifacts/wedding-app/src/pages/GallerySharePage.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(
    /film|approval|approve|veo|dialogue|extended/i.test(`${couplePageSource}\n${sharePageSource}`),
    false,
    "couple-facing gallery pages do not expose legacy film, approval, dialogue, extended, or Veo language",
  );
  assert.equal(
    /out of credits|top up|billing|subscription|owner profile|dashboard|create-venue|\/profile|\/dashboard/i.test(couplePageSource),
    false,
    "couple preview page does not expose owner, billing, or venue-profile mechanics",
  );
  assert.match(
    couplePageSource,
    /temporarily unavailable for new galleries[\s\S]*venue team/s,
    "couple preview page uses neutral availability language when the venue cannot start sessions",
  );

  const createdAt = new Date("2026-06-20T12:00:00.000Z");
  const billingPeriodEnd = new Date("2026-07-20T12:00:00.000Z");
  assert.deepEqual(
    ownerVenueResponse({
      id: 42,
      name: "The Glass House",
      slug: "glass-house",
      tagline: "Light, vows, and city views",
      description: "A venue profile",
      ownerEmail: "owner@example.com",
      contactEmail: "events@example.com",
      contactPhone: "555-0100",
      websiteUrl: "https://example.com/",
      bookingUrl: "https://example.com/tours",
      plan: "growth",
      creditsBalance: 17,
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
      billingPeriodEnd,
      createdAt,
    }),
    {
      id: 42,
      name: "The Glass House",
      slug: "glass-house",
      tagline: "Light, vows, and city views",
      description: "A venue profile",
      ownerEmail: "owner@example.com",
      contactEmail: "events@example.com",
      contactPhone: "555-0100",
      websiteUrl: "https://example.com/",
      bookingUrl: "https://example.com/tours",
      plan: "growth",
      creditsBalance: 17,
      billingPeriodEnd,
      createdAt,
    },
    "owner venue responses preserve profile, owner, billing, and credit fields without Stripe IDs",
  );

  const retryGuidance = qualityRetryGuidanceForError(
    new GalleryQualityError("failed", {
      likenessScore: 0.62,
      partnerOneLikenessScore: 0.81,
      partnerTwoLikenessScore: 0.42,
      partnerIdentitySeparation: false,
      venueScore: 0.51,
      compositionScore: 0.68,
      exactlyTwoPartners: false,
      facesVisible: false,
      extraPeople: true,
      textArtifacts: false,
      pass: false,
      reasons: ["partner two looked generic", "venue became a generic ballroom"],
    }),
  );
  assert.ok(retryGuidance?.includes("partner two likeness"), "retry guidance targets weak partner likeness");
  assert.ok(
    retryGuidance?.includes("two distinct real partners"),
    "retry guidance targets merged or duplicated partner identities",
  );
  assert.ok(retryGuidance?.includes("exact venue architecture"), "retry guidance targets venue drift");
  assert.ok(retryGuidance?.includes("exactly the two partners"), "retry guidance targets missing or extra people");
  const galleryQualitySource = fs.readFileSync(
    new URL("../../artifacts/api-server/src/lib/galleryQuality.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    galleryQualitySource,
    /venueCoverageSummary[\s\S]*VENUE REFERENCE \$\{index \+ 1\}: \$\{label\}[\s\S]*Venue reference coverage roles:[\s\S]*VENUE REFERENCE \$\{index \+ 1\}\$\{coverage \? `: \$\{coverage\}` : ""\}/s,
    "gallery quality judge sees explicit venue coverage roles when scoring venue preservation",
  );

  const goodReference = await referenceQualityImage("good");
  const goodQuality = await assertReferenceImageQuality({
    buffer: goodReference,
    label: "Couple photo 1",
    minEdgePx: 1024,
    profile: "couple",
  });
  assert.ok(goodQuality.sharpness > 14, "clear synthetic couple reference passes sharpness gate");
  assert.equal(
    hammingDistance(goodQuality.perceptualHash, goodQuality.perceptualHash),
    0,
    "perceptual hash reports exact duplicate references",
  );

  await assert.rejects(
    async () =>
      assertReferenceImageQuality({
        buffer: await referenceQualityImage("dark"),
        label: "Couple photo 2",
        minEdgePx: 1024,
        profile: "couple",
      }),
    /too dark/,
    "reference quality gate rejects underexposed couple photos",
  );
  await assert.rejects(
    async () =>
      assertReferenceImageQuality({
        buffer: await referenceQualityImage("washed"),
        label: "Venue photo",
        minEdgePx: 1024,
        profile: "venue",
      }),
    /washed out/,
    "reference quality gate rejects overexposed venue photos",
  );
  await assert.rejects(
    async () =>
      assertReferenceImageQuality({
        buffer: await referenceQualityImage("blurry"),
        label: "Couple photo 3",
        minEdgePx: 1024,
        profile: "couple",
      }),
    /blurry/,
    "reference quality gate rejects blurry likeness references",
  );

  delete process.env.UPLOAD_TOKEN_SECRET;
  delete process.env.SESSION_SECRET;
  delete process.env.OWNER_SESSION_SECRET;
  process.env.NODE_ENV = "production";
  assert.throws(
    () => createCoupleUploadToken(slug, now),
    /UPLOAD_TOKEN_SECRET/,
    "production refuses to mint upload tokens without a secret",
  );

  process.env.NODE_ENV = "test";
  assert.deepEqual(
    configuredImageModels(),
    ["gemini-3-pro-image", "gemini-3.1-flash-image"],
    "default image model chain keeps production on Gemini 3 native image models",
  );

  process.env.GEMINI_IMAGE_MODEL = "primary-image-model";
  process.env.GEMINI_IMAGE_FALLBACK_MODELS = "fallback-one, fallback-two, fallback-one";
  assert.deepEqual(
    configuredImageModels(),
    ["primary-image-model", "fallback-one", "fallback-two"],
    "primary/fallback env vars produce a de-duplicated ordered model chain",
  );

  process.env.GEMINI_IMAGE_MODELS = "explicit-a, explicit-b";
  assert.deepEqual(
    configuredImageModels(),
    ["explicit-a", "explicit-b"],
    "GEMINI_IMAGE_MODELS overrides the complete ordered model chain",
  );

  process.env.GOOGLE_AI_API_KEY = "test-key";
  process.env.GEMINI_API_BASE_URL = "https://mock-gemini.invalid/v1beta";
  process.env.GEMINI_IMAGE_MODELS = "gemini-3-pro-image";
  delete process.env.GEMINI_IMAGE_MODEL;
  delete process.env.GEMINI_IMAGE_FALLBACK_MODELS;
  delete process.env.GEMINI_USE_INTERACTIONS_API;

  const generated = svgImage("generated");
  const reference = { buffer: svgImage("reference"), mimeType: "image/svg+xml" };
  const coupleReferences = Array.from({ length: 3 }, (_, index) => ({
    buffer: svgImage(`couple-${index + 1}`),
    mimeType: "image/svg+xml",
  }));
  const venueCoverageOrder = [
    "exterior",
    "ceremony",
    "reception",
    "detail",
    "natural_light",
  ] as const;
  const venueReferences = Array.from({ length: 20 }, (_, index) => ({
    buffer: svgImage(`venue-${index + 1}`),
    mimeType: "image/svg+xml",
    coverage: venueCoverageOrder[index % venueCoverageOrder.length],
  }));

  const gemini3FetchCalls: string[] = [];
  let gemini3RequestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    gemini3FetchCalls.push(url);
    if (url.includes("/models/gemini-3-pro-image:generateContent")) {
      gemini3RequestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      assert.equal(
        (init?.headers as Record<string, string> | undefined)?.["Api-Revision"],
        undefined,
        "production image generation does not send beta Interactions API headers by default",
      );
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/svg+xml",
                      data: generated.toString("base64"),
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("unexpected endpoint", { status: 500 });
  };

  const gemini3Rendered = await generateCinematicStillWithMetadata({
    prompt: "Render a realistic wedding gallery QA frame.",
    coupleReference: reference,
    coupleReferences,
    venueReference: reference,
    venueReferences,
    aspectRatio: "1:1",
  });
  assert.equal(
    gemini3Rendered.buffer.equals(generated),
    true,
    "Gemini 3 stable generateContent path returns the generated image",
  );
  assert.deepEqual(
    gemini3FetchCalls,
    ["https://mock-gemini.invalid/v1beta/models/gemini-3-pro-image:generateContent?key=test-key"],
    "Gemini 3 image models use the stable generateContent endpoint by default",
  );
  const gemini3Body = gemini3RequestBody as {
    contents?: unknown[];
    generationConfig?: {
      responseFormat?: { image?: { aspectRatio?: string; imageSize?: string } };
    };
  } | null;
  assert.equal(gemini3Body?.generationConfig?.responseFormat?.image?.aspectRatio, "1:1");
  assert.equal(gemini3Body?.generationConfig?.responseFormat?.image?.imageSize, "2K");
  const gemini3Parts = ((gemini3Body?.contents?.[0] as { parts?: unknown[] } | undefined)
    ?.parts ?? []) as Array<{ text?: string; inlineData?: unknown }>;
  assert.equal(
    gemini3Parts.filter((part) => part.inlineData).length,
    9,
    "Gemini 3 Pro stable path sends 3 couple refs plus 6 high-fidelity venue refs",
  );
  const gemini3TextParts = gemini3Parts.map((part) => part.text ?? "").join("\n");
  assert.ok(
    gemini3TextParts.includes("COUPLE IDENTITY MANIFEST") &&
      gemini3TextParts.includes("IDENTITY HARD CONSTRAINT") &&
      gemini3TextParts.includes("VENUE SCENE MANIFEST") &&
      gemini3TextParts.includes("VENUE COVERAGE ROLES") &&
      gemini3TextParts.includes("INPUT IMAGE 4: Exterior or signature facade") &&
      gemini3TextParts.includes("INPUT IMAGE 5: Ceremony space") &&
      gemini3TextParts.includes("COMPOSITING HARD CONSTRAINT"),
    "Gemini image prompt includes hard identity, venue coverage, and compositing constraints",
  );

  const blurryGenerated = await referenceQualityImage("blurry");
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/models/gemini-3-pro-image:generateContent")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: blurryGenerated.toString("base64"),
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("unexpected endpoint", { status: 500 });
  };
  await assert.rejects(
    async () =>
      generateCinematicStillWithMetadata({
        prompt: "Render a realistic wedding gallery QA frame.",
        coupleReference: reference,
        coupleReferences,
        venueReference: reference,
        venueReferences,
        aspectRatio: "1:1",
      }),
    /blurry|low-detail|contrast|unusably small/,
    "generation rejects blurry or low-detail image outputs before storing gallery assets",
  );

  process.env.GEMINI_IMAGE_MODELS = "primary-unavailable,fallback-working";
  delete process.env.GEMINI_IMAGE_MODEL;
  delete process.env.GEMINI_IMAGE_FALLBACK_MODELS;

  const fetchCalls: string[] = [];
  let fallbackRequestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("/models/primary-unavailable:generateContent")) {
      return new Response(JSON.stringify({ error: { message: "model not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/models/fallback-working:generateContent")) {
      fallbackRequestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/svg+xml",
                      data: generated.toString("base64"),
                    },
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("unexpected model", { status: 500 });
  };

  const rendered = await generateCinematicStillWithMetadata({
    prompt: "Render a realistic wedding gallery QA frame.",
    coupleReference: reference,
    coupleReferences,
    venueReference: reference,
    venueReferences,
    aspectRatio: "1:1",
  });
  assert.equal(rendered.buffer.equals(generated), true, "fallback model returns the generated image");
  assert.equal(rendered.model, "fallback-working", "generator reports the model that produced the image");
  assert.deepEqual(
    fetchCalls.map((url) => url.match(/models\/([^:]+):generateContent/)?.[1]),
    ["primary-unavailable", "fallback-working"],
    "generation tries the primary model, then the fallback model",
  );
  const requestBody = fallbackRequestBody as { contents?: unknown[] } | null;
  const fallbackParts = ((requestBody?.contents?.[0] as { parts?: unknown[] } | undefined)
    ?.parts ?? []) as Array<{ text?: string; inlineData?: unknown }>;
  const fallbackTextParts = fallbackParts.map((part) => part.text ?? "").join("\n");
  assert.equal(
    fallbackParts.filter((part) => part.inlineData).length,
    14,
    "generation sends the maximum supported Gemini 3 reference set: 3 couple refs plus 11 venue refs",
  );
  assert.ok(
    fallbackTextParts.includes("COUPLE IDENTITY REFERENCE 1"),
    "generation labels couple identity references in the Gemini payload",
  );
  assert.ok(
    fallbackTextParts.includes("Partner A and Partner B"),
    "generation asks the image model to maintain two stable partner identities across all references",
  );
  assert.ok(
    fallbackTextParts.includes("TOGETHER REFERENCE") &&
      fallbackTextParts.includes("PARTNER A FACE REFERENCE") &&
      fallbackTextParts.includes("PARTNER B FACE REFERENCE"),
    "generation labels couple references with ordered partner-specific roles for likeness preservation",
  );
  assert.ok(
    fallbackTextParts.includes("If the uploaded order differs"),
    "generation can recover when couple reference uploads do not follow the preferred order",
  );
  assert.ok(
    fallbackTextParts.includes("COUPLE IDENTITY REFERENCE 2"),
    "generation sends all couple references with identity labels",
  );
  assert.ok(
    fallbackTextParts.includes("COUPLE IDENTITY REFERENCE 3"),
    "generation sends the third couple reference when provided",
  );
  assert.ok(
    fallbackTextParts.includes("VENUE SCENE ANCHOR"),
    "generation labels the first venue reference as the scene anchor",
  );
  assert.ok(
    fallbackTextParts.includes("VENUE SCENE ANCHOR 1 (Exterior or signature facade)"),
    "generation labels the scene anchor with its explicit venue coverage role",
  );
  assert.ok(
    fallbackTextParts.includes("VENUE HIGH-FIDELITY CONTEXT REFERENCE 2"),
    "generation labels the strongest additional venue references as high-fidelity context",
  );
  assert.ok(
    fallbackTextParts.includes("VENUE HIGH-FIDELITY CONTEXT REFERENCE 2 (Ceremony space)"),
    "generation labels additional venue references with explicit coverage roles",
  );
  assert.ok(
    fallbackTextParts.includes("VENUE BROAD CONTEXT REFERENCE 11"),
    "generation preserves broad venue context up to the 14-image request limit for legacy/custom models",
  );
  assert.equal(
    fallbackTextParts.includes("VENUE CONTEXT REFERENCE 12"),
    false,
    "generation does not exceed the Gemini 3 14-reference-image request limit",
  );

  console.log("security smoke passed");
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv();
}
