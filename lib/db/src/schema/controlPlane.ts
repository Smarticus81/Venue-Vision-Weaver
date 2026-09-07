import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Autonomous Business Control Plane.
 *
 * A registry-driven multi-agent operating system runs the business: each
 * domain agent (growth, support, product, finance, experiments, sales,
 * activation, governance) is defined in code, mirrored into control_agents
 * for scheduling/pause state, and every run, task, proposed action, and
 * decision is persisted here with a full audit trail.
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

export const AGENT_STATUSES = ["active", "paused"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_TRIGGERS = ["schedule", "manual"] as const;
export type AgentRunTrigger = (typeof AGENT_RUN_TRIGGERS)[number];

export const AGENT_TASK_STATUSES = ["open", "in_progress", "done", "dismissed"] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

export const AGENT_TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type AgentTaskPriority = (typeof AGENT_TASK_PRIORITIES)[number];

export const AGENT_ACTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
] as const;
export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

export const ACTION_RISK_LEVELS = ["low", "medium", "high"] as const;
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];

export const EXPERIMENT_STATUSES = ["proposed", "running", "completed", "aborted"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const AUDIT_ACTOR_TYPES = ["agent", "operator", "system"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Scheduling + pause state for each code-defined agent. */
export const controlAgentsTable = pgTable("control_agents", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  status: text("status").notNull().default("active"),
  intervalMinutes: integer("interval_minutes").notNull().default(360),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** One reasoning session of one agent, with the full tool-call transcript. */
export const agentRunsTable = pgTable(
  "agent_runs",
  {
    id: serial("id").primaryKey(),
    agentKey: text("agent_key").notNull(),
    trigger: text("trigger").notNull().default("schedule"),
    status: text("status").notNull().default("running"),
    model: text("model"),
    summary: text("summary"),
    error: text("error"),
    transcript: jsonb("transcript").$type<Record<string, unknown>[] | null>(),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => ({
    agentKeyIdx: index("agent_runs_agent_key_idx").on(table.agentKey, table.startedAt),
  }),
);

/** Work items agents raise for humans (or for other agents to pick up). */
export const agentTasksTable = pgTable(
  "agent_tasks",
  {
    id: serial("id").primaryKey(),
    agentKey: text("agent_key").notNull(),
    runId: integer("run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    detail: text("detail"),
    category: text("category"),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("agent_tasks_status_idx").on(table.status, table.createdAt),
  }),
);

/**
 * Governed side effects. Agents can only touch the business through actions;
 * low-risk actions auto-execute, medium/high risk wait for operator approval.
 */
export const agentActionsTable = pgTable(
  "agent_actions",
  {
    id: serial("id").primaryKey(),
    agentKey: text("agent_key").notNull(),
    runId: integer("run_id").references(() => agentRunsTable.id, { onDelete: "set null" }),
    actionType: text("action_type").notNull(),
    title: text("title").notNull(),
    reasoning: text("reasoning"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    riskLevel: text("risk_level").notNull().default("medium"),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    status: text("status").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at"),
    executedAt: timestamp("executed_at"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("agent_actions_status_idx").on(table.status, table.createdAt),
  }),
);

/** Growth/product experiments proposed and tracked by the experiments agent. */
export const controlExperimentsTable = pgTable("control_experiments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  metric: text("metric").notNull(),
  variants: jsonb("variants").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("proposed"),
  result: text("result"),
  createdByAgent: text("created_by_agent"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Periodic KPI snapshots so agents and operators can see trends. */
export const controlMetricsSnapshotsTable = pgTable("control_metrics_snapshots", {
  id: serial("id").primaryKey(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** Immutable audit trail of everything agents, operators, and the system do. */
export const controlAuditEventsTable = pgTable(
  "control_audit_events",
  {
    id: serial("id").primaryKey(),
    actorType: text("actor_type").notNull(),
    actor: text("actor").notNull(),
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    detail: jsonb("detail").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdIdx: index("control_audit_events_created_idx").on(table.createdAt),
  }),
);

/** Governance policy limits (spend caps, email caps, auto-execution flags). */
export const controlPoliciesTable = pgTable(
  "control_policies",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    keyUnique: uniqueIndex("control_policies_key_unique").on(table.key),
  }),
);

export type ControlAgent = typeof controlAgentsTable.$inferSelect;
export type AgentRun = typeof agentRunsTable.$inferSelect;
export type AgentTask = typeof agentTasksTable.$inferSelect;
export type AgentAction = typeof agentActionsTable.$inferSelect;
export type ControlExperiment = typeof controlExperimentsTable.$inferSelect;
export type ControlMetricsSnapshot = typeof controlMetricsSnapshotsTable.$inferSelect;
export type ControlAuditEvent = typeof controlAuditEventsTable.$inferSelect;
export type ControlPolicy = typeof controlPoliciesTable.$inferSelect;
