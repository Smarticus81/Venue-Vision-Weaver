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
import { computeBusinessMetrics } from "./metrics.js";
import { runAgentLoop, controlPlaneModel } from "./gemini.js";
import { toolDeclarations, executeControlPlaneTool } from "./tools.js";
import { recordAuditEvent } from "./audit.js";

const MAX_SUMMARY_CHARS = 8000;

let activeRunId: number | null = null;

export function isRunInProgress(): boolean {
  return activeRunId !== null;
}

async function buildRunBriefing(definition: AgentDefinition): Promise<string> {
  const [metrics, [lastRun], openTasks, [pendingCount]] = await Promise.all([
    computeBusinessMetrics(),
    db
      .select({
        summary: agentRunsTable.summary,
        status: agentRunsTable.status,
        startedAt: agentRunsTable.startedAt,
      })
      .from(agentRunsTable)
      .where(and(eq(agentRunsTable.agentKey, definition.key), eq(agentRunsTable.status, "succeeded")))
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(1),
    db
      .select({
        id: agentTasksTable.id,
        title: agentTasksTable.title,
        priority: agentTasksTable.priority,
        status: agentTasksTable.status,
      })
      .from(agentTasksTable)
      .where(
        and(
          eq(agentTasksTable.agentKey, definition.key),
          sql`${agentTasksTable.status} in ('open', 'in_progress')`,
        ),
      )
      .orderBy(desc(agentTasksTable.createdAt))
      .limit(20),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentActionsTable)
      .where(
        and(eq(agentActionsTable.agentKey, definition.key), eq(agentActionsTable.status, "pending")),
      ),
  ]);

  return [
    `It is ${new Date().toISOString()}. Run your ${definition.name} review now.`,
    "",
    "CURRENT BUSINESS METRICS (live, just computed):",
    JSON.stringify(metrics),
    "",
    lastRun?.summary
      ? `YOUR PREVIOUS RUN (${lastRun.startedAt.toISOString()}) REPORTED:\n${lastRun.summary.slice(0, 3000)}`
      : "This is your first recorded run.",
    "",
    openTasks.length > 0
      ? `YOUR OPEN TASKS (do not duplicate): ${JSON.stringify(openTasks)}`
      : "You have no open tasks.",
    `You have ${pendingCount?.total ?? 0} action proposal(s) still awaiting operator approval — do not re-propose the same effect.`,
    "",
    "Investigate with your tools as needed, take governed actions where justified, and finish with your operator report.",
  ].join("\n");
}

async function executeRun(runId: number, definition: AgentDefinition): Promise<void> {
  try {
    const briefing = await buildRunBriefing(definition);
    const result = await runAgentLoop({
      systemPrompt: definition.mission,
      userMessage: briefing,
      tools: toolDeclarations(definition.tools),
      executeTool: (name, args) => {
        if (!definition.tools.includes(name)) {
          return Promise.reject(new Error(`Tool "${name}" is not granted to ${definition.key}.`));
        }
        return executeControlPlaneTool(name, args, { agentKey: definition.key, runId });
      },
    });

    await db
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
      .where(eq(agentRunsTable.id, runId));
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
      detail: { toolCallCount: result.toolCallCount },
    });
    logger.info(
      { agentKey: definition.key, runId, toolCalls: result.toolCallCount },
      "Control-plane agent run succeeded",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, agentKey: definition.key, runId }, "Control-plane agent run failed");
    await db
      .update(agentRunsTable)
      .set({ status: "failed", error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(agentRunsTable.id, runId));
    await db
      .update(controlAgentsTable)
      .set({ lastRunAt: new Date(), lastRunStatus: "failed", updatedAt: new Date() })
      .where(eq(controlAgentsTable.key, definition.key));
    await recordAuditEvent({
      actorType: "agent",
      actor: definition.key,
      eventType: "run_failed",
      subjectType: "run",
      subjectId: runId,
      detail: { error: message.slice(0, 500) },
    });
  } finally {
    if (activeRunId === runId) activeRunId = null;
  }
}

/**
 * Create the run row synchronously (so callers get an id immediately) and
 * execute the reasoning loop in the background. Only one run at a time — the
 * agents share business context and serial runs keep spend predictable.
 */
export async function startAgentRun(
  agentKey: string,
  trigger: AgentRunTrigger,
): Promise<AgentRun> {
  const definition = getAgentDefinition(agentKey);
  if (!definition) throw new Error(`Unknown agent "${agentKey}".`);
  if (activeRunId !== null) {
    throw new Error("Another agent run is already in progress. Try again shortly.");
  }

  const [run] = await db
    .insert(agentRunsTable)
    .values({
      agentKey: definition.key,
      trigger,
      status: "running",
      model: controlPlaneModel(),
    })
    .returning();
  if (!run) throw new Error("Failed to create agent run.");

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
