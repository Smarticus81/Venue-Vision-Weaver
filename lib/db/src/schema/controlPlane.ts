import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  jsonb,
  date,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { venuesTable } from "./venues";
import { coupleSessionsTable } from "./sessions";

/**
 * The autonomous business control plane.
 *
 * A fleet of domain agents (growth, support, product, finance, experiments,
 * sales, activation, governance) observes the product's own data, proposes
 * decisions, and — within policy — executes them. Everything an agent sees,
 * proposes, and does is recorded here so a human can audit or reverse it.
 */

export const AGENT_DOMAINS = [
  "growth",
  "support",
  "product",
  "finance",
  "experiments",
  "sales",
  "activation",
  "governance",
] as const;
export type AgentDomain = (typeof AGENT_DOMAINS)[number];

/**
 * How much rope an agent has.
 * - observe: records observations only, never proposes.
 * - recommend: proposes decisions; every one waits for a human.
 * - supervised: may auto-execute low-risk decisions; anything else waits.
 * - autonomous: may auto-execute low and medium risk; high risk still waits.
 * High-risk decisions ALWAYS require a human. There is no level above this.
 */
export const AUTONOMY_LEVELS = ["observe", "recommend", "supervised", "autonomous"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DECISION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "executed",
  "failed",
  "expired",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const AGENT_RUN_STATUSES = ["running", "succeeded", "failed", "skipped"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const DEFAULT_AGENT_INTERVAL_MINUTES = 60;
export const DEFAULT_DAILY_ACTION_BUDGET = 25;

/** Registered agents and their live operating state, per organization. */
export const controlPlaneAgentsTable = pgTable(
  "control_plane_agents",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    domain: text("domain").notNull(),
    displayName: text("display_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    autonomy: text("autonomy").notNull().default("recommend"),
    status: text("status").notNull().default("idle"),
    healthScore: doublePrecision("health_score").notNull().default(1),
    intervalMinutes: integer("interval_minutes")
      .notNull()
      .default(DEFAULT_AGENT_INTERVAL_MINUTES),
    dailyActionBudget: integer("daily_action_budget")
      .notNull()
      .default(DEFAULT_DAILY_ACTION_BUDGET),
    actionsToday: integer("actions_today").notNull().default(0),
    budgetResetAt: timestamp("budget_reset_at").defaultNow().notNull(),
    lastRunAt: timestamp("last_run_at"),
    nextRunAt: timestamp("next_run_at"),
    lastError: text("last_error"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgAgentUnique: uniqueIndex("control_plane_agents_org_agent_unique").on(
      table.organizationId,
      table.agentKey,
    ),
    dueIdx: index("control_plane_agents_due_idx").on(table.enabled, table.nextRunAt),
  }),
);

/** The signal bus: typed business events the fleet reasons over. */
export const controlPlaneSignalsTable = pgTable(
  "control_plane_signals",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizationsTable.id, {
      onDelete: "cascade",
    }),
    venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("info"),
    source: text("source").notNull().default("product"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    title: text("title").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgOccurredIdx: index("control_plane_signals_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    kindIdx: index("control_plane_signals_kind_idx").on(table.kind),
  }),
);

/** One agent tick. */
export const controlPlaneRunsTable = pgTable(
  "control_plane_runs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    domain: text("domain").notNull(),
    trigger: text("trigger").notNull().default("schedule"),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    observations: jsonb("observations").$type<unknown[]>().notNull().default([]),
    proposedCount: integer("proposed_count").notNull().default(0),
    executedCount: integer("executed_count").notNull().default(0),
    summary: text("summary"),
    narrative: text("narrative"),
    error: text("error"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
  },
  (table) => ({
    orgStartedIdx: index("control_plane_runs_org_started_idx").on(
      table.organizationId,
      table.startedAt,
    ),
  }),
);

/** The decision ledger — every proposal, its evidence, and what became of it. */
export const controlPlaneDecisionsTable = pgTable(
  "control_plane_decisions",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => controlPlaneRunsTable.id, { onDelete: "set null" }),
    agentKey: text("agent_key").notNull(),
    domain: text("domain").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    effect: jsonb("effect").$type<Record<string, unknown>>().notNull().default({}),
    confidence: doublePrecision("confidence").notNull().default(0.5),
    impactScore: doublePrecision("impact_score").notNull().default(0),
    riskLevel: text("risk_level").notNull().default("low"),
    status: text("status").notNull().default("proposed"),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    blockedReason: text("blocked_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    executedAt: timestamp("executed_at"),
    executionResult: jsonb("execution_result").$type<Record<string, unknown> | null>(),
    expiresAt: timestamp("expires_at"),
    // Stable key so a recurring condition produces one open decision, not one per tick.
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgDedupeUnique: uniqueIndex("control_plane_decisions_org_dedupe_unique").on(
      table.organizationId,
      table.dedupeKey,
    ),
    orgStatusIdx: index("control_plane_decisions_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

/** Guardrails: org-level policy the kernel enforces before anything executes. */
export const controlPlanePoliciesTable = pgTable(
  "control_plane_policies",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>().notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgKeyUnique: uniqueIndex("control_plane_policies_org_key_unique").on(
      table.organizationId,
      table.key,
    ),
  }),
);

/** Append-only audit trail. Nothing in the control plane happens off the record. */
export const controlPlaneAuditTable = pgTable(
  "control_plane_audit",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgCreatedIdx: index("control_plane_audit_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const EXPERIMENT_STATUSES = ["draft", "running", "concluded", "aborted"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const controlPlaneExperimentsTable = pgTable(
  "control_plane_experiments",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    hypothesis: text("hypothesis").notNull(),
    surface: text("surface").notNull(),
    primaryMetric: text("primary_metric").notNull(),
    variants: jsonb("variants").$type<{ key: string; weight: number; label: string }[]>().notNull(),
    status: text("status").notNull().default("draft"),
    minimumSampleSize: integer("minimum_sample_size").notNull().default(200),
    startedAt: timestamp("started_at"),
    concludedAt: timestamp("concluded_at"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    createdBy: text("created_by").notNull().default("experiments-agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgKeyUnique: uniqueIndex("control_plane_experiments_org_key_unique").on(
      table.organizationId,
      table.key,
    ),
  }),
);

export const controlPlaneExperimentAssignmentsTable = pgTable(
  "control_plane_experiment_assignments",
  {
    id: serial("id").primaryKey(),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => controlPlaneExperimentsTable.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    variant: text("variant").notNull(),
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (table) => ({
    experimentSubjectUnique: uniqueIndex("control_plane_experiment_subject_unique").on(
      table.experimentId,
      table.subjectKey,
    ),
  }),
);

export const controlPlaneExperimentEventsTable = pgTable(
  "control_plane_experiment_events",
  {
    id: serial("id").primaryKey(),
    experimentId: integer("experiment_id")
      .notNull()
      .references(() => controlPlaneExperimentsTable.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    variant: text("variant").notNull(),
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull().default(1),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  },
  (table) => ({
    experimentMetricIdx: index("control_plane_experiment_events_metric_idx").on(
      table.experimentId,
      table.metric,
    ),
  }),
);

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const controlPlaneTicketsTable = pgTable(
  "control_plane_tickets",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    venueId: integer("venue_id").references(() => venuesTable.id, { onDelete: "set null" }),
    sessionId: integer("session_id").references(() => coupleSessionsTable.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull().default("web"),
    requesterEmail: text("requester_email"),
    requesterName: text("requester_name"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull().default("general"),
    sentiment: text("sentiment").notNull().default("neutral"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    assignedTo: text("assigned_to"),
    aiDraft: text("ai_draft"),
    resolutionNote: text("resolution_note"),
    firstResponseAt: timestamp("first_response_at"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgStatusIdx: index("control_plane_tickets_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

export const LEAD_STAGES = [
  "new",
  "qualified",
  "contacted",
  "demo",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const controlPlaneLeadsTable = pgTable(
  "control_plane_leads",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    source: text("source").notNull().default("inbound"),
    stage: text("stage").notNull().default("new"),
    score: integer("score").notNull().default(0),
    ownerAgent: text("owner_agent").notNull().default("sales-agent"),
    notes: text("notes"),
    nextActionAt: timestamp("next_action_at"),
    lastTouchAt: timestamp("last_touch_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgStageIdx: index("control_plane_leads_org_stage_idx").on(table.organizationId, table.stage),
    orgEmailUnique: uniqueIndex("control_plane_leads_org_email_unique").on(
      table.organizationId,
      table.contactEmail,
    ),
  }),
);

export const WORK_ITEM_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

/** Product repair / upgrade backlog produced by the product agent. */
export const controlPlaneWorkItemsTable = pgTable(
  "control_plane_work_items",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("repair"),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    surface: text("surface").notNull().default("platform"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    decisionId: integer("decision_id").references(() => controlPlaneDecisionsTable.id, {
      onDelete: "set null",
    }),
    dedupeKey: text("dedupe_key").notNull(),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgDedupeUnique: uniqueIndex("control_plane_work_items_org_dedupe_unique").on(
      table.organizationId,
      table.dedupeKey,
    ),
    orgStatusIdx: index("control_plane_work_items_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
  }),
);

/** Daily KPI rollups the finance and growth agents trend over. */
export const controlPlaneMetricsTable = pgTable(
  "control_plane_metrics",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    metricDate: date("metric_date").notNull(),
    metricKey: text("metric_key").notNull(),
    value: doublePrecision("value").notNull(),
    dimensions: jsonb("dimensions").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgDateKeyUnique: uniqueIndex("control_plane_metrics_org_date_key_unique").on(
      table.organizationId,
      table.metricDate,
      table.metricKey,
    ),
  }),
);

/** Durable agent memory: what the fleet learned and should not relearn. */
export const controlPlaneMemoryTable = pgTable(
  "control_plane_memory",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    agentKey: text("agent_key").notNull(),
    kind: text("kind").notNull().default("insight"),
    content: text("content").notNull(),
    importance: doublePrecision("importance").notNull().default(0.5),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    supersededAt: timestamp("superseded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgAgentIdx: index("control_plane_memory_org_agent_idx").on(
      table.organizationId,
      table.agentKey,
    ),
  }),
);

export type ControlPlaneAgent = typeof controlPlaneAgentsTable.$inferSelect;
export type ControlPlaneSignal = typeof controlPlaneSignalsTable.$inferSelect;
export type ControlPlaneRun = typeof controlPlaneRunsTable.$inferSelect;
export type ControlPlaneDecision = typeof controlPlaneDecisionsTable.$inferSelect;
export type ControlPlanePolicy = typeof controlPlanePoliciesTable.$inferSelect;
export type ControlPlaneAuditEntry = typeof controlPlaneAuditTable.$inferSelect;
export type ControlPlaneExperiment = typeof controlPlaneExperimentsTable.$inferSelect;
export type ControlPlaneTicket = typeof controlPlaneTicketsTable.$inferSelect;
export type ControlPlaneLead = typeof controlPlaneLeadsTable.$inferSelect;
export type ControlPlaneWorkItem = typeof controlPlaneWorkItemsTable.$inferSelect;
export type ControlPlaneMetric = typeof controlPlaneMetricsTable.$inferSelect;
export type ControlPlaneMemoryNote = typeof controlPlaneMemoryTable.$inferSelect;
