import { db, agentActionsTable, agentRunsTable, controlAuditEventsTable } from "@workspace/db";
import { and, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import type { ActionDefinition } from "../actions.js";
import { recordAuditEvent } from "../audit.js";
import { getPolicyBoolean, getPolicyNumber } from "../policies.js";
import { aiTokenPricesUsd, auditRetentionDays, transcriptRetentionDays } from "./config.js";

/*
 * Governance helpers for the scheduler and the runner (synthesis WS-D):
 * drain delay, retired-action cleanup, kill switches (agents_enabled,
 * max_daily_ai_usd), provider backoff and nightly retention. The pure parts
 * are exported for unit tests; the database helpers are thin.
 */

export const DRAIN_DELAY_MINUTES = 2;
export const RETIREMENT_NOTE = "superseded by outreach studio";
export const RETIREMENT_ACTOR = "system:retirement";

/** Approved rows are drained only once their decision is at least this old (lets the inline executor finish first). */
export function drainCutoff(now: Date = new Date(), minutes = DRAIN_DELAY_MINUTES): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

export function retiredActionTypes(catalog: Record<string, Pick<ActionDefinition, "type" | "retired">>): string[] {
  return Object.values(catalog)
    .filter((a) => a.retired)
    .map((a) => a.type);
}

/** On boot: every pending/approved row of a retired action type is rejected (E8). */
export async function retireLegacyActions(catalog: Record<string, Pick<ActionDefinition, "type" | "retired">>): Promise<number> {
  const types = retiredActionTypes(catalog);
  if (types.length === 0) return 0;
  const now = new Date();
  const rejected = await db
    .update(agentActionsTable)
    .set({ status: "rejected", decidedBy: RETIREMENT_ACTOR, decisionNote: RETIREMENT_NOTE, decidedAt: now })
    .where(and(inArray(agentActionsTable.actionType, types), inArray(agentActionsTable.status, ["pending", "approved"])))
    .returning({ id: agentActionsTable.id, actionType: agentActionsTable.actionType });
  for (const row of rejected) {
    await recordAuditEvent({
      actorType: "system",
      actor: RETIREMENT_ACTOR,
      eventType: "action_rejected",
      subjectType: "action",
      subjectId: row.id,
      detail: { actionType: row.actionType, note: RETIREMENT_NOTE },
    });
  }
  if (rejected.length > 0) {
    logger.warn({ count: rejected.length, types }, "Rejected pending/approved rows of retired action types on boot");
  }
  return rejected.length;
}

/* ————— Spend and kill switches ————— */

export interface TokenPrices {
  inputPerMillion: number;
  outputPerMillion: number;
}

export function estimateRunCostUsd(promptTokens: number, completionTokens: number, prices: TokenPrices): number {
  const cost = (Math.max(0, promptTokens) / 1_000_000) * prices.inputPerMillion + (Math.max(0, completionTokens) / 1_000_000) * prices.outputPerMillion;
  return Math.round(cost * 10_000) / 10_000;
}

export type StartDecision = { ok: true } | { ok: false; reason: "agents_disabled" | "ai_budget_exhausted" };

/** Pure: may the scheduler start a run right now? */
export function shouldStartAgentRuns(input: { agentsEnabled: boolean; spentTodayUsd: number; capUsd: number }): StartDecision {
  if (!input.agentsEnabled) return { ok: false, reason: "agents_disabled" };
  if (input.capUsd > 0 && input.spentTodayUsd >= input.capUsd) return { ok: false, reason: "ai_budget_exhausted" };
  return { ok: true };
}

/** Estimated Grok spend today (UTC) from recorded run token counts. */
export async function aiSpendTodayUsd(now: Date = new Date()): Promise<number> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [row] = await db
    .select({
      prompt: sql<number>`coalesce(sum(${agentRunsTable.promptTokens}), 0)::int`,
      completion: sql<number>`coalesce(sum(${agentRunsTable.completionTokens}), 0)::int`,
    })
    .from(agentRunsTable)
    .where(gte(agentRunsTable.startedAt, dayStart));
  return estimateRunCostUsd(row?.prompt ?? 0, row?.completion ?? 0, aiTokenPricesUsd());
}

/**
 * May agents run right now? `inFlight` adds the tokens of a run still in
 * progress (not yet recorded on its row), so the budget also stops a run
 * mid-way, not only the next one.
 */
export async function agentRunGate(
  now: Date = new Date(),
  inFlight: { promptTokens: number; completionTokens: number } | null = null,
): Promise<StartDecision> {
  const [agentsEnabled, capUsd] = await Promise.all([
    getPolicyBoolean("agents_enabled", "enabled", true),
    getPolicyNumber("max_daily_ai_usd", "usd", 25),
  ]);
  if (!agentsEnabled) return { ok: false, reason: "agents_disabled" };
  const spentTodayUsd =
    (await aiSpendTodayUsd(now)) +
    (inFlight ? estimateRunCostUsd(inFlight.promptTokens, inFlight.completionTokens, aiTokenPricesUsd()) : 0);
  return shouldStartAgentRuns({ agentsEnabled, spentTodayUsd, capUsd });
}

/* ————— Provider failures and backoff ————— */

/** 429 / 5xx from the model provider, or a network failure: the agent did not get to work, so its clock must not advance. */
export function isRetryableProviderError(message: string): boolean {
  return /Grok request failed \((429|5\d\d)\)/.test(message) || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(message);
}

/** Exponential backoff after consecutive provider failures: 5, 10, 20, 40, 60 (cap) minutes. */
export function backoffMs(consecutiveFailures: number): number {
  const base = 5 * 60_000;
  const capped = Math.min(60 * 60_000, base * 2 ** Math.max(0, Math.min(consecutiveFailures - 1, 6)));
  return consecutiveFailures <= 0 ? 0 : capped;
}

/* ————— Retention ————— */

let lastRetentionDay: string | null = null;
const DAY_MS = 86_400_000;
/** The sweep runs once per UTC day, at or after this hour (quiet period for the US venues the business serves). */
export const RETENTION_HOUR_UTC = 3;

export interface RetentionResult {
  transcriptsCleared: number;
  auditDeleted: number;
}

function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Pure: is the nightly sweep due at `now`, given the UTC day it last ran? */
export function retentionDue(now: Date, lastRunDay: string | null, hourUtc = RETENTION_HOUR_UTC): boolean {
  return now.getUTCHours() >= hourUtc && lastRunDay !== utcDayKey(now);
}

/** Null old run transcripts and delete old audit rows. Nightly: once per UTC day after RETENTION_HOUR_UTC. */
export async function runRetention(now: Date = new Date(), force = false): Promise<RetentionResult | null> {
  if (!force && !retentionDue(now, lastRetentionDay)) return null;
  lastRetentionDay = utcDayKey(now);
  const transcriptCutoff = new Date(now.getTime() - transcriptRetentionDays() * DAY_MS);
  const auditCutoff = new Date(now.getTime() - auditRetentionDays() * DAY_MS);
  const cleared = await db
    .update(agentRunsTable)
    .set({ transcript: null })
    .where(and(lt(agentRunsTable.startedAt, transcriptCutoff), isNotNull(agentRunsTable.transcript)))
    .returning({ id: agentRunsTable.id });
  const deleted = await db
    .delete(controlAuditEventsTable)
    .where(lt(controlAuditEventsTable.createdAt, auditCutoff))
    .returning({ id: controlAuditEventsTable.id });
  const result = { transcriptsCleared: cleared.length, auditDeleted: deleted.length };
  if (result.transcriptsCleared > 0 || result.auditDeleted > 0) {
    logger.info(result, "Control-plane retention sweep applied");
  }
  return result;
}
