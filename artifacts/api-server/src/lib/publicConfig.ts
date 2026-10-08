import {
  TRIAL_CREDITS,
  STARTER_MONTHLY_CREDITS,
  GROWTH_MONTHLY_CREDITS,
  CREDIT_PACK_AMOUNT,
} from "@workspace/db";
import { logger } from "./logger.js";
import { isStripeConfigured } from "./stripe.js";

/*
 * One reader for published prices, trial terms, the founding offer, the
 * public contact address and the photo-retention window (shared-contract 4.1,
 * funnel-ux.md 2.2). The reader signatures are frozen; the funnel workstream
 * extends this file with computeProofAggregates and the aggregate proof mode.
 */

export interface PricingConfig {
  currency: string;
  label: string | null;
  starterMonthly: number;
  growthMonthly: number;
  creditPack: number;
  starterCredits: number;
  growthCredits: number;
  creditPackCredits: number;
}
export interface TrialConfig {
  credits: number;
  days: number;
}
export interface FoundingOffer {
  slotsLeft: number;
  slotsTotal: number;
}
export interface ProofAggregates {
  venues: number;
  galleries: number;
  /** 0-100, one decimal */
  openedRate: number;
  /** 0-100, one decimal */
  ctaClickRate: number;
  bookedCount: number;
  since: string;
}
export interface PublicConfig {
  pricing: PricingConfig;
  trial: TrialConfig;
  /** null when no founding slots are left */
  founding: FoundingOffer | null;
  proof: { mode: "partner" } | { mode: "aggregate"; aggregates: ProofAggregates };
  contactEmail: string | null;
  /** isStripeConfigured() */
  billingConfigured: boolean;
  /** Days couple source photos are kept after delivery */
  retentionDays: number;
}

const warned = new Set<string>();

/** Positive finite number or the default (warns once per key). */
export function envPositiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  if (!warned.has(key)) {
    warned.add(key);
    logger.warn({ key, raw }, "Ignoring invalid numeric env value; using default");
  }
  return fallback;
}

export function readPricingConfig(env: NodeJS.ProcessEnv = process.env): PricingConfig {
  return {
    currency: env.PRICING_CURRENCY?.trim() || "USD",
    label: env.PRICING_LABEL === undefined ? "Launch prices" : env.PRICING_LABEL.trim() || null,
    starterMonthly: envPositiveNumber(env, "PRICING_STARTER_MONTHLY", 129),
    growthMonthly: envPositiveNumber(env, "PRICING_GROWTH_MONTHLY", 279),
    creditPack: envPositiveNumber(env, "PRICING_CREDIT_PACK", 59),
    starterCredits: STARTER_MONTHLY_CREDITS,
    growthCredits: GROWTH_MONTHLY_CREDITS,
    creditPackCredits: CREDIT_PACK_AMOUNT,
  };
}

export function readTrialConfig(env: NodeJS.ProcessEnv = process.env): TrialConfig {
  return {
    credits: TRIAL_CREDITS,
    days: Math.max(1, Math.floor(envPositiveNumber(env, "TRIAL_DAYS", 14))),
  };
}

export function readFoundingOffer(env: NodeJS.ProcessEnv = process.env): FoundingOffer | null {
  const slotsTotal = Math.floor(envPositiveNumber(env, "PUBLIC_FOUNDING_SLOTS_TOTAL", 10));
  const rawLeft = env.PUBLIC_FOUNDING_SLOTS_LEFT?.trim();
  const slotsLeft =
    rawLeft === undefined || rawLeft === ""
      ? Math.min(10, slotsTotal)
      : Math.max(0, Math.floor(Number(rawLeft) || 0));
  return slotsLeft > 0 ? { slotsLeft: Math.min(slotsLeft, slotsTotal), slotsTotal } : null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Address inside `Name <addr@host>` or a bare address; null when neither parses. */
function extractEmailAddress(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const angled = /<([^>]+)>/.exec(value);
  const candidate = (angled ? angled[1] : value)?.trim().toLowerCase() ?? "";
  return EMAIL_REGEX.test(candidate) ? candidate : null;
}

/** PUBLIC_CONTACT_EMAIL -> OUTREACH_REPLY_TO -> the address inside EMAIL_FROM -> null. */
export function readPublicContactEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  return (
    extractEmailAddress(env.PUBLIC_CONTACT_EMAIL) ??
    extractEmailAddress(env.OUTREACH_REPLY_TO) ??
    extractEmailAddress(env.EMAIL_FROM) ??
    null
  );
}

/** COUPLE_PHOTO_RETENTION_DAYS, default 30, min 1. */
export function readRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  return Math.max(1, Math.floor(envPositiveNumber(env, "COUPLE_PHOTO_RETENTION_DAYS", 30)));
}

/* ————— Assembled public config (60s in-process cache) ————— */

const PUBLIC_CONFIG_TTL_MS = 60_000;
let cached: { at: number; value: PublicConfig } | null = null;

/**
 * Assemble the public config. Proof is "partner" mode until the funnel
 * workstream adds computeProofAggregates; the shape is already final so the
 * public site and the HTML shell can consume it today.
 */
export async function buildPublicConfig(now = Date.now()): Promise<PublicConfig> {
  if (cached && now - cached.at < PUBLIC_CONFIG_TTL_MS) return cached.value;
  const value: PublicConfig = {
    pricing: readPricingConfig(),
    trial: readTrialConfig(),
    founding: readFoundingOffer(),
    proof: { mode: "partner" },
    contactEmail: readPublicContactEmail(),
    billingConfigured: isStripeConfigured(),
    retentionDays: readRetentionDays(),
  };
  cached = { at: now, value };
  return value;
}

/** Drop the cached config (tests and env reloads). */
export function resetPublicConfigCache(): void {
  cached = null;
}

function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `<meta name="dreemer-public-config" content="…json, HTML-escaped…" />` for the SPA shell. */
export function publicConfigMetaTag(config: PublicConfig): string {
  return `<meta name="dreemer-public-config" content="${escapeAttribute(JSON.stringify(config))}" />`;
}
