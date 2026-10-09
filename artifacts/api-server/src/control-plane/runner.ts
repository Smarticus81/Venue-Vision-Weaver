import {
  db,
  controlAgentsTable,
  agentRunsTable,
  agentTasksTable,
  agentActionsTable,
  type AgentRun,
  type AgentRunTrigger,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getAgentDefinition, type AgentDefinition } from "./agents.js";
import { computeBusinessMetrics, type BusinessMetrics } from "./metrics.js";
import { runAgentLoop, controlPlaneModel, type AgentLoopResult } from "./grok.js";
import { toolDeclarations, executeControlPlaneTool } from "./tools.js";
import { recordAuditEvent } from "./audit.js";
import { runDeadlineMs } from "./growth/config.js";
import { agentRunGate, backoffMs, isRetryableProviderError } from "./growth/governance.js";
import { GUIDANCE_AGENT_KEYS, loadSegmentGuidance, renderGuidanceBlock } from "./growth/guidance.js";
import { baseDailyCap, effectiveDailyCap, loadGuard } from "./outreach/sendingHealth.js";
import { getPolicyBoolean, getPolicyNumber } from "./policies.js";

const MAX_SUMMARY_CHARS = 8000;
const RECENT_RUNS_IN_BRIEFING = 5;

/**
 * One run at a time. The sentinel is claimed synchronously before the first
 * await in startAgentRun so two callers in the same tick cannot both pass
 * the "nothing running" check (synthesis: sentinel before await).
 */
const CLAIMING = -1;
let activeRunId: number | null = null;

export function isRunInProgress(): boolean {
  return activeRunId !== null;
}

/* ————— Provider backoff (no lastRunAt advance on 429/5xx) ————— */

let consecutiveProviderFailures = 0;
let providerBackoffUntil = 0;

/** Milliseconds until the scheduler may start another run after provider failures (0 when clear). */
export function providerBackoffRemainingMs(now: Date = new Date()): number {
  return Math.max(0, providerBackoffUntil - now.getTime());
}

/* ————— Briefing ————— */

export interface RecentRun {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  summary: string | null;
}

export interface BriefingParts {
  definition: Pick<AgentDefinition, "key" | "name">;
  now: Date;
  metrics: BusinessMetrics;
  recentRuns: RecentRun[];
  openTasks: Array<{ id: number; title: string; priority: string; status: string }>;
  pendingActions: number;
  /** Autonomous mode (default true): proposals execute without operator approval. */
  autonomous?: boolean;
  /** Rendered GROWTH GUIDANCE block (growth-loop.md 11.4) or null for agents outside the revenue loop. */
  guidanceBlock: string | null;
}

function describeRecentRun(run: RecentRun): string {
  const when = run.startedAt.toISOString();
  if (run.status === "failed") return `${when} failed${run.error ? ` (${run.error.slice(0, 160)})` : ""}`;
  return `${when} ${run.status}`;
}

/** Pure: the user message for one agent run, assembled from already-loaded parts. */
export function composeBriefing(parts: BriefingParts): string {
  const lastSucceeded = parts.recentRuns.find((run) => run.status === "succeeded" && run.summary);
  const lines = [
    `It is ${parts.now.toISOString()}. Run your ${parts.definition.name} review now.`,
    "",
    "CURRENT BUSINESS METRICS (live, just computed):",
    JSON.stringify(parts.metrics),
    "",
  ];
  if (parts.guidanceBlock) lines.push(parts.guidanceBlock, "");
  lines.push(
    parts.recentRuns.length > 0
      ? `YOUR LAST ${parts.recentRuns.length} RUN(S), newest first: ${parts.recentRuns.map(describeRecentRun).join("; ")}.`
      : "This is your first recorded run.",
  );
  if (lastSucceeded?.summary) {
    lines.push(`YOUR PREVIOUS SUCCESSFUL RUN (${lastSucceeded.startedAt.toISOString()}) REPORTED:\n${lastSucceeded.summary.slice(0, 3000)}`);
  }
  const failedStreak = parts.recentRuns.findIndex((run) => run.status !== "failed");
  const consecutiveFailed = failedStreak === -1 ? parts.recentRuns.length : failedStreak;
  if (consecutiveFailed >= 2) {
    lines.push(`Your last ${consecutiveFailed} runs failed. Keep this run short: fewer tool calls, finish with a report.`);
  }
  lines.push(
    "",
    parts.openTasks.length > 0 ? `YOUR OPEN TASKS (do not duplicate): ${JSON.stringify(parts.openTasks)}` : "You have no open tasks.",
    parts.autonomous === false
      ? "MODE: supervised. Medium/high-risk proposals wait for an operator."
      : "MODE: autonomous. Your proposals execute immediately within the caps, kill switches, vetting and send-time checks (prospect emails after a two-minute hold); only update_policy waits for an operator. Act only on evidence you would defend.",
    `You have ${parts.pendingActions} action proposal(s) still awaiting operator approval — do not re-propose the same effect.`,
    "",
    "Investigate with your tools as needed, take governed actions where justified, and finish with your operator report.",
  );
  return lines.join("\n");
}

async function loadGuidanceBlock(definition: AgentDefinition): Promise<string | null> {
  if (!GUIDANCE_AGENT_KEYS.includes(definition.key)) return null;
  try {
    const [guidance, guard, baseCap, effectiveCap, campaignSteps] = await Promise.all([
      loadSegmentGuidance(),
      loadGuard(),
      baseDailyCap(),
      effectiveDailyCap(),
      getPolicyNumber("max_campaign_steps", "steps", 3),
    ]);
    return renderGuidanceBlock({ guard, baseCap, effectiveCap, guidance, campaignSteps });
  } catch (err) {
    logger.warn({ err, agentKey: definition.key }, "Growth guidance unavailable for the briefing");
    return null;
  }
}

async function buildRunBriefing(definition: AgentDefinition, now: Date): Promise<string> {
  const [metrics, recentRuns, openTasks, [pendingCount], guidanceBlock, autonomous] = await Promise.all([
    computeBusinessMetrics(),
    db
      .select({
        summary: agentRunsTable.summary,
        status: agentRunsTable.status,
        startedAt: agentRunsTable.startedAt,
        finishedAt: agentRunsTable.finishedAt,
        error: agentRunsTable.error,
      })
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.agentKey, definition.key), sql`${agentRunsTable.status} <> 'running'`))
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(RECENT_RUNS_IN_BRIEFING),
    db
      .select({
        id: agentTasksTable.id,
        title: agentTasksTable.title,
        priority: agentTasksTable.priority,
        status: agentTasksTable.status,
      })
      .from(agentTasksTable)
      .where(and(eq(agentTasksTable.agentKey, definition.key), sql`${agentTasksTable.status} in ('open', 'in_progress')`))
      .orderBy(desc(agentTasksTable.createdAt))
      .limit(20),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentActionsTable)
      .where(and(eq(agentActionsTable.agentKey, definition.key), eq(agentActionsTable.status, "pending"))),
    loadGuidanceBlock(definition),
    getPolicyBoolean("autonomous_mode", "enabled", true),
  ]);

  return composeBriefing({
    definition,
    now,
    metrics,
    recentRuns,
    openTasks,
    pendingActions: pendingCount?.total ?? 0,
    autonomous,
    guidanceBlock,
  });
}

/* ————— Execution ————— */

export class RunDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`Run exceeded the ${Math.round(deadlineMs / 60_000)}-minute deadline and was abandoned.`);
    this.name = "RunDeadlineError";
  }
}

/**
 * Race the reasoning loop against the wall-clock deadline; the late result is
 * discarded by the caller. On the deadline the loop is aborted (onDeadline),
 * so an abandoned run makes no further model or tool calls.
 */
function withDeadline<T>(work: Promise<T>, deadlineMs: number, onDeadline?: (err: RunDeadlineError) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new RunDeadlineError(deadlineMs);
      onDeadline?.(err);
      reject(err);
    }, deadlineMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function finishRun(runId: number, definition: AgentDefinition, result: AgentLoopResult): Promise<void> {
  const [updated] = await db
    .update(agentRunsTable)
    .set({
      status: "succeeded",
      summary: result.finalText.slice(0, MAX_SUMMARY_CHARS),
      transcript: result.transcript as unknown as Record<string, unknown>[],
      toolCallCount: result.toolCallCount,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      finishedAt: new Date(),
    })
    .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.status, "running")))
    .returning({ id: agentRunsTable.id });
  if (!updated) {
    // The run was already closed (deadline or restart); the late result is logged, never applied.
    logger.warn({ agentKey: definition.key, runId }, "Agent loop finished after its run was closed; result discarded");
    return;
  }
  consecutiveProviderFailures = 0;
  providerBackoffUntil = 0;
  await db
    .update(controlAgentsTable)
    .set({ lastRunAt: new Date(), lastRunStatus: "succeeded", updatedAt: new Date() })
    .where(eq(controlAgentsTable.key, definition.key));
  await recordAuditEvent({
    actorType: "agent",
    actor: definition.key,
    eventType: "run_succeeded",
    subjectType: "run",
    subjectId: runId,
    detail: { toolCallCount: result.toolCallCount, promptTokens: result.promptTokens, completionTokens: result.completionTokens },
  });
  logger.info({ agentKey: definition.key, runId, toolCalls: result.toolCallCount }, "Control-plane agent run succeeded");
}

async function failRun(
  runId: number,
  definition: AgentDefinition,
  err: unknown,
  usage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 },
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = isRetryableProviderError(message);
  const deadline = err instanceof RunDeadlineError;
  logger.error({ err, agentKey: definition.key, runId, retryable, deadline }, "Control-plane agent run failed");
  // Tokens spent before the failure count toward max_daily_ai_usd.
  await db
    .update(agentRunsTable)
    .set({
      status: "failed",
      error: message.slice(0, 2000),
      finishedAt: new Date(),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    })
    .where(and(eq(agentRunsTable.id, runId), eq(agentRunsTable.status, "running")));

  if (retryable) {
    // The agent never got to work: keep it due (no lastRunAt advance) and back off process-wide.
    consecutiveProviderFailures += 1;
    providerBackoffUntil = Date.now() + backoffMs(consecutiveProviderFailures);
    await db
      .update(controlAgentsTable)
      .set({ lastRunStatus: "failed", updatedAt: new Date() })
      .where(eq(controlAgentsTable.key, definition.key));
  } else {
    await db
      .update(controlAgentsTable)
      .set({ lastRunAt: new Date(), lastRunStatus: "failed", updatedAt: new Date() })
      .where(eq(controlAgentsTable.key, definition.key));
  }
  await recordAuditEvent({
    actorType: "agent",
    actor: definition.key,
    eventType: "run_failed",
    subjectType: "run",
    subjectId: runId,
    detail: { error: message.slice(0, 500), retryable, deadline, backoffMs: retryable ? backoffMs(consecutiveProviderFailures) : 0 },
  });
}

export class RunHaltedError extends Error {
  constructor(reason: string) {
    super(`Run stopped mid-way: ${reason}.`);
    this.name = "RunHaltedError";
  }
}

/** Kill-switch check between tool calls, cached briefly so a run does not hit the DB per call. */
const GATE_RECHECK_MS = 5_000;

export function createMidRunGate(check: () => Promise<{ ok: boolean; reason?: string }>, now: () => number = Date.now) {
  let cached: { at: number; ok: boolean; reason?: string } | null = null;
  return async (): Promise<{ ok: boolean; reason?: string }> => {
    if (cached && now() - cached.at < GATE_RECHECK_MS) return cached;
    const result = await check();
    cached = { at: now(), ok: result.ok, reason: result.reason };
    return cached;
  };
}

async function executeRun(runId: number, definition: AgentDefinition): Promise<void> {
  const deadlineMs = runDeadlineMs();
  const startedAt = Date.now();
  const usage = { promptTokens: 0, completionTokens: 0 };
  const controller = new AbortController();
  // agents_enabled and max_daily_ai_usd are enforced between tool calls too,
  // not only when a run starts: an operator's kill switch stops a run.
  const midRunGate = createMidRunGate(async () => {
    const gate = await agentRunGate(new Date(), usage);
    return gate.ok ? { ok: true } : { ok: false, reason: gate.reason };
  });
  try {
    const briefing = await buildRunBriefing(definition, new Date());
    const result = await withDeadline(
      runAgentLoop({
        systemPrompt: definition.mission,
        userMessage: briefing,
        tools: toolDeclarations(definition.tools, definition.key),
        enableWebSearch: definition.webSearch === true,
        usage,
        signal: controller.signal,
        executeTool: async (name, args) => {
          if (!definition.tools.includes(name)) {
            throw new Error(`Tool "${name}" is not granted to ${definition.key}.`);
          }
          if (Date.now() - startedAt > deadlineMs) {
            throw new RunDeadlineError(deadlineMs);
          }
          const gate = await midRunGate();
          if (!gate.ok) {
            const halted = new RunHaltedError(gate.reason === "agents_disabled" ? "agents_enabled was turned off" : `${gate.reason ?? "kill switch"}`);
            controller.abort(halted);
            throw halted;
          }
          return executeControlPlaneTool(name, args, { agentKey: definition.key, runId });
        },
      }),
      deadlineMs,
      (err) => controller.abort(err),
    );
    await finishRun(runId, definition, result);
  } catch (err) {
    const cause = controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : err;
    try {
      await failRun(runId, definition, cause, usage);
    } catch (inner) {
      logger.error({ err: inner, runId }, "Failed to record the agent run failure");
    }
  } finally {
    if (activeRunId === runId) activeRunId = null;
  }
}

/**
 * Create the run row synchronously (so callers get an id immediately) and
 * execute the reasoning loop in the background. Only one run at a time — the
 * agents share business context and serial runs keep spend predictable.
 * Honours the agents_enabled kill switch and the max_daily_ai_usd budget for
 * scheduled and manual runs alike.
 */
export async function startAgentRun(agentKey: string, trigger: AgentRunTrigger): Promise<AgentRun> {
  const definition = getAgentDefinition(agentKey);
  if (!definition) throw new Error(`Unknown agent "${agentKey}".`);
  if (activeRunId !== null) {
    throw new Error("Another agent run is already in progress. Try again shortly.");
  }
  // Claim the slot before the first await so a concurrent caller sees it taken.
  activeRunId = CLAIMING;

  let run: AgentRun | undefined;
  try {
    const gate = await agentRunGate();
    if (!gate.ok) {
      throw new Error(
        gate.reason === "agents_disabled"
          ? "Agent runs are disabled by the agents_enabled policy."
          : "Today's AI spend budget (max_daily_ai_usd) is exhausted; runs resume tomorrow or after the policy is raised.",
      );
    }
    [run] = await db
      .insert(agentRunsTable)
      .values({ agentKey: definition.key, trigger, status: "running", model: controlPlaneModel() })
      .returning();
    if (!run) throw new Error("Failed to create agent run.");
  } catch (err) {
    activeRunId = null;
    throw err;
  }

  activeRunId = run.id;
  await recordAuditEvent({
    actorType: trigger === "manual" ? "operator" : "system",
    actor: trigger === "manual" ? "operator" : "scheduler",
    eventType: "run_started",
    subjectType: "run",
    subjectId: run.id,
    detail: { agentKey: definition.key, trigger },
  });

  void executeRun(run.id, definition);
  return run;
}
