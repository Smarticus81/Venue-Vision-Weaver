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

/** Primary gallery renderer: OpenAI's precision gpt-image-2.5 model. */
const PRIMARY_IMAGE_MODEL = "gpt-image-2.5-sunburst";
const SUPPORTED_OPENAI_IMAGE_QUALITIES = ["low", "medium", "high", "xhigh", "max", "auto"];
/** Env vars that can set the image model chain, in the order they win. */
const IMAGE_MODEL_ENV_KEYS = [
  "IMAGE_MODELS",
  "GEMINI_IMAGE_MODELS",
  "IMAGE_MODEL",
  "GEMINI_IMAGE_MODEL",
  "NANO_BANANA_MODEL",
] as const;

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

// Mirrors configuredImageModels() in stillImageClient.ts. Keep both in sync.
function configuredImageModels(env: EnvLike): string[] {
  const explicit = env.IMAGE_MODELS ?? env.GEMINI_IMAGE_MODELS;
  if (explicit) {
    return explicit.split(",").map((model) => model.trim()).filter(Boolean);
  }

  const primary =
    env.IMAGE_MODEL ?? env.GEMINI_IMAGE_MODEL ?? env.NANO_BANANA_MODEL ?? PRIMARY_IMAGE_MODEL;
  const fallbacks = (
    env.IMAGE_FALLBACK_MODELS ??
    env.GEMINI_IMAGE_FALLBACK_MODELS ??
    "gpt-image-2.5-flare,gemini-3-pro-image"
  )
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

function isOpenAiImageModel(model: string): boolean {
  return /^gpt-image-/i.test(model.trim());
}

/**
 * Models allowed in a production chain: OpenAI's gpt-image-2.5 pair (optionally
 * pinned to a dated snapshot) and the Gemini 3 native image models kept as a
 * fallback.
 */
export function isProductionImageModel(model: string): boolean {
  const trimmed = model.trim();
  return (
    /^gpt-image-2\.5-(?:sunburst|flare)(?:-\d{4}-\d{2}-\d{2})?$/i.test(trimmed) ||
    /^gemini-3(?:\.\d+)?-(?:pro|flash)-image$/i.test(trimmed)
  );
}

/**
 * A production chain starts with the precision gpt-image model and only falls
 * back to the other supported production models. Shared by the boot
 * validation and /readyz so both surfaces agree on what "ready" means.
 */
export function isProductionImageModelChain(models: readonly string[]): boolean {
  return models[0] === PRIMARY_IMAGE_MODEL && models.every(isProductionImageModel);
}

const EMAIL_LIST_ITEM = /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/;

/** Comma-separated operator allowlist: every entry must be an email address. */
function operatorEmailsError(env: EnvLike): string | null {
  const raw = env.CONTROL_PLANE_OPERATOR_EMAILS?.trim() ?? "";
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return "CONTROL_PLANE_OPERATOR_EMAILS must list at least one email address";
  }
  const invalid = entries.filter((entry) => !EMAIL_LIST_ITEM.test(entry));
  if (invalid.length > 0) {
    return `CONTROL_PLANE_OPERATOR_EMAILS must be comma-separated email addresses; invalid: ${invalid.join(", ")}`;
  }
  return null;
}

function hostnameOf(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Non-fatal production findings, logged at boot. A warning never stops the
 * server; it points at configuration that bites later (mismatched hosts break
 * Clerk and share links; a dev-open control plane exposes operator tools).
 */
export function productionEnvironmentWarnings(env: EnvLike = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const warnings: string[] = [];

  const appHost = hostnameOf(env.APP_BASE_URL ?? env.PUBLIC_APP_URL);
  const railwayHost = hostnameOf(env.RAILWAY_PUBLIC_DOMAIN);
  if (appHost && railwayHost && appHost !== railwayHost) {
    warnings.push(
      `APP_BASE_URL host (${appHost}) differs from RAILWAY_PUBLIC_DOMAIN (${railwayHost}); share links and emails use APP_BASE_URL, so that host must serve this deployment`,
    );
  }
  if ((env.CONTROL_PLANE_DEV_OPEN ?? "").trim().toLowerCase() === "true") {
    warnings.push(
      "CONTROL_PLANE_DEV_OPEN=true is ignored in production: the control plane only admits CONTROL_PLANE_OPERATOR_EMAILS",
    );
  }
  if (
    !env.TRUST_PROXY?.trim() &&
    !env.RAILWAY_PUBLIC_DOMAIN &&
    !env.RAILWAY_STATIC_URL &&
    !env.FLY_APP_NAME &&
    !env.RENDER_EXTERNAL_URL
  ) {
    warnings.push(
      "TRUST_PROXY is unset and no known platform was detected; behind a reverse proxy set TRUST_PROXY=1 or per-IP rate limits collapse into one bucket",
    );
  }
  return warnings;
}

export function validateProductionEnvironment(env: EnvLike = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];

  const errors: string[] = [];
  const required = [
    "PORT",
    "DATABASE_URL",
    "UPLOAD_TOKEN_SECRET",
    // Owner sign-in, the dashboard and billing are all Clerk-gated: a
    // production deploy without Clerk cannot sign up a single venue, so the
    // keys are required (the webhook secret too, or organization names never
    // sync). Outside production the app still degrades to a setup notice.
    "CLERK_SECRET_KEY",
    "CLERK_WEBHOOK_SIGNING_SECRET",
    // The control plane fails closed behind an explicit operator allowlist.
    "CONTROL_PLANE_OPERATOR_EMAILS",
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
  if (!hasRealValue(env, "CLERK_PUBLISHABLE_KEY") && !hasRealValue(env, "VITE_CLERK_PUBLISHABLE_KEY")) {
    errors.push("CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY) must be set");
  }
  // With the control plane live, outreach can email real people; bounce and
  // complaint webhooks must be verifiable or the suppression list never fills.
  if (hasRealValue(env, "XAI_API_KEY") && !hasRealValue(env, "RESEND_WEBHOOK_SECRET")) {
    errors.push("RESEND_WEBHOOK_SECRET must be set when XAI_API_KEY enables the control plane");
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
    operatorEmailsError(env),
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
  if (models[0] !== PRIMARY_IMAGE_MODEL) {
    // Name the variable that actually set the primary. A deployment upgraded
    // from the Gemini-first chain still carries GEMINI_IMAGE_MODEL, and without
    // this hint the failure does not say which value to change.
    const source = IMAGE_MODEL_ENV_KEYS.find((key) => env[key]?.trim());
    errors.push(
      `Image model chain must start with ${PRIMARY_IMAGE_MODEL} for best production likeness quality` +
        (source
          ? `; it currently starts with "${models[0]}" from ${source}. Set IMAGE_MODEL=${PRIMARY_IMAGE_MODEL} or unset ${source}.`
          : ""),
    );
  }
  const unsupportedImageModels = models.filter((model) => !isProductionImageModel(model));
  if (unsupportedImageModels.length > 0) {
    errors.push(
      `Production image model chain must use gpt-image-2.5 or Gemini 3 native image models only; unsupported: ${unsupportedImageModels.join(", ")}`,
    );
  }
  if (models.some(isOpenAiImageModel) && !hasRealValue(env, "OPENAI_API_KEY")) {
    errors.push("OPENAI_API_KEY must be set when the image model chain uses gpt-image models");
  }

  const openAiQuality = env.OPENAI_IMAGE_QUALITY?.trim().toLowerCase();
  if (openAiQuality && !SUPPORTED_OPENAI_IMAGE_QUALITIES.includes(openAiQuality)) {
    errors.push(
      `OPENAI_IMAGE_QUALITY must be one of ${SUPPORTED_OPENAI_IMAGE_QUALITIES.join(", ")}`,
    );
  }

  const openAiSize = env.OPENAI_IMAGE_SIZE?.trim();
  if (openAiSize && openAiSize !== "auto" && !/^\d{3,4}x\d{3,4}$/.test(openAiSize)) {
    errors.push("OPENAI_IMAGE_SIZE must be auto or a WIDTHxHEIGHT value such as 2048x1152");
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

  // Published prices and trial clock: display values, optional, but a set value must parse.
  for (const key of ["PRICING_STARTER_MONTHLY", "PRICING_GROWTH_MONTHLY", "PRICING_CREDIT_PACK"]) {
    const raw = env[key]?.trim();
    if (raw && !(Number.isFinite(Number(raw)) && Number(raw) > 0)) {
      errors.push(`${key} must be a positive number (whole currency units)`);
    }
  }
  for (const [key, min] of [
    ["TRIAL_DAYS", 1],
    ["COUPLE_PHOTO_RETENTION_DAYS", 1],
    ["PUBLIC_FOUNDING_SLOTS_LEFT", 0],
    ["PUBLIC_FOUNDING_SLOTS_TOTAL", 0],
    ["PUBLIC_PROOF_MIN_VENUES", 1],
    ["PUBLIC_PROOF_MIN_GALLERIES", 1],
    ["VETTING_PLACES_DAILY_CAP", 0],
    ["VETTING_TTL_DAYS", 1],
    ["GROWTH_ACTIVATION_MIN_PHOTOS", 1],
    ["GROWTH_NUDGE_GALLERY_COUNT", 1],
    ["GROWTH_NUDGE_DAYS_BEFORE_END", 0],
    ["GROWTH_GUARD_MIN_SENDS", 1],
    ["GROWTH_SEGMENT_MIN_SENT", 1],
    ["GROWTH_VARIANT_MIN_SENT", 1],
    ["GROWTH_EXPERIMENT_MIN_N", 1],
  ] as const) {
    const raw = env[key]?.trim();
    if (raw && !(Number.isInteger(Number(raw)) && Number(raw) >= min)) {
      errors.push(`${key} must be an integer >= ${min}`);
    }
  }
  const weekday = env.GROWTH_DIGEST_WEEKDAY?.trim();
  if (weekday && !/^[0-6]$/.test(weekday)) {
    errors.push("GROWTH_DIGEST_WEEKDAY must be 0-6 (0 = Sunday)");
  }
  const hour = env.GROWTH_DIGEST_HOUR_UTC?.trim();
  if (hour && !(Number.isInteger(Number(hour)) && Number(hour) >= 0 && Number(hour) <= 23)) {
    errors.push("GROWTH_DIGEST_HOUR_UTC must be 0-23");
  }
  for (const key of ["VETTING_RDAP_BASE_URL", "VETTING_WAYBACK_CDX_URL", "GROWTH_PRICING_URL"]) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    try {
      if (new URL(raw).protocol !== "https:") errors.push(`${key} must be an https URL`);
    } catch {
      errors.push(`${key} must be a valid URL`);
    }
  }
  if (
    env.PUBLIC_CONTACT_EMAIL?.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(env.PUBLIC_CONTACT_EMAIL.trim())
  ) {
    errors.push("PUBLIC_CONTACT_EMAIL must be an email address");
  }
  if (env.GROWTH_LOOP_ENABLED?.trim() && !/^(on|off)$/i.test(env.GROWTH_LOOP_ENABLED.trim())) {
    errors.push("GROWTH_LOOP_ENABLED must be on or off");
  }

  return errors;
}

export function assertProductionEnvironment(env: EnvLike = process.env): void {
  const errors = validateProductionEnvironment(env);
  if (errors.length > 0) {
    throw new Error(`Production environment is not ready:\n- ${errors.join("\n- ")}`);
  }
}
