import {
  db,
  venuesTable,
  venueMediaTable,
  organizationsTable,
  coupleSessionsTable,
  creditTransactionsTable,
  agentTasksTable,
  agentActionsTable,
  agentRunsTable,
  controlExperimentsTable,
  controlAuditEventsTable,
  AGENT_TASK_PRIORITIES,
  EXPERIMENT_STATUSES,
} from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { computeBusinessMetrics } from "./metrics.js";
import { ACTION_CATALOG, describeActionCatalog, proposeAction } from "./actions.js";
import { listPolicies } from "./policies.js";
import { recordAuditEvent } from "./audit.js";
import type { GeminiFunctionDeclaration } from "./gemini.js";

export interface ToolContext {
  agentKey: string;
  runId: number;
}

interface ControlPlaneTool {
  declaration: GeminiFunctionDeclaration;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function num(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

const TOOLS: Record<string, ControlPlaneTool> = {
  get_business_metrics: {
    declaration: {
      name: "get_business_metrics",
      description:
        "Live business KPIs computed from production tables: organizations, venues, sessions, credits, activation, failure rates.",
      parameters: { type: "object", properties: {} },
    },
    execute: () => computeBusinessMetrics(),
  },

  list_venues: {
    declaration: {
      name: "list_venues",
      description:
        "List venues with organization plan/credits, media count, and session counts. Sort by newest or least_active to find activation and sales targets.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
          sort: { type: "string", enum: ["newest", "least_active"], description: "Sort order." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      const mediaCount = sql<number>`(select count(*)::int from ${venueMediaTable} where ${venueMediaTable.venueId} = ${venuesTable.id})`;
      const sessionCount = sql<number>`(select count(*)::int from ${coupleSessionsTable} where ${coupleSessionsTable.venueId} = ${venuesTable.id})`;
      const rows = await db
        .select({
          id: venuesTable.id,
          name: venuesTable.name,
          slug: venuesTable.slug,
          organizationId: venuesTable.organizationId,
          createdAt: venuesTable.createdAt,
          mediaCount,
          sessionCount,
          orgName: organizationsTable.name,
          orgPlan: organizationsTable.plan,
          orgCredits: organizationsTable.creditsBalance,
        })
        .from(venuesTable)
        .leftJoin(organizationsTable, eq(venuesTable.organizationId, organizationsTable.id))
        .orderBy(
          args.sort === "least_active"
            ? sql`(select count(*) from ${coupleSessionsTable} where ${coupleSessionsTable.venueId} = ${venuesTable.id}) asc, ${venuesTable.createdAt} desc`
            : desc(venuesTable.createdAt),
        )
        .limit(limit);
      return { venues: rows };
    },
  },

  list_organizations: {
    declaration: {
      name: "list_organizations",
      description:
        "List billing organizations with plan, credit balance, venue count, and last session date. Use to find upsell, churn-risk, and low-credit accounts.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      const venueCount = sql<number>`(select count(*)::int from ${venuesTable} where ${venuesTable.organizationId} = ${organizationsTable.id})`;
      const lastSession = sql<string | null>`(select max(${coupleSessionsTable.createdAt})::text from ${coupleSessionsTable} join ${venuesTable} on ${venuesTable.id} = ${coupleSessionsTable.venueId} where ${venuesTable.organizationId} = ${organizationsTable.id})`;
      const rows = await db
        .select({
          id: organizationsTable.id,
          name: organizationsTable.name,
          plan: organizationsTable.plan,
          creditsBalance: organizationsTable.creditsBalance,
          billingPeriodEnd: organizationsTable.billingPeriodEnd,
          createdAt: organizationsTable.createdAt,
          venueCount,
          lastSessionAt: lastSession,
        })
        .from(organizationsTable)
        .orderBy(desc(organizationsTable.createdAt))
        .limit(limit);
      return { organizations: rows };
    },
  },

  list_recent_sessions: {
    declaration: {
      name: "list_recent_sessions",
      description:
        "Recent couple sessions with venue name, status, error message, and timings. Filter by status (pending, processing, ready, failed) to find stuck or failed work.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional status filter." },
          days: { type: "integer", description: "Lookback window in days (default 14, max 90)." },
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      const days = num(args.days, 14, 90);
      const status = str(args.status);
      const conditions = [gte(coupleSessionsTable.createdAt, daysAgo(days))];
      if (status) conditions.push(eq(coupleSessionsTable.status, status));
      const rows = await db
        .select({
          id: coupleSessionsTable.id,
          venueId: coupleSessionsTable.venueId,
          venueName: venuesTable.name,
          venueSlug: venuesTable.slug,
          status: coupleSessionsTable.status,
          errorMessage: coupleSessionsTable.errorMessage,
          coupleName: coupleSessionsTable.coupleName,
          creditsCharged: coupleSessionsTable.creditsCharged,
          createdAt: coupleSessionsTable.createdAt,
          completedAt: coupleSessionsTable.completedAt,
        })
        .from(coupleSessionsTable)
        .leftJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
        .where(and(...conditions))
        .orderBy(desc(coupleSessionsTable.createdAt))
        .limit(limit);
      return { sessions: rows };
    },
  },

  get_credit_ledger: {
    declaration: {
      name: "get_credit_ledger",
      description:
        "Recent credit ledger rows plus per-reason totals over a window. This is the financial source of truth (grants, purchases, session debits, refunds).",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Lookback window in days (default 30, max 180)." },
          limit: { type: "integer", description: "Max ledger rows (default 40, max 100)." },
        },
      },
    },
    async execute(args) {
      const days = num(args.days, 30, 180);
      const limit = num(args.limit, 40, 100);
      const since = daysAgo(days);
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: creditTransactionsTable.id,
            organizationId: creditTransactionsTable.organizationId,
            venueId: creditTransactionsTable.venueId,
            sessionId: creditTransactionsTable.sessionId,
            delta: creditTransactionsTable.delta,
            reason: creditTransactionsTable.reason,
            createdAt: creditTransactionsTable.createdAt,
          })
          .from(creditTransactionsTable)
          .where(gte(creditTransactionsTable.createdAt, since))
          .orderBy(desc(creditTransactionsTable.createdAt))
          .limit(limit),
        db
          .select({
            reason: creditTransactionsTable.reason,
            total: sql<number>`coalesce(sum(${creditTransactionsTable.delta}), 0)::int`,
            rows: sql<number>`count(*)::int`,
          })
          .from(creditTransactionsTable)
          .where(gte(creditTransactionsTable.createdAt, since))
          .groupBy(creditTransactionsTable.reason),
      ]);
      return { windowDays: days, totalsByReason: totals, transactions: rows };
    },
  },

  list_open_tasks: {
    declaration: {
      name: "list_open_tasks",
      description:
        "Open and in-progress control-plane tasks across all agents. Check before creating a task to avoid duplicates.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 30, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 30, 100);
      const rows = await db
        .select()
        .from(agentTasksTable)
        .where(sql`${agentTasksTable.status} in ('open', 'in_progress')`)
        .orderBy(desc(agentTasksTable.createdAt))
        .limit(limit);
      return { tasks: rows };
    },
  },

  list_recent_actions: {
    declaration: {
      name: "list_recent_actions",
      description:
        "Recent governed actions (pending, approved, rejected, executed, failed) across all agents, with params and results.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 30, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 30, 100);
      const rows = await db
        .select()
        .from(agentActionsTable)
        .orderBy(desc(agentActionsTable.createdAt))
        .limit(limit);
      return { actionCatalog: describeActionCatalog(), actions: rows };
    },
  },

  list_recent_runs: {
    declaration: {
      name: "list_recent_runs",
      description:
        "Recent agent runs across the control plane with status, summary, and tool-call counts. Use to review what other agents did.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 20, max 50)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 20, 50);
      const rows = await db
        .select({
          id: agentRunsTable.id,
          agentKey: agentRunsTable.agentKey,
          trigger: agentRunsTable.trigger,
          status: agentRunsTable.status,
          summary: agentRunsTable.summary,
          error: agentRunsTable.error,
          toolCallCount: agentRunsTable.toolCallCount,
          startedAt: agentRunsTable.startedAt,
          finishedAt: agentRunsTable.finishedAt,
        })
        .from(agentRunsTable)
        .orderBy(desc(agentRunsTable.startedAt))
        .limit(limit);
      return { runs: rows };
    },
  },

  list_experiments: {
    declaration: {
      name: "list_experiments",
      description: "All experiments with hypothesis, metric, status, and results.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 20, max 50)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 20, 50);
      const rows = await db
        .select()
        .from(controlExperimentsTable)
        .orderBy(desc(controlExperimentsTable.createdAt))
        .limit(limit);
      return { experiments: rows };
    },
  },

  get_audit_log: {
    declaration: {
      name: "get_audit_log",
      description:
        "Immutable audit trail of agent, operator, and system events (proposals, approvals, executions, policy changes).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 40, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 40, 100);
      const rows = await db
        .select()
        .from(controlAuditEventsTable)
        .orderBy(desc(controlAuditEventsTable.createdAt))
        .limit(limit);
      return { events: rows };
    },
  },

  get_policies: {
    declaration: {
      name: "get_policies",
      description: "Current governance policies (spend caps, email caps, auto-execution flags).",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      return { policies: await listPolicies() };
    },
  },

  create_task: {
    declaration: {
      name: "create_task",
      description:
        "Raise a work item for the operator team (or a future agent run). Duplicate open titles are rejected, so check list_open_tasks first.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative title." },
          detail: {
            type: "string",
            description: "Full context: evidence, affected entities, and the recommended fix.",
          },
          category: {
            type: "string",
            description: "Free-form category, e.g. growth, support, engineering, finance.",
          },
          priority: { type: "string", enum: [...AGENT_TASK_PRIORITIES] },
        },
        required: ["title", "detail", "priority"],
      },
    },
    async execute(args, ctx) {
      const title = str(args.title);
      const detail = str(args.detail);
      const priorityRaw = str(args.priority);
      const priority = AGENT_TASK_PRIORITIES.includes(
        priorityRaw as (typeof AGENT_TASK_PRIORITIES)[number],
      )
        ? (priorityRaw as (typeof AGENT_TASK_PRIORITIES)[number])
        : "medium";
      if (!title || !detail) throw new Error("title and detail are required.");

      const [duplicate] = await db
        .select({ id: agentTasksTable.id })
        .from(agentTasksTable)
        .where(
          and(
            eq(agentTasksTable.title, title),
            sql`${agentTasksTable.status} in ('open', 'in_progress')`,
          ),
        )
        .limit(1);
      if (duplicate) {
        return { created: false, reason: "duplicate_open_task", existingTaskId: duplicate.id };
      }

      const [task] = await db
        .insert(agentTasksTable)
        .values({
          agentKey: ctx.agentKey,
          runId: ctx.runId,
          title,
          detail,
          category: str(args.category),
          priority,
        })
        .returning();
      await recordAuditEvent({
        actorType: "agent",
        actor: ctx.agentKey,
        eventType: "task_created",
        subjectType: "task",
        subjectId: task?.id,
        detail: { title, priority },
      });
      return { created: true, task };
    },
  },

  propose_action: {
    declaration: {
      name: "propose_action",
      description:
        `Propose a governed side effect. Low-risk actions may auto-execute; medium/high risk actions enter the operator approval queue. Action types: ${Object.values(
          ACTION_CATALOG,
        )
          .map((a) => `${a.type} (${a.riskLevel}): ${a.description}`)
          .join(" | ")}`,
      parameters: {
        type: "object",
        properties: {
          actionType: { type: "string", enum: Object.keys(ACTION_CATALOG) },
          title: { type: "string", description: "One-line description of the concrete effect." },
          reasoning: {
            type: "string",
            description: "Why this action is justified now, citing the data you inspected.",
          },
          params: {
            type: "object",
            description:
              "Action parameters. send_venue_email: {venueSlug, subject, message}. grant_promo_credits: {organizationId, amount, note}. requeue_failed_session: {sessionId}. pause_agent/resume_agent: {agentKey}. update_policy: {key, value, note}.",
          },
        },
        required: ["actionType", "title", "reasoning", "params"],
      },
    },
    async execute(args, ctx) {
      const actionType = str(args.actionType);
      const title = str(args.title);
      const reasoning = str(args.reasoning);
      const params =
        args.params && typeof args.params === "object" && !Array.isArray(args.params)
          ? (args.params as Record<string, unknown>)
          : null;
      if (!actionType || !title || !params) {
        throw new Error("actionType, title, and params are required.");
      }
      const action = await proposeAction({
        agentKey: ctx.agentKey,
        runId: ctx.runId,
        actionType,
        title,
        reasoning: reasoning ?? undefined,
        params,
      });
      return {
        actionId: action.id,
        status: action.status,
        riskLevel: action.riskLevel,
        requiresApproval: action.requiresApproval,
        result: action.result,
        error: action.error,
      };
    },
  },

  create_experiment: {
    declaration: {
      name: "create_experiment",
      description:
        "Register a growth/product experiment (status: proposed) with a falsifiable hypothesis and a primary metric.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          hypothesis: { type: "string", description: "Falsifiable statement being tested." },
          metric: { type: "string", description: "Primary success metric." },
          variants: {
            type: "object",
            description: "Optional variant descriptions, e.g. {control: '...', treatment: '...'}.",
          },
        },
        required: ["name", "hypothesis", "metric"],
      },
    },
    async execute(args, ctx) {
      const name = str(args.name);
      const hypothesis = str(args.hypothesis);
      const metric = str(args.metric);
      if (!name || !hypothesis || !metric) {
        throw new Error("name, hypothesis, and metric are required.");
      }
      const [duplicate] = await db
        .select({ id: controlExperimentsTable.id })
        .from(controlExperimentsTable)
        .where(
          and(
            eq(controlExperimentsTable.name, name),
            sql`${controlExperimentsTable.status} in ('proposed', 'running')`,
          ),
        )
        .limit(1);
      if (duplicate) {
        return { created: false, reason: "duplicate_experiment", existingExperimentId: duplicate.id };
      }
      const [experiment] = await db
        .insert(controlExperimentsTable)
        .values({
          name,
          hypothesis,
          metric,
          variants:
            args.variants && typeof args.variants === "object" && !Array.isArray(args.variants)
              ? (args.variants as Record<string, unknown>)
              : null,
          createdByAgent: ctx.agentKey,
        })
        .returning();
      await recordAuditEvent({
        actorType: "agent",
        actor: ctx.agentKey,
        eventType: "experiment_created",
        subjectType: "experiment",
        subjectId: experiment?.id,
        detail: { name, metric },
      });
      return { created: true, experiment };
    },
  },

  update_experiment: {
    declaration: {
      name: "update_experiment",
      description:
        "Move an experiment through its lifecycle (proposed -> running -> completed/aborted) and record the result readout.",
      parameters: {
        type: "object",
        properties: {
          experimentId: { type: "integer" },
          status: { type: "string", enum: [...EXPERIMENT_STATUSES] },
          result: { type: "string", description: "Readout / learnings. Required when completing or aborting." },
        },
        required: ["experimentId", "status"],
      },
    },
    async execute(args, ctx) {
      const experimentId = num(args.experimentId, 0, Number.MAX_SAFE_INTEGER);
      const statusRaw = str(args.status);
      if (
        !experimentId ||
        !EXPERIMENT_STATUSES.includes(statusRaw as (typeof EXPERIMENT_STATUSES)[number])
      ) {
        throw new Error(`experimentId and a status in [${EXPERIMENT_STATUSES.join(", ")}] are required.`);
      }
      const status = statusRaw as (typeof EXPERIMENT_STATUSES)[number];
      const result = str(args.result);
      if ((status === "completed" || status === "aborted") && !result) {
        throw new Error("result is required when completing or aborting an experiment.");
      }
      const now = new Date();
      const [experiment] = await db
        .update(controlExperimentsTable)
        .set({
          status,
          result: result ?? undefined,
          startedAt: status === "running" ? now : undefined,
          endedAt: status === "completed" || status === "aborted" ? now : undefined,
          updatedAt: now,
        })
        .where(eq(controlExperimentsTable.id, experimentId))
        .returning();
      if (!experiment) throw new Error(`Experiment ${experimentId} not found.`);
      await recordAuditEvent({
        actorType: "agent",
        actor: ctx.agentKey,
        eventType: "experiment_updated",
        subjectType: "experiment",
        subjectId: experimentId,
        detail: { status, result },
      });
      return { experiment };
    },
  },
};

export const TOOL_NAMES = Object.keys(TOOLS) as Array<keyof typeof TOOLS & string>;

export function toolDeclarations(names: string[]): GeminiFunctionDeclaration[] {
  return names
    .map((name) => TOOLS[name]?.declaration)
    .filter((decl): decl is GeminiFunctionDeclaration => Boolean(decl));
}

export async function executeControlPlaneTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  return tool.execute(args, ctx);
}
