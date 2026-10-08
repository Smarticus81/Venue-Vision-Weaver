import { readPricingConfig, readTrialConfig } from "../../lib/publicConfig.js";

/**
 * Growth-loop configuration. Prices and trial length have ONE reader in the
 * codebase (lib/publicConfig.ts, shared-contract D5); these helpers only
 * reshape its output for the KPI math. No Stripe call: display prices from
 * PRICING_* env, never billed amounts.
 */

export interface PlanPrices {
  source: "env";
  starterCents: number;
  growthCents: number;
  creditPackCents: number;
}

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

/** Env integer with a default; used for GROWTH_* tuning knobs. */
export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** GROWTH_LOOP_ENABLED=off disables adaptation rules and evaluator decisions (snapshots still run). */
export function growthLoopEnabled(): boolean {
  const raw = process.env.GROWTH_LOOP_ENABLED?.trim().toLowerCase();
  return !(raw === "off" || raw === "false" || raw === "0");
}
