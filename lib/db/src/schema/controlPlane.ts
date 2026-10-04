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
 * domain agent is defined in code, mirrored into control_agents for
 * scheduling/pause state, and every run, task, proposed action, and decision
 * is persisted here with a full audit trail. Revenue domains (prospecting,
 * outreach, campaigns) additionally own the prospect pipeline tables below.
 */

export const AGENT_DOMAINS = [
  "prospecting",
  "outreach",
  "campaigns",
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

/**
 * Prospect lifecycle. Agents may move prospects between new, qualified, and
 * disqualified; "contacted" is set by the governed send action; replied,
 * converted, and unsubscribed are operator-recorded facts (inbound email is
 * read by humans) that agents must respect but can never set themselves.
 */
export const PROSPECT_STATUSES = [
  "new",
  "qualified",
  "contacted",
  "replied",
  "converted",
  "unsubscribed",
  "disqualified",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const PROSPECT_SOURCES = ["agent_research", "operator_import", "inbound"] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

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

/**
 * Multi-step outreach campaigns designed by the campaigns agent. A campaign
 * is a named sequence of outreach steps; it only becomes able to generate
 * sends after an operator approves the launch_campaign action, and every
 * individual email still goes through the send_prospect_email approval.
 */
export const controlCampaignsTable = pgTable("control_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  audience: text("audience"),
  /** Ordered sequence: [{ step, waitDays, guidance }] — guidance steers the drafting agent. */
  steps: jsonb("steps").$type<Array<Record<string, unknown>>>().notNull(),
  status: text("status").notNull().default("draft"),
  createdByAgent: text("created_by_agent"),
  launchedAt: timestamp("launched_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Prospective venue customers discovered by the prospecting agent or imported
 * by operators. Email is the dedupe key (stored lowercased, unique). Contact
 * bookkeeping (contactCount, lastContactedAt, campaignStep) is written only
 * by the governed send_prospect_email action, never directly by agents.
 */
export const controlProspectsTable = pgTable(
  "control_prospects",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email").notNull(),
    phone: text("phone"),
    website: text("website"),
    region: text("region"),
    source: text("source").notNull().default("agent_research"),
    /** 0-100 fit score assigned by the prospecting agent with its rationale in qualification. */
    score: integer("score").notNull().default(0),
    qualification: text("qualification"),
    status: text("status").notNull().default("new"),
    campaignId: integer("campaign_id").references(() => controlCampaignsTable.id, {
      onDelete: "set null",
    }),
    campaignStep: integer("campaign_step").notNull().default(0),
    contactCount: integer("contact_count").notNull().default(0),
    lastContactedAt: timestamp("last_contacted_at"),
    statusChangedBy: text("status_changed_by"),
    createdByAgent: text("created_by_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("control_prospects_email_unique").on(table.email),
    statusIdx: index("control_prospects_status_idx").on(table.status, table.updatedAt),
    campaignIdx: index("control_prospects_campaign_idx").on(table.campaignId),
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
export type ControlCampaign = typeof controlCampaignsTable.$inferSelect;
export type ControlProspect = typeof controlProspectsTable.$inferSelect;

/* ————— Outreach email studio ————— */

/** Lifecycle of a studio email. Approval itself lives on the governed action. */
export const OUTREACH_EMAIL_STATUSES = [
  "draft",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "rejected",
] as const;
export type OutreachEmailStatus = (typeof OUTREACH_EMAIL_STATUSES)[number];

export const PROSPECT_ASSET_KINDS = ["venue_image", "sample_preview"] as const;
export type ProspectAssetKind = (typeof PROSPECT_ASSET_KINDS)[number];

export const PROSPECT_RESEARCH_STATUSES = ["ok", "no_images", "fetch_failed"] as const;
export type ProspectResearchStatus = (typeof PROSPECT_RESEARCH_STATUSES)[number];

export const EMAIL_SUPPRESSION_REASONS = [
  "unsubscribe_link",
  "one_click",
  "operator",
  "bounce",
  "complaint",
] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

/**
 * What the studio learned about a prospect's venue from its own public site:
 * grounded facts (name, location, spaces, style, capacity) with the URL each
 * fact came from, plus the outcome of the image hunt. One row per prospect,
 * replaced on every re-run.
 */
export const controlProspectResearchTable = pgTable(
  "control_prospect_research",
  {
    id: serial("id").primaryKey(),
    prospectId: integer("prospect_id")
      .notNull()
      .references(() => controlProspectsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ok"),
    /** Pages fetched during research, in order. */
    sourceUrls: jsonb("source_urls").$type<string[]>().notNull(),
    /** { name, location, spaces: string[], style, capacity, summary } — only facts seen on the site. */
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull(),
    /** Operator-facing flags, e.g. "No usable venue photos found on the site". */
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    prospectUnique: uniqueIndex("control_prospect_research_prospect_unique").on(table.prospectId),
  }),
);

/**
 * Images attached to a prospect: copies of the venue's own public photos
 * (stored in our public bucket with the exact source URL recorded) and, when
 * an operator asks for one, a labeled Dreemer sample preview.
 */
export const controlProspectAssetsTable = pgTable(
  "control_prospect_assets",
  {
    id: serial("id").primaryKey(),
    prospectId: integer("prospect_id")
      .notNull()
      .references(() => controlProspectsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("venue_image"),
    /** Public object path, e.g. /public-objects/outreach/12/abc.jpg. */
    objectKey: text("object_key").notNull(),
    /** Where the original image came from. */
    sourceUrl: text("source_url"),
    /** The page the image was discovered on. */
    pageUrl: text("page_url"),
    contentType: text("content_type").notNull().default("image/jpeg"),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    altText: text("alt_text").notNull(),
    /** Research score; higher ranks first. */
    score: integer("score").notNull().default(0),
    /** Research pick (top 1-3) — operators can still swap any candidate in. */
    selected: boolean("selected").notNull().default(false),
    createdBy: text("created_by").notNull().default("research"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    prospectIdx: index("control_prospect_assets_prospect_idx").on(table.prospectId, table.score),
  }),
);

/**
 * A studio email: Grok's personal draft, the operator's edits, the chosen
 * images, and the delivery record. Sending is only possible through the
 * governed send_outreach_email action referenced by actionId; the row keeps
 * an exact snapshot of what went out.
 */
export const controlOutreachEmailsTable = pgTable(
  "control_outreach_emails",
  {
    id: serial("id").primaryKey(),
    prospectId: integer("prospect_id")
      .notNull()
      .references(() => controlProspectsTable.id, { onDelete: "cascade" }),
    actionId: integer("action_id").references(() => agentActionsTable.id, { onDelete: "set null" }),
    campaignId: integer("campaign_id").references(() => controlCampaignsTable.id, {
      onDelete: "set null",
    }),
    step: integer("step"),
    status: text("status").notNull().default("draft"),
    /** Two subject options Grok offered; `subject` is the one that sends. */
    subjectOptions: jsonb("subject_options").$type<string[]>().notNull(),
    subject: text("subject").notNull(),
    /** Plain-text body paragraphs separated by blank lines (no greeting/sign-off). */
    body: text("body").notNull(),
    greeting: text("greeting").notNull(),
    signOff: text("sign_off").notNull(),
    ctaLabel: text("cta_label").notNull(),
    ctaUrl: text("cta_url").notNull(),
    /** Ordered control_prospect_assets ids rendered in the email (0-3). */
    imageAssetIds: jsonb("image_asset_ids").$type<number[]>().notNull(),
    /** Copy-quality notes from the drafting pass (word count, fallbacks used). */
    draftNotes: jsonb("draft_notes").$type<Record<string, unknown> | null>(),
    /** Random token in the unsubscribe URL; unique per email. */
    unsubscribeToken: text("unsubscribe_token").notNull(),
    htmlSnapshot: text("html_snapshot"),
    textSnapshot: text("text_snapshot"),
    providerMessageId: text("provider_message_id"),
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    bouncedAt: timestamp("bounced_at"),
    bounceReason: text("bounce_reason"),
    lastError: text("last_error"),
    createdByAgent: text("created_by_agent"),
    editedBy: text("edited_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    prospectIdx: index("control_outreach_emails_prospect_idx").on(table.prospectId, table.createdAt),
    statusIdx: index("control_outreach_emails_status_idx").on(table.status, table.updatedAt),
    tokenUnique: uniqueIndex("control_outreach_emails_token_unique").on(table.unsubscribeToken),
    providerIdx: index("control_outreach_emails_provider_idx").on(table.providerMessageId),
  }),
);

/**
 * Addresses the control plane must never email again. Written by the
 * unsubscribe endpoints (link + RFC 8058 one-click), bounce/complaint
 * webhooks, and operators; checked by every outreach send.
 */
export const controlEmailSuppressionsTable = pgTable(
  "control_email_suppressions",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    reason: text("reason").notNull(),
    detail: text("detail"),
    prospectId: integer("prospect_id").references(() => controlProspectsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("control_email_suppressions_email_unique").on(table.email),
  }),
);

/** Provider delivery events (sent, delivered, bounced, complained) per studio email. */
export const controlEmailEventsTable = pgTable(
  "control_email_events",
  {
    id: serial("id").primaryKey(),
    emailId: integer("email_id").references(() => controlOutreachEmailsTable.id, {
      onDelete: "cascade",
    }),
    providerEventId: text("provider_event_id"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index("control_email_events_email_idx").on(table.emailId, table.createdAt),
    providerEventUnique: uniqueIndex("control_email_events_provider_event_unique").on(
      table.providerEventId,
    ),
  }),
);

export type ControlProspectResearch = typeof controlProspectResearchTable.$inferSelect;
export type ControlProspectAsset = typeof controlProspectAssetsTable.$inferSelect;
export type ControlOutreachEmail = typeof controlOutreachEmailsTable.$inferSelect;
export type ControlEmailSuppression = typeof controlEmailSuppressionsTable.$inferSelect;
export type ControlEmailEvent = typeof controlEmailEventsTable.$inferSelect;
