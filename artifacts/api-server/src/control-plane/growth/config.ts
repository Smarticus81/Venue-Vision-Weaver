import { getAppBaseUrl } from "../../lib/appUrl.js";
import { readPricingConfig, readTrialConfig } from "../../lib/publicConfig.js";

/**
 * Growth-loop configuration (growth-loop.md section 3). Prices and trial
 * length have ONE reader in the codebase (lib/publicConfig.ts, shared-contract
 * D5); these helpers only reshape its output for the KPI math. No Stripe
 * call: display prices from PRICING_* env, never billed amounts. Every
 * GROWTH_* knob is optional and documented in .env.example.
 */

export interface PlanPrices {
  source: "env";
  starterCents: number;
  growthCents: number;
  creditPackCents: number;
}

export const GROWTH_KPI_VERSION = 1;

/** Trial length in days (TRIAL_DAYS, default 14). */
export function trialDays(): number {
  return readTrialConfig().days;
}

/** Published plan prices in cents (PRICING_STARTER_MONTHLY / PRICING_GROWTH_MONTHLY / PRICING_CREDIT_PACK; defaults 129 / 279 / 59). */
export function planPrices(): PlanPrices {
  const pricing = readPricingConfig();
  return {
    source: "env",
    starterCents: Math.round(pricing.starterMonthly * 100),
    growthCents: Math.round(pricing.growthMonthly * 100),
    creditPackCents: Math.round(pricing.creditPack * 100),
  };
}

/** Env integer with a default; clamps to >= min (default 0). */
export function envInt(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

/** Env number (may be fractional) with a default; clamps to >= min (default 0). */
export function envNumber(name: string, fallback: number, min = 0): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

/** GROWTH_LOOP_ENABLED=off disables trial clock, attribution, adaptation rules and digests (KPI snapshots still run). */
export function growthLoopEnabled(): boolean {
  const raw = process.env.GROWTH_LOOP_ENABLED?.trim().toLowerCase();
  return !(raw === "off" || raw === "false" || raw === "0");
}

/** Venue photos that count as "photos ready" in the activation funnel (GROWTH_ACTIVATION_MIN_PHOTOS, default 3). */
export function activationMinPhotos(): number {
  return envInt("GROWTH_ACTIVATION_MIN_PHOTOS", 3, 1);
}

/** Ready galleries that trigger the trial_gallery_3 nudge (GROWTH_NUDGE_GALLERY_COUNT, default 3). */
export function nudgeGalleryCount(): number {
  return envInt("GROWTH_NUDGE_GALLERY_COUNT", 3, 1);
}

/** Days before trial end for the trial_day_10 nudge (GROWTH_NUDGE_DAYS_BEFORE_END, default 4). */
export function nudgeDaysBeforeEnd(): number {
  return envInt("GROWTH_NUDGE_DAYS_BEFORE_END", 4, 1);
}

/** Sends in 14 days before the deliverability rule acts (GROWTH_GUARD_MIN_SENDS, default 50). */
export function guardMinSends(): number {
  return envInt("GROWTH_GUARD_MIN_SENDS", 50, 1);
}

export function segmentMinSent(): number {
  return envInt("GROWTH_SEGMENT_MIN_SENT", 20, 1);
}

export function variantMinSent(): number {
  return envInt("GROWTH_VARIANT_MIN_SENT", 30, 1);
}

export function experimentMinN(): number {
  return envInt("GROWTH_EXPERIMENT_MIN_N", 30, 1);
}

/** 0 = Sunday .. 6 = Saturday, UTC (GROWTH_DIGEST_WEEKDAY, default Monday). */
export function digestWeekday(): number {
  return Math.min(6, envInt("GROWTH_DIGEST_WEEKDAY", 1, 0));
}

/** UTC hour from which the weekly digest may be generated (GROWTH_DIGEST_HOUR_UTC, default 13). */
export function digestHourUtc(): number {
  return Math.min(23, envInt("GROWTH_DIGEST_HOUR_UTC", 13, 0));
}

/** CTA target in lifecycle emails: GROWTH_PRICING_URL or `${APP_BASE_URL}/dashboard`. */
export function pricingUrl(): string {
  const raw = process.env.GROWTH_PRICING_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).toString();
    } catch {
      /* fall through to the dashboard */
    }
  }
  return `${getAppBaseUrl()}/dashboard`;
}

export function dashboardUrl(): string {
  return `${getAppBaseUrl()}/dashboard`;
}

export function controlUrl(hash?: string): string {
  return `${getAppBaseUrl()}/control${hash ? `#${hash}` : ""}`;
}

/**
 * Estimated Grok list prices per million tokens, used ONLY to enforce the
 * max_daily_ai_usd kill switch (an internal spend estimate, never shown to
 * customers). Override with CONTROL_PLANE_PRICE_INPUT_PER_M_USD and
 * CONTROL_PLANE_PRICE_OUTPUT_PER_M_USD when the model or its pricing changes.
 */
export function aiTokenPricesUsd(): { inputPerMillion: number; outputPerMillion: number } {
  return {
    inputPerMillion: envNumber("CONTROL_PLANE_PRICE_INPUT_PER_M_USD", 3),
    outputPerMillion: envNumber("CONTROL_PLANE_PRICE_OUTPUT_PER_M_USD", 15),
  };
}

/** Wall-clock budget for one agent run (CONTROL_PLANE_RUN_DEADLINE_MINUTES, default 10). */
export function runDeadlineMs(): number {
  return envInt("CONTROL_PLANE_RUN_DEADLINE_MINUTES", 10, 1) * 60_000;
}

/** Days to keep agent_runs.transcript before it is nulled (default 30). */
export function transcriptRetentionDays(): number {
  return envInt("CONTROL_PLANE_TRANSCRIPT_RETENTION_DAYS", 30, 1);
}

/** Days to keep control_audit_events rows (default 180). */
export function auditRetentionDays(): number {
  return envInt("CONTROL_PLANE_AUDIT_RETENTION_DAYS", 180, 30);
}
