import {
  db,
  TRIAL_CREDITS,
  STARTER_MONTHLY_CREDITS,
  GROWTH_MONTHLY_CREDITS,
  CREDIT_PACK_AMOUNT,
  organizationsTable,
  venuesTable,
  coupleSessionsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
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
  // TOTAL=0 (accepted by envValidation) switches the founding offer off; it
  // must never fall back to a default and publish "10 of 10" slots.
  const rawTotal = env.PUBLIC_FOUNDING_SLOTS_TOTAL?.trim();
  if (rawTotal !== undefined && rawTotal !== "" && Number(rawTotal) === 0) return null;
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

/* ————— Aggregate proof (opted-in venues only) ————— */

export interface ProofThresholds {
  minVenues: number;
  minGalleries: number;
}

/** PUBLIC_PROOF_MIN_VENUES (default 5) and PUBLIC_PROOF_MIN_GALLERIES (default 50), both at least 1. */
export function readProofThresholds(env: NodeJS.ProcessEnv = process.env): ProofThresholds {
  return {
    minVenues: Math.max(1, Math.floor(envPositiveNumber(env, "PUBLIC_PROOF_MIN_VENUES", 5))),
    minGalleries: Math.max(1, Math.floor(envPositiveNumber(env, "PUBLIC_PROOF_MIN_GALLERIES", 50))),
  };
}

/** Raw counts behind the proof row, restricted to organizations with share_aggregates = true. */
export interface ProofRows {
  /** Venues belonging to opted-in organizations. */
  venues: number;
  /** Ready couple galleries (kind = couple, status = ready) at those venues. */
  galleries: number;
  /** Of those galleries, how many were opened at least once. */
  viewed: number;
  /** Of those galleries, how many had at least one date-CTA click. */
  ctaClicked: number;
  /** Of those galleries, how many the venue marked as booked. */
  booked: number;
  /** Earliest included gallery. */
  since: Date | null;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Pure: thresholds -> aggregates or null. Rates are 0-100 with one decimal. */
export function summarizeProof(rows: ProofRows, thresholds: ProofThresholds): ProofAggregates | null {
  if (rows.venues < thresholds.minVenues || rows.galleries < thresholds.minGalleries || !rows.since) return null;
  return {
    venues: rows.venues,
    galleries: rows.galleries,
    openedRate: rate(rows.viewed, rows.galleries),
    ctaClickRate: rate(rows.ctaClicked, rows.galleries),
    bookedCount: rows.booked,
    since: rows.since.toISOString(),
  };
}

/** One round trip: opted-in organizations -> their venues -> ready couple galleries. */
export async function loadProofRows(): Promise<ProofRows> {
  const [venueRow] = await db
    .select({ venues: sql<number>`count(*)::int` })
    .from(venuesTable)
    .innerJoin(organizationsTable, eq(venuesTable.organizationId, organizationsTable.id))
    .where(eq(organizationsTable.shareAggregates, true));
  const [galleryRow] = await db
    .select({
      galleries: sql<number>`count(*)::int`,
      viewed: sql<number>`count(*) filter (where ${coupleSessionsTable.viewCount} > 0 or ${coupleSessionsTable.firstViewedAt} is not null)::int`,
      ctaClicked: sql<number>`count(*) filter (where ${coupleSessionsTable.ctaClicks} > 0)::int`,
      booked: sql<number>`count(*) filter (where ${coupleSessionsTable.bookedAt} is not null)::int`,
      since: sql<Date | string | null>`min(${coupleSessionsTable.createdAt})`,
    })
    .from(coupleSessionsTable)
    .innerJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
    .innerJoin(organizationsTable, eq(venuesTable.organizationId, organizationsTable.id))
    .where(
      and(
        eq(organizationsTable.shareAggregates, true),
        eq(coupleSessionsTable.kind, "couple"),
        eq(coupleSessionsTable.status, "ready"),
      ),
    );
  return {
    venues: Number(venueRow?.venues ?? 0),
    galleries: Number(galleryRow?.galleries ?? 0),
    viewed: Number(galleryRow?.viewed ?? 0),
    ctaClicked: Number(galleryRow?.ctaClicked ?? 0),
    booked: Number(galleryRow?.booked ?? 0),
    since: galleryRow?.since ? new Date(galleryRow.since) : null,
  };
}

export interface ProofDeps extends ProofThresholds {
  /** Injected in tests; defaults to the live query. */
  load?: () => Promise<ProofRows>;
}

/**
 * Aggregate proof for the public site: only organizations that opted in
 * (share_aggregates) are counted, and nothing is published below the
 * thresholds. Returns null (partner mode) on any failure.
 */
export async function computeProofAggregates(deps: ProofDeps): Promise<ProofAggregates | null> {
  try {
    const rows = await (deps.load ?? loadProofRows)();
    return summarizeProof(rows, deps);
  } catch (err) {
    logger.warn({ err }, "Proof aggregates unavailable; falling back to partner mode");
    return null;
  }
}

/* ————— Assembled public config (60s in-process cache) ————— */

const PUBLIC_CONFIG_TTL_MS = 60_000;
let cached: { at: number; value: PublicConfig } | null = null;

export interface BuildPublicConfigOptions {
  now?: number;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests; defaults to the live proof query. */
  loadProof?: () => Promise<ProofRows>;
}

/**
 * Assemble the public config: prices, trial terms, founding offer, proof
 * mode (aggregate only when enough opted-in venues and galleries exist),
 * contact address, billing availability and the photo-retention window.
 */
export async function buildPublicConfig(options: BuildPublicConfigOptions | number = {}): Promise<PublicConfig> {
  const opts = typeof options === "number" ? { now: options } : options;
  const now = opts.now ?? Date.now();
  const env = opts.env ?? process.env;
  if (cached && now - cached.at < PUBLIC_CONFIG_TTL_MS) return cached.value;
  const aggregates = await computeProofAggregates({ ...readProofThresholds(env), load: opts.loadProof });
  const value: PublicConfig = {
    pricing: readPricingConfig(env),
    trial: readTrialConfig(env),
    founding: readFoundingOffer(env),
    proof: aggregates ? { mode: "aggregate", aggregates } : { mode: "partner" },
    contactEmail: readPublicContactEmail(env),
    billingConfigured: isStripeConfigured(),
    retentionDays: readRetentionDays(env),
  };
  cached = { at: now, value };
  return value;
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
