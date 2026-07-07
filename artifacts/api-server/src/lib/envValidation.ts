type EnvLike = Record<string, string | undefined>;

const PLACEHOLDER_VALUES = new Set([
  "",
  "...",
  "sk_test_...",
  "whsec_...",
  "price_...",
  "service-role-key",
  "resend-key",
  "gemini-key",
  "generate-a-long-random-string",
  "generate-a-second-long-random-string",
]);

const PLACEHOLDER_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "example.com",
  "your-service.up.railway.app",
  "yourdomain.com",
]);

const MIN_PRODUCTION_QUALITY_THRESHOLDS = {
  GALLERY_MIN_LIKENESS_SCORE: 0.82,
  GALLERY_MIN_PARTNER_LIKENESS_SCORE: 0.78,
  GALLERY_MIN_VENUE_SCORE: 0.8,
  GALLERY_MIN_COMPOSITION_SCORE: 0.74,
  // Acceptance floors for best-effort frames must not sink below these; the
  // strict targets above stay the retry goal.
  GALLERY_FLOOR_LIKENESS_SCORE: 0.7,
  GALLERY_FLOOR_PARTNER_LIKENESS_SCORE: 0.66,
  GALLERY_FLOOR_VENUE_SCORE: 0.68,
  GALLERY_FLOOR_COMPOSITION_SCORE: 0.6,
} as const;

const MIN_PRODUCTION_FRAME_ATTEMPTS = 4;
const MIN_PRODUCTION_GENERATED_IMAGE_EDGE_PX = 1024;
const MIN_PRODUCTION_GENERATED_IMAGE_CONTRAST = 8;
const MIN_PRODUCTION_GENERATED_IMAGE_SHARPNESS = 6;

function hasRealValue(env: EnvLike, key: string): boolean {
  const value = env[key]?.trim() ?? "";
  if (!value || PLACEHOLDER_VALUES.has(value)) return false;
  if (value.includes("[") || value.includes("]")) return false;
  if (/\b(?:your|YOUR)[-_A-Z0-9]*\b/.test(value)) return false;
  return true;
}

function appBaseUrlError(env: EnvLike): string | null {
  const raw =
    env.APP_BASE_URL ??
    env.PUBLIC_APP_URL ??
    (env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
      : "");

  if (!raw.trim()) return "APP_BASE_URL or RAILWAY_PUBLIC_DOMAIN must be set";

  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:") {
      return "APP_BASE_URL must use https in production";
    }
    if (PLACEHOLDER_HOSTS.has(url.hostname.toLowerCase())) {
      return "APP_BASE_URL must be the live public host, not localhost or a placeholder";
    }
    return null;
  } catch {
    return "APP_BASE_URL must be a valid URL";
  }
}

function hasSupabaseStorage(env: EnvLike): boolean {
  return hasRealValue(env, "SUPABASE_URL") && hasRealValue(env, "SUPABASE_SERVICE_ROLE_KEY");
}

function hasGcsStorage(env: EnvLike): boolean {
  return hasRealValue(env, "PRIVATE_OBJECT_DIR") && hasRealValue(env, "PUBLIC_OBJECT_SEARCH_PATHS");
}

function supabaseUrlError(env: EnvLike): string | null {
  const raw = env.SUPABASE_URL?.trim() ?? "";
  if (!raw) return null;
  if (!hasRealValue(env, "SUPABASE_URL")) {
    return "SUPABASE_URL must be the real Supabase project URL, not a placeholder";
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "SUPABASE_URL must use https";
    if (!url.hostname.endsWith(".supabase.co")) {
      return "SUPABASE_URL must be a Supabase project URL";
    }
    if (/your|project-ref|placeholder/i.test(url.hostname)) {
      return "SUPABASE_URL must be the real Supabase project URL, not a placeholder";
    }
    return null;
  } catch {
    return "SUPABASE_URL must be a valid URL";
  }
}

function clerkSecretError(env: EnvLike): string | null {
  const secret = env.CLERK_SECRET_KEY?.trim() ?? "";
  if (!secret) return null;
  if (!/^sk_(test|live)_[A-Za-z0-9]+/.test(secret)) {
    return "CLERK_SECRET_KEY must be a Clerk secret key (sk_test_ or sk_live_)";
  }
  return null;
}

function clerkWebhookSecretError(env: EnvLike): string | null {
  const secret = env.CLERK_WEBHOOK_SIGNING_SECRET?.trim() ?? "";
  if (!secret) return null;
  if (!/^whsec_[A-Za-z0-9+/=]+/.test(secret)) {
    return "CLERK_WEBHOOK_SIGNING_SECRET must be a Clerk (svix) webhook signing secret";
  }
  return null;
}

function clerkPublishableKeyError(env: EnvLike): string | null {
  const key = env.CLERK_PUBLISHABLE_KEY?.trim() ?? env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  if (!key) return null;
  if (!/^pk_(test|live)_[A-Za-z0-9]+/.test(key)) {
    return "CLERK_PUBLISHABLE_KEY must be a Clerk publishable key (pk_test_ or pk_live_)";
  }
  return null;
}

function stripeSecretError(env: EnvLike): string | null {
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!secret) return null;
  if (!/^sk_live_[A-Za-z0-9]+/.test(secret)) {
    return "STRIPE_SECRET_KEY must be a live Stripe secret key in production";
  }
  return null;
}

function stripeWebhookSecretError(env: EnvLike): string | null {
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) return null;
  if (!/^whsec_[A-Za-z0-9]+/.test(secret)) {
    return "STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret";
  }
  return null;
}

function stripePriceIdError(env: EnvLike, key: string): string | null {
  const priceId = env[key]?.trim() ?? "";
  if (!priceId) return null;
  if (!/^price_[A-Za-z0-9]{8,}$/.test(priceId)) {
    return `${key} must be a Stripe price id`;
  }
  return null;
}

function configuredImageModels(env: EnvLike): string[] {
  const explicit = env.GEMINI_IMAGE_MODELS;
  if (explicit) {
    return explicit.split(",").map((model) => model.trim()).filter(Boolean);
  }

  const primary = env.GEMINI_IMAGE_MODEL ?? env.NANO_BANANA_MODEL ?? "gemini-3-pro-image";
  const fallbacks = (env.GEMINI_IMAGE_FALLBACK_MODELS ?? "gemini-3.1-flash-image")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

function numericEnvAtLeast(
  env: EnvLike,
  key: string,
  fallback: number,
  minimum: number,
): string | null {
  const raw = env[key]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) return `${key} must be a number`;
  if (value < minimum) return `${key} must be at least ${minimum} in production`;
  return null;
}

function isProductionQualityModel(model: string): boolean {
  return /^gemini-(?:2\.5|3(?:\.\d+)?)-pro(?:$|-)/i.test(model.trim());
}

function isProductionImageModel(model: string): boolean {
  return /^gemini-3(?:\.\d+)?-(?:pro|flash)-image$/i.test(model.trim());
}

export function validateProductionEnvironment(env: EnvLike = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const errors: string[] = [];
  const required = [
    "PORT",
    "DATABASE_URL",
    "UPLOAD_TOKEN_SECRET",
    "SESSION_SECRET",
    // Clerk is optional at boot: owner/organization routes return 503 and the
    // web app shows a setup notice until CLERK_SECRET_KEY is configured.
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_STARTER_MONTHLY",
    "STRIPE_PRICE_GROWTH_MONTHLY",
    "STRIPE_PRICE_CREDIT_PACK_10",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ];

  for (const key of required) {
    if (!hasRealValue(env, key)) errors.push(`${key} must be set`);
  }

  if (!hasRealValue(env, "GOOGLE_AI_API_KEY") && !hasRealValue(env, "GEMINI_API_KEY")) {
    errors.push("GOOGLE_AI_API_KEY or GEMINI_API_KEY must be set");
  }

  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port <= 0) {
    errors.push("PORT must be a positive integer");
  }

  const appUrlError = appBaseUrlError(env);
  if (appUrlError) errors.push(appUrlError);

  if (!hasSupabaseStorage(env) && !hasGcsStorage(env)) {
    errors.push(
      "Configure either Supabase storage (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) or GCS storage (PRIVATE_OBJECT_DIR and PUBLIC_OBJECT_SEARCH_PATHS)",
    );
  }
  const supabaseError = supabaseUrlError(env);
  if (supabaseError) errors.push(supabaseError);

  const providerErrors = [
    clerkSecretError(env),
    clerkWebhookSecretError(env),
    clerkPublishableKeyError(env),
    stripeSecretError(env),
    stripeWebhookSecretError(env),
    stripePriceIdError(env, "STRIPE_PRICE_STARTER_MONTHLY"),
    stripePriceIdError(env, "STRIPE_PRICE_GROWTH_MONTHLY"),
    stripePriceIdError(env, "STRIPE_PRICE_CREDIT_PACK_10"),
  ].filter((error): error is string => Boolean(error));
  errors.push(...providerErrors);

  if ((env.EMAIL_FROM ?? "").includes("onboarding@resend.dev")) {
    errors.push("EMAIL_FROM must use a verified production sender, not onboarding@resend.dev");
  }

  if ((env.GALLERY_QUALITY_GATE ?? "on").toLowerCase() === "off") {
    errors.push("GALLERY_QUALITY_GATE must stay enabled in production");
  }

  for (const [key, minimum] of Object.entries(MIN_PRODUCTION_QUALITY_THRESHOLDS)) {
    const error = numericEnvAtLeast(env, key, minimum, minimum);
    if (error) errors.push(error);
  }

  const attemptsError = numericEnvAtLeast(
    env,
    "GALLERY_FRAME_ATTEMPTS",
    MIN_PRODUCTION_FRAME_ATTEMPTS,
    MIN_PRODUCTION_FRAME_ATTEMPTS,
  );
  if (attemptsError) errors.push(attemptsError);

  const minEdgeError = numericEnvAtLeast(
    env,
    "GENERATED_IMAGE_MIN_EDGE_PX",
    MIN_PRODUCTION_GENERATED_IMAGE_EDGE_PX,
    MIN_PRODUCTION_GENERATED_IMAGE_EDGE_PX,
  );
  if (minEdgeError) errors.push(minEdgeError);

  const generatedContrastError = numericEnvAtLeast(
    env,
    "GENERATED_IMAGE_MIN_CONTRAST",
    MIN_PRODUCTION_GENERATED_IMAGE_CONTRAST,
    MIN_PRODUCTION_GENERATED_IMAGE_CONTRAST,
  );
  if (generatedContrastError) errors.push(generatedContrastError);

  const generatedSharpnessError = numericEnvAtLeast(
    env,
    "GENERATED_IMAGE_MIN_SHARPNESS",
    MIN_PRODUCTION_GENERATED_IMAGE_SHARPNESS,
    MIN_PRODUCTION_GENERATED_IMAGE_SHARPNESS,
  );
  if (generatedSharpnessError) errors.push(generatedSharpnessError);

  const models = configuredImageModels(env);
  if (models[0] !== "gemini-3-pro-image") {
    errors.push("Gemini image model chain must start with gemini-3-pro-image for best production likeness quality");
  }
  const unsupportedImageModels = models.filter((model) => !isProductionImageModel(model));
  if (unsupportedImageModels.length > 0) {
    errors.push(
      `Production image model chain must use Gemini 3 native image models only; unsupported: ${unsupportedImageModels.join(", ")}`,
    );
  }

  const qualityModel = env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro";
  if (!isProductionQualityModel(qualityModel)) {
    errors.push("GEMINI_QUALITY_MODEL must be a Gemini Pro model for production likeness and venue review");
  }

  const apiBase = env.GEMINI_API_BASE_URL?.trim();
  if (apiBase && /\/v1(?!beta)(?:\/|$)/i.test(apiBase)) {
    errors.push(
      "GEMINI_API_BASE_URL must use the v1beta Gemini API; image generation config (responseModalities/imageConfig) is not available on v1",
    );
  }

  const imageSize = env.GEMINI_IMAGE_SIZE ?? "2K";
  if (!["1K", "2K", "4K"].includes(imageSize)) {
    errors.push("GEMINI_IMAGE_SIZE must be one of 1K, 2K, or 4K in production");
  }

  return errors;
}

export function assertProductionEnvironment(env: EnvLike = process.env): void {
  const errors = validateProductionEnvironment(env);
  if (errors.length > 0) {
    throw new Error(`Production environment is not ready:\n- ${errors.join("\n- ")}`);
  }
}
