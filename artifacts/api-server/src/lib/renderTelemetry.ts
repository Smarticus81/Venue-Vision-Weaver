import { asc, eq } from "drizzle-orm";
import {
  db,
  renderAttemptsTable,
  type RenderAttemptOutcome,
} from "@workspace/db";
import { recordAuditEvent } from "../control-plane/audit.js";
import { logger } from "./logger.js";

/*
 * Render telemetry: one render_attempts row per image render attempt
 * (accepted, rejected by the judge, provider error, blocked, timed out), so
 * first-pass rate, latency and cost per gallery are measured instead of
 * estimated. Unit prices come from RENDER_PRICE_<MODEL> env vars (USD per
 * image); nothing here invents a price.
 */

export interface RenderAttemptInput {
  sessionId: number;
  sceneId: string;
  attempt: number;
  model: string;
  fallbackUsed?: boolean;
  size?: string | null;
  quality?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  judgeReport?: Record<string, unknown> | null;
  outcome: RenderAttemptOutcome;
  errorClass?: string | null;
}

export type RenderAttemptRecorder = (input: RenderAttemptInput) => Promise<void>;

function intOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/** Append one render attempt. Never throws: telemetry must not fail a gallery. */
export async function recordRenderAttempt(input: RenderAttemptInput): Promise<void> {
  try {
    await db.insert(renderAttemptsTable).values({
      sessionId: input.sessionId,
      sceneId: input.sceneId,
      attempt: input.attempt,
      model: input.model,
      fallbackUsed: input.fallbackUsed ?? false,
      size: input.size ?? null,
      quality: input.quality ?? null,
      inputTokens: intOrNull(input.inputTokens),
      outputTokens: intOrNull(input.outputTokens),
      latencyMs: intOrNull(input.latencyMs),
      judgeReport: input.judgeReport ?? null,
      outcome: input.outcome,
      errorClass: input.errorClass ?? null,
    });
  } catch (err) {
    logger.warn({ err, sessionId: input.sessionId, sceneId: input.sceneId }, "render attempt not recorded");
  }
}

const fallbackAuditedSessions = new Set<number>();

/**
 * Audit the first time a session's frame is rendered by a model other than
 * the configured primary, so a silent production reroute (e.g. Sunburst
 * unavailable for an hour) shows up in the operator audit trail. Never throws.
 */
export async function recordModelFallback(input: {
  sessionId: number;
  sceneId: string;
  primaryModel: string;
  model: string;
  skipped: { model: string; reason: string }[];
}): Promise<void> {
  if (fallbackAuditedSessions.has(input.sessionId)) return;
  fallbackAuditedSessions.add(input.sessionId);
  if (fallbackAuditedSessions.size > 5_000) fallbackAuditedSessions.clear();
  await recordAuditEvent({
    actorType: "system",
    actor: "gallery-pipeline",
    eventType: "image_model_fallback",
    subjectType: "couple_session",
    subjectId: input.sessionId,
    detail: {
      sceneId: input.sceneId,
      primaryModel: input.primaryModel,
      model: input.model,
      skipped: input.skipped,
    },
  });
}

/* ----------------------------------------------------------------- pricing */

type EnvLike = Record<string, string | undefined>;

/** RENDER_PRICE_<MODEL> key for a model id: gpt-image-2.5-sunburst -> RENDER_PRICE_GPT_IMAGE_2_5_SUNBURST. */
export function renderPriceEnvKey(model: string): string {
  return `RENDER_PRICE_${model.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

/**
 * Configured USD price per rendered image for a model, or null when unset.
 * A dated snapshot (gpt-image-2.5-sunburst-2026-09-08) falls back to the
 * alias's price.
 */
export function renderUnitPriceUsd(model: string, env: EnvLike = process.env): number | null {
  const candidates = [model, model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  for (const candidate of candidates) {
    const raw = env[renderPriceEnvKey(candidate)]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export interface RenderAttemptRow {
  sceneId: string;
  attempt: number;
  model: string;
  fallbackUsed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  outcome: string;
}

export interface RenderCostSummary {
  attempts: number;
  /** Attempts where the provider returned an image (what the provider bills). */
  billableImages: number;
  acceptedFrames: number;
  /** Scenes whose accepted frame came from attempt 1. */
  firstPassScenes: number;
  scenes: number;
  fallbackAttempts: number;
  failedAttempts: number;
  inputTokens: number;
  outputTokens: number;
  renderLatencyMs: number;
  /** USD for billable images whose model has a configured price; null when none is priced. */
  costUsd: number | null;
  /** True when every billable image had a configured price. */
  costComplete: boolean;
  unpricedModels: string[];
  byModel: Record<string, { billableImages: number; unitPriceUsd: number | null }>;
}

function isBillable(row: RenderAttemptRow): boolean {
  return row.outcome === "accepted" || row.outcome === "rejected" || (row.outputTokens ?? 0) > 0;
}

/** Pure COGS roll-up over a session's render attempts. */
export function summarizeRenderCost(rows: RenderAttemptRow[], env: EnvLike = process.env): RenderCostSummary {
  const byModel: RenderCostSummary["byModel"] = {};
  const sceneIds = new Set<string>();
  const firstPass = new Set<string>();
  let billableImages = 0;
  let acceptedFrames = 0;
  let fallbackAttempts = 0;
  let failedAttempts = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let renderLatencyMs = 0;

  for (const row of rows) {
    sceneIds.add(row.sceneId);
    inputTokens += row.inputTokens ?? 0;
    outputTokens += row.outputTokens ?? 0;
    renderLatencyMs += row.latencyMs ?? 0;
    if (row.fallbackUsed) fallbackAttempts += 1;
    if (row.outcome === "accepted") {
      acceptedFrames += 1;
      if (row.attempt === 1) firstPass.add(row.sceneId);
    } else if (row.outcome !== "rejected") {
      failedAttempts += 1;
    }
    if (!isBillable(row)) continue;
    billableImages += 1;
    const entry = (byModel[row.model] ??= {
      billableImages: 0,
      unitPriceUsd: renderUnitPriceUsd(row.model, env),
    });
    entry.billableImages += 1;
  }

  let costUsd: number | null = null;
  const unpricedModels: string[] = [];
  for (const [model, entry] of Object.entries(byModel)) {
    if (entry.unitPriceUsd == null) {
      unpricedModels.push(model);
      continue;
    }
    costUsd = (costUsd ?? 0) + entry.billableImages * entry.unitPriceUsd;
  }
  if (costUsd != null) costUsd = Math.round(costUsd * 10_000) / 10_000;

  return {
    attempts: rows.length,
    billableImages,
    acceptedFrames,
    firstPassScenes: firstPass.size,
    scenes: sceneIds.size,
    fallbackAttempts,
    failedAttempts,
    inputTokens,
    outputTokens,
    renderLatencyMs,
    costUsd,
    costComplete: unpricedModels.length === 0,
    unpricedModels,
    byModel,
  };
}

/** Measured COGS for one session (finance agent / owner detail). */
export async function sessionCostSummary(
  sessionId: number,
  env: EnvLike = process.env,
): Promise<RenderCostSummary> {
  const rows = await db
    .select({
      sceneId: renderAttemptsTable.sceneId,
      attempt: renderAttemptsTable.attempt,
      model: renderAttemptsTable.model,
      fallbackUsed: renderAttemptsTable.fallbackUsed,
      inputTokens: renderAttemptsTable.inputTokens,
      outputTokens: renderAttemptsTable.outputTokens,
      latencyMs: renderAttemptsTable.latencyMs,
      outcome: renderAttemptsTable.outcome,
    })
    .from(renderAttemptsTable)
    .where(eq(renderAttemptsTable.sessionId, sessionId))
    .orderBy(asc(renderAttemptsTable.createdAt));
  return summarizeRenderCost(rows, env);
}
