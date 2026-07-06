import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { validateProductionEnvironment } from "../lib/envValidation.js";
import { isStripeConfigured } from "../lib/stripe.js";
import { configuredImageModels } from "../lib/stillImageClient.js";
import { checkFfmpegAvailable } from "../lib/motionReel.js";
import { missingRequiredDatabaseSchema } from "../lib/databaseReadiness.js";

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
  const models = configuredImageModels();
  return (
    models[0] === "gemini-3-pro-image" &&
    models.every((model) => /^gemini-3(?:\.\d+)?-(?:pro|flash)-image$/i.test(model))
  );
}

router.get("/readyz", async (_req, res) => {
  const checks: Record<string, "ok" | "degraded"> = {
    env: validateProductionEnvironment().length === 0 ? "ok" : "degraded",
    database: "degraded",
    storage: storageConfigured() ? "ok" : "degraded",
    ai: hasValue("GOOGLE_AI_API_KEY") || hasValue("GEMINI_API_KEY") ? "ok" : "degraded",
    billing: isStripeConfigured() ? "ok" : "degraded",
    email: hasValue("RESEND_API_KEY") && hasValue("EMAIL_FROM") ? "ok" : "degraded",
    qualityGate: (process.env.GALLERY_QUALITY_GATE ?? "on").toLowerCase() === "off" ? "degraded" : "ok",
    imageModel: productionImageModelChainReady() ? "ok" : "degraded",
    ffmpeg: "degraded",
  };

  try {
    await db.execute(sql`select 1`);
    const missingSchema = await missingRequiredDatabaseSchema();
    checks.database = missingSchema.length === 0 ? "ok" : "degraded";
  } catch {
    checks.database = "degraded";
  }

  checks.ffmpeg = await checkFfmpegAvailable() ? "ok" : "degraded";

  const status = Object.values(checks).every((check) => check === "ok") ? "ok" : "degraded";
  const data = ReadinessCheckResponse.parse({
    status,
    checks,
  });
  res.status(status === "ok" ? 200 : 503).json(data);
});

export default router;
