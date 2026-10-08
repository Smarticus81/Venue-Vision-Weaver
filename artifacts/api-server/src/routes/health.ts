import { Router, type IRouter, type Request } from "express";
import crypto from "crypto";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  isProductionImageModelChain,
  validateProductionEnvironment,
} from "../lib/envValidation.js";
import { isStripeConfigured } from "../lib/stripe.js";
import { configuredImageModels } from "../lib/stillImageClient.js";
import { checkFfmpegAvailable } from "../lib/motionReel.js";
import {
  missingRequiredDatabaseSchema,
  rowLevelSecurityReadiness,
} from "../lib/databaseReadiness.js";
import { clerkEnabled } from "../lib/orgAuth.js";
import { clerkDomainMismatch } from "../lib/clerkEnv.js";
import { isOperatorRequest } from "../control-plane/operatorAuth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

function hasValue(key: string): boolean {
  return Boolean(process.env[key]?.trim());
}

function storageConfigured(): boolean {
  const hasSupabase = hasValue("SUPABASE_URL") && hasValue("SUPABASE_SERVICE_ROLE_KEY");
  const hasGcs = hasValue("PRIVATE_OBJECT_DIR") && hasValue("PUBLIC_OBJECT_SEARCH_PATHS");
  return hasSupabase || hasGcs;
}

function productionImageModelChainReady(): boolean {
  return isProductionImageModelChain(configuredImageModels());
}

function imageProviderKeysReady(): boolean {
  const models = configuredImageModels();
  const needsOpenAi = models.some((model) => /^gpt-image-/i.test(model));
  const needsGemini = models.some((model) => !/^gpt-image-/i.test(model));
  if (needsOpenAi && !hasValue("OPENAI_API_KEY")) return false;
  if (needsGemini && !hasValue("GOOGLE_AI_API_KEY") && !hasValue("GEMINI_API_KEY")) return false;
  return needsOpenAi || needsGemini;
}

/**
 * Auth is ready when Clerk is fully configured and the production key is
 * issued for the host the site is served from. Without it, signup, the
 * dashboard and billing all answer 503, so a deploy must not report ok.
 */
export function authReadiness(): { status: "ok" | "degraded"; reasons: string[] } {
  const reasons: string[] = [];
  if (!clerkEnabled()) {
    reasons.push("CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY) are required");
  } else {
    const expectedDomain = clerkDomainMismatch();
    if (expectedDomain) {
      reasons.push(`Clerk production key is issued for ${expectedDomain} but APP_BASE_URL points elsewhere`);
    }
  }
  return { status: reasons.length === 0 ? "ok" : "degraded", reasons };
}

function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** `x-readiness-token` matches READINESS_DETAIL_TOKEN (constant-time). */
export function readinessTokenMatches(
  presented: string | string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.READINESS_DETAIL_TOKEN?.trim();
  if (!expected || expected.length < 16) return false;
  const token = Array.isArray(presented) ? presented[0] : presented;
  if (!token?.trim()) return false;
  return timingSafeEquals(token.trim(), expected);
}

/**
 * The coarse ok/degraded map is public (deploy monitors need it); the reasons
 * behind each degraded check name tables, env keys and hosts, so they are only
 * returned to operators or to a caller presenting READINESS_DETAIL_TOKEN.
 */
async function readinessDetailAuthorized(req: Request): Promise<boolean> {
  if (readinessTokenMatches(req.headers["x-readiness-token"])) return true;
  return isOperatorRequest(req);
}

let warnedRlsUnavailable = false;

router.get("/readyz", async (req, res) => {
  const envErrors = validateProductionEnvironment();
  const auth = authReadiness();
  const checks: Record<string, "ok" | "degraded"> = {
    env: envErrors.length === 0 ? "ok" : "degraded",
    auth: auth.status,
    database: "degraded",
    storage: storageConfigured() ? "ok" : "degraded",
    ai:
      (hasValue("GOOGLE_AI_API_KEY") || hasValue("GEMINI_API_KEY")) && imageProviderKeysReady()
        ? "ok"
        : "degraded",
    billing: isStripeConfigured() ? "ok" : "degraded",
    email: hasValue("RESEND_API_KEY") && hasValue("EMAIL_FROM") ? "ok" : "degraded",
    qualityGate: (process.env.GALLERY_QUALITY_GATE ?? "on").toLowerCase() === "off" ? "degraded" : "ok",
    imageModel: productionImageModelChainReady() ? "ok" : "degraded",
    ffmpeg: "degraded",
  };
  const details: Record<string, string[]> = {
    env: envErrors,
    auth: auth.reasons,
    database: [],
    rls: [],
  };

  try {
    await db.execute(sql`select 1`);
    const missingSchema = await missingRequiredDatabaseSchema();
    checks.database = missingSchema.length === 0 ? "ok" : "degraded";
    details.database = missingSchema;

    const rls = await rowLevelSecurityReadiness();
    if (rls.status === "unknown") {
      // Warn-level: the role cannot introspect pg_tables. Do not fail the
      // deploy over a privilege gap the app itself does not need.
      details.rls = [rls.reason];
      if (!warnedRlsUnavailable) {
        warnedRlsUnavailable = true;
        logger.warn({ reason: rls.reason }, "Readiness cannot verify row-level security");
      }
    } else {
      checks.rls = rls.status;
      details.rls = rls.tablesWithoutRls.map((table) => `rls-disabled:${table}`);
    }
  } catch (err) {
    checks.database = "degraded";
    details.database = [`database unreachable: ${err instanceof Error ? err.message : String(err)}`];
  }

  checks.ffmpeg = (await checkFfmpegAvailable()) ? "ok" : "degraded";

  const status = Object.values(checks).every((check) => check === "ok") ? "ok" : "degraded";
  const data = ReadinessCheckResponse.parse({
    status,
    checks,
  });
  const withDetails = await readinessDetailAuthorized(req);
  res.setHeader("Cache-Control", "no-store");
  res.status(status === "ok" ? 200 : 503).json(withDetails ? { ...data, details } : data);
});

export default router;
