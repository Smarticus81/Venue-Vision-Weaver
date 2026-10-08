import { db, controlExperimentsTable, EXPERIMENT_STATUSES } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { recordAuditEvent } from "../audit.js";
import { num, str, type ControlPlaneTool } from "../toolTypes.js";

/**
 * Growth-owned agent tools, merged into the registry by tools.ts
 * (`{ ...CORE_TOOLS, ...vettingTools, ...growthTools }`). The experiment
 * tools moved here unchanged from tools.ts; the three KPI/guidance tools are
 * step-0 stubs so every grant in agents.ts resolves. The growth workstream
 * reshapes them (growth-loop.md 8.4 and 11.2).
 */

const NOT_IMPLEMENTED = { ok: false as const, reason: "not implemented yet" };

export const growthTools: Record<string, ControlPlaneTool> = {
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

  // ----- step-0 stubs (growth-loop.md 11.2 declarations; bodies land with the growth workstream) -----

  get_growth_kpis: {
    declaration: {
      name: "get_growth_kpis",
      description:
        "Outcome KPIs from the latest snapshot: signups by week, activation funnel and time to first gallery, trial-to-paid by cohort (paid = subscription or credit pack), plan mix and MRR estimate, credits, churn, outbound funnel by segment/variant/campaign/step, deliverability. Pass section to get one part.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: [
              "signups",
              "activation",
              "trialToPaid",
              "revenue",
              "credits",
              "churn",
              "outbound",
              "deliverability",
              "experiments",
              "all",
            ],
          },
          fresh: { type: "boolean", description: "Recompute now instead of using the latest snapshot (slow)." },
        },
      },
    },
    async execute() {
      return NOT_IMPLEMENTED;
    },
  },

  get_growth_guidance: {
    declaration: {
      name: "get_growth_guidance",
      description:
        "Deterministic adaptation state: segment prioritize/pause lists with their rates, deliverability guard and effective daily cap, copy variants with weights and stats, campaign step cap, and the last 10 rule firings.",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      return NOT_IMPLEMENTED;
    },
  },

  evaluate_experiment: {
    declaration: {
      name: "evaluate_experiment",
      description:
        "Run the deterministic evaluator for one experiment against the latest snapshot and return what it would decide today. Does not change the experiment.",
      parameters: {
        type: "object",
        properties: { experimentId: { type: "integer" } },
        required: ["experimentId"],
      },
    },
    async execute() {
      return NOT_IMPLEMENTED;
    },
  },
};
