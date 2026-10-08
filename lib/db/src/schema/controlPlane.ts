import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  "support",
  "product",
  "finance",
  "experiments",
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

/** "executing" is the atomic claim an executor takes on an approved row so no action ever runs twice. */
export const AGENT_ACTION_STATUSES = [
  "pending",
  "approved",
  "executing",
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

/**
 * Allowed prospect status moves. Agents may only request new/qualified/
 * disqualified transitions; the send path sets "contacted"; operators record
 * replied/converted/unsubscribed. Terminal: converted, unsubscribed.
 */
export const PROSPECT_TRANSITIONS: Record<ProspectStatus, ProspectStatus[]> = {
  new: ["qualified", "disqualified", "unsubscribed", "converted"],
  qualified: ["contacted", "disqualified", "unsubscribed", "converted", "replied"],
  contacted: ["replied", "converted", "unsubscribed", "disqualified"],
  replied: ["converted", "unsubscribed", "disqualified"],
  disqualified: ["qualified"],
  converted: [],
  unsubscribed: [],
};

export const PROSPECT_SOURCES = ["agent_research", "operator_import", "inbound"] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "completed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const REPLY_SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type ReplySentiment = (typeof REPLY_SENTIMENTS)[number];
export const ATTRIBUTION_METHODS = ["email", "website_domain", "email_domain", "manual"] as const;
export type AttributionMethod = (typeof ATTRIBUTION_METHODS)[number];
export const VENUE_TYPES = [
  "barn_farm",
  "estate",
  "hotel_resort",
  "winery",
  "garden",
  "historic",
  "urban_loft",
  "restaurant_club",
  "waterfront",
  "other",
] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

/** Funnel events posted by the SPA (POST /api/events) and emitted by the server on lifecycle milestones. */
export const FUNNEL_EVENTS = [
  "landing_view",
  "cta_click",
  "signup_started",
  "signup_completed",
  "org_created",
  "venue_created",
  "first_photo",
  "venue_ready",
  "first_gallery",
  "checkout_started",
  "checkout_completed",
  "credits_exhausted",
  "tour_card_downloaded",
  "session_ready",
  "session_failed",
  "subscription_started",
  "pack_purchased",
  "subscription_canceled",
  "payment_failed",
  "trial_started",
] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

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
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

export const EXPERIMENT_DECISIONS = ["win", "kill", "inconclusive", "extended"] as const;
export type ExperimentDecision = (typeof EXPERIMENT_DECISIONS)[number];

/** Growth/product experiments proposed and tracked by the experiments agent. */
export const controlExperimentsTable = pgTable("control_experiments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  hypothesis: text("hypothesis").notNull(),
  /** Free-text metric description (legacy); primaryMetricKey is what the evaluator reads. */
  metric: text("metric").notNull(),
  variants: jsonb("variants").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("proposed"),
  result: text("result"),
  createdByAgent: text("created_by_agent"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  // --- experiment card (growth loop) ---
  /** Key from growth/metricKeys.ts, e.g. "outbound.positive_reply_rate". */
  primaryMetricKey: text("primary_metric_key"),
  /** Metric value when the experiment started (same unit as the metric). */
  baseline: doublePrecision("baseline"),
  /** Relative lift worth acting on, e.g. 0.25 = +25%. */
  minDetectableLift: doublePrecision("min_detectable_lift"),
  /** Absolute metric value at/below which (or above, for lower-is-better) the experiment is killed early. */
  killThreshold: doublePrecision("kill_threshold"),
  decisionDate: timestamp("decision_date"),
  /** Segment filter "region:Hill Country" | "venue_type:barn_farm" | null (whole business). */
  segment: text("segment"),
  /** control_copy_variants.key under test, or null. */
  variantKey: text("variant_key"),
  /** { control: {...}, treatment: {...} } free-form assignment description. */
  assignments: jsonb("assignments").$type<Record<string, unknown> | null>(),
  decision: text("decision"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at"),
  observedValue: doublePrecision("observed_value"),
  observedN: integer("observed_n"),
  /** Last evaluator output (growth/experiments.ts Evaluation). */
  evaluation: jsonb("evaluation").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}).enableRLS();

/** Periodic KPI snapshots so agents and operators can see trends. */
export const controlMetricsSnapshotsTable = pgTable("control_metrics_snapshots", {
  id: serial("id").primaryKey(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

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
).enableRLS();

/**
 * Multi-step outreach campaigns designed by the campaigns agent. A campaign
 * is a named sequence of outreach steps; it only becomes able to generate
 * sends after an operator approves the launch_campaign action, and every
 * individual email still goes through the send_outreach_email approval.
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
}).enableRLS();

/**
 * Prospective venue customers discovered by the prospecting agent or imported
 * by operators. Email is the dedupe key (stored lowercased, unique). Contact
 * bookkeeping (contactCount, lastContactedAt, campaignStep) is written only
 * by the governed send_outreach_email action, never directly by agents.
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
    // --- vetting (vetting.md 2.1) ---
    /** Denormalized from control_prospect_vetting; "unvetted" until the vetting module writes a verdict. Agents cannot set this. */
    vettingStatus: text("vetting_status").notNull().default("unvetted"),
    legitimacyScore: integer("legitimacy_score"),
    vettedAt: timestamp("vetted_at"),
    // --- growth loop (growth-loop.md 4.3) ---
    /** Deterministic venue-type segment from growth/segments.ts; null until classified. */
    venueType: text("venue_type"),
    repliedAt: timestamp("replied_at"),
    /** Operator-recorded tone of the reply: positive | neutral | negative. */
    replySentiment: text("reply_sentiment"),
    convertedAt: timestamp("converted_at"),
    convertedOrganizationId: integer("converted_organization_id"),
    /** campaignId at the moment of conversion (attribution snapshot). */
    convertedCampaignId: integer("converted_campaign_id"),
    /** email | website_domain | email_domain | manual */
    attributionMethod: text("attribution_method"),
    createdByAgent: text("created_by_agent"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    emailUnique: uniqueIndex("control_prospects_email_unique").on(table.email),
    statusIdx: index("control_prospects_status_idx").on(table.status, table.updatedAt),
    campaignIdx: index("control_prospects_campaign_idx").on(table.campaignId),
    vettingIdx: index("control_prospects_vetting_idx").on(table.vettingStatus, table.score),
    convertedOrgIdx: index("control_prospects_converted_org_idx").on(table.convertedOrganizationId),
  }),
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
    /** control_copy_variants.key used for this draft; null for legacy/operator drafts. */
    variantKey: text("variant_key"),
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
    /** Verified facts the copy cites, snapshotted at draft/edit time: [{ kind, value, sourceUrl }]. */
    citedFacts: jsonb("cited_facts").$type<Array<{ kind: string; value: string; sourceUrl: string }> | null>(),
    /** Vetting verdict at draft time: { status, score, vettedAt }. */
    vettingSnapshot: jsonb("vetting_snapshot").$type<{ status: string; score: number; vettedAt: string } | null>(),
    /** Random token in the unsubscribe URL; unique per email. */
    unsubscribeToken: text("unsubscribe_token").notNull(),
    /** Random token in the email's claim link (/claim/:token prefills signup); unique per email. */
    claimToken: text("claim_token"),
    htmlSnapshot: text("html_snapshot"),
    textSnapshot: text("text_snapshot"),
    providerMessageId: text("provider_message_id"),
    sentTo: text("sent_to"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    bouncedAt: timestamp("bounced_at"),
    bounceReason: text("bounce_reason"),
    /** Engagement from provider webhooks (first open / first click). */
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
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
    claimTokenUnique: uniqueIndex("control_outreach_emails_claim_token_unique")
      .on(table.claimToken)
      .where(sql`${table.claimToken} IS NOT NULL`),
    providerIdx: index("control_outreach_emails_provider_idx").on(table.providerMessageId),
  }),
).enableRLS();

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
).enableRLS();

/** Provider delivery and engagement events recorded in control_email_events.event_type. */
export const EMAIL_EVENT_TYPES = [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

/** Provider delivery events (sent, delivered, bounced, complained, opened, clicked) per studio email. */
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
).enableRLS();

export type ControlProspectResearch = typeof controlProspectResearchTable.$inferSelect;
export type ControlProspectAsset = typeof controlProspectAssetsTable.$inferSelect;
export type ControlOutreachEmail = typeof controlOutreachEmailsTable.$inferSelect;
export type ControlEmailSuppression = typeof controlEmailSuppressionsTable.$inferSelect;
export type ControlEmailEvent = typeof controlEmailEventsTable.$inferSelect;

/* ————— Funnel events ————— */

/** Product funnel log (landing -> signup -> venue ready -> first gallery -> paid); written by POST /api/events and server milestones. */
export const funnelEventsTable = pgTable(
  "funnel_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    venueId: integer("venue_id"),
    event: text("event").notNull(),
    properties: jsonb("properties").$type<Record<string, unknown> | null>(),
    /** web | server | stripe | control_plane ... */
    source: text("source"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    eventIdx: index("funnel_events_event_idx").on(table.event, table.createdAt),
    orgIdx: index("funnel_events_org_idx").on(table.organizationId, table.createdAt),
  }),
).enableRLS();

export type FunnelEventRow = typeof funnelEventsTable.$inferSelect;
export type InsertFunnelEvent = typeof funnelEventsTable.$inferInsert;

/* ————— Prospect vetting ————— */

export const VETTING_STATUSES = ["unvetted", "passed", "review", "failed", "error"] as const;
export type VettingStatus = (typeof VETTING_STATUSES)[number];

export const VETTING_CHECK_KEYS = [
  "site_reachable",
  "site_not_parked",
  "tls_valid",
  "domain_age",
  "site_history",
  "mx_present",
  "spf_dmarc",
  "mailbox_class",
  "mailbox_role",
  "email_published",
  "nap",
  "marketplace_presence",
  "social_handles",
  "wedding_signal",
  "contact_name_published",
  "blocked_region",
  "places",
] as const;
export type VettingCheckKey = (typeof VETTING_CHECK_KEYS)[number];

export const FACT_KINDS = [
  "venue_name",
  "space",
  "location",
  "capacity",
  "style",
  "owner_name",
  "email",
  "phone",
  "address",
  "marketplace",
  "social",
  "google_rating",
  "wedding_signal",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FACT_SOURCE_KINDS = [
  "website",
  "json_ld",
  "rdap",
  "wayback",
  "dns",
  "places",
  "agent_research",
  "operator",
] as const;
export type FactSourceKind = (typeof FACT_SOURCE_KINDS)[number];

export const FACT_STATUSES = ["verified", "unverified", "stale"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

/**
 * Legitimacy verdict for a prospect: Tier A free checks (site, TLS, RDAP age,
 * Wayback history, MX/SPF/DMARC, mailbox class, NAP, marketplace/social
 * presence) plus optional Tier B (Google Places). One row per prospect,
 * replaced on every run; every check keeps the URL and timestamp it was
 * observed at so operators and the governance agent can see the evidence.
 * vettedBy is "system:vetting" for automatic runs and "override:<email>" for
 * operator decisions.
 */
export const controlProspectVettingTable = pgTable(
  "control_prospect_vetting",
  {
    id: serial("id").primaryKey(),
    prospectId: integer("prospect_id")
      .notNull()
      .references(() => controlProspectsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    score: integer("score").notNull().default(0),
    tier: text("tier").notNull().default("A"),
    hardFails: jsonb("hard_fails").$type<string[]>().notNull(),
    /** VettingCheck[] from control-plane/vetting/types.ts. */
    checks: jsonb("checks").$type<Array<Record<string, unknown>>>().notNull(),
    summary: text("summary").notNull(),
    contactDomain: text("contact_domain").notNull(),
    mxProvider: text("mx_provider"),
    domainRegisteredAt: timestamp("domain_registered_at"),
    firstCaptureAt: timestamp("first_capture_at"),
    placesPlaceId: text("places_place_id"),
    vettedAt: timestamp("vetted_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    vettedBy: text("vetted_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    prospectUnique: uniqueIndex("control_prospect_vetting_prospect_unique").on(table.prospectId),
    statusIdx: index("control_prospect_vetting_status_idx").on(table.status, table.expiresAt),
  }),
).enableRLS();

/**
 * Facts about a prospect's venue, each with the exact URL it was seen at.
 * Written by website research, vetting, the prospecting agent (always
 * "unverified" until a direct observation confirms it), and operators.
 * The copywriter may only cite "verified" rows.
 */
export const controlProspectFactsTable = pgTable(
  "control_prospect_facts",
  {
    id: serial("id").primaryKey(),
    prospectId: integer("prospect_id")
      .notNull()
      .references(() => controlProspectsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceKind: text("source_kind").notNull(),
    excerpt: text("excerpt"),
    status: text("status").notNull().default("verified"),
    verifiedAt: timestamp("verified_at"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    factUnique: uniqueIndex("control_prospect_facts_unique").on(table.prospectId, table.kind, table.value),
    prospectIdx: index("control_prospect_facts_prospect_idx").on(table.prospectId, table.status),
  }),
).enableRLS();

export type ControlProspectVetting = typeof controlProspectVettingTable.$inferSelect;
export type ControlProspectFact = typeof controlProspectFactsTable.$inferSelect;

/* ————— Growth loop ————— */

/** Copy angles the outreach studio rotates between; stats come from control_outreach_emails.variant_key. */
export const controlCopyVariantsTable = pgTable(
  "control_copy_variants",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** Guidance appended to the copywriter prompt (plain words, one angle). */
    angle: text("angle").notNull(),
    /** Default ask for first touches using this angle: preview | call. */
    defaultAsk: text("default_ask").notNull().default("preview"),
    isControl: boolean("is_control").notNull().default(false),
    active: boolean("active").notNull().default(true),
    /** Selection weight 0..1 maintained by adaptation rules; control never drops below 0.2. */
    weight: doublePrecision("weight").notNull().default(0.25),
    pausedReason: text("paused_reason"),
    createdBy: text("created_by").notNull().default("seed"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({ keyUnique: uniqueIndex("control_copy_variants_key_unique").on(table.key) }),
).enableRLS();

/** Append-only log of deterministic adaptation rule firings (what changed, from what, why). */
export const controlAdaptationsTable = pgTable(
  "control_adaptations",
  {
    id: serial("id").primaryKey(),
    ruleKey: text("rule_key").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    reason: text("reason").notNull(),
    snapshotId: integer("snapshot_id").references(() => controlMetricsSnapshotsTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({ createdIdx: index("control_adaptations_created_idx").on(table.createdAt) }),
).enableRLS();

/** Weekly operator digests (document + rendered email + delivery record). */
export const controlDigestsTable = pgTable(
  "control_digests",
  {
    id: serial("id").primaryKey(),
    /** Monday 00:00 UTC of the ISO week the digest covers. */
    weekStart: timestamp("week_start").notNull(),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    /** Reserved for the Later Grok polish step; always null in this window. */
    polishedBy: text("polished_by"),
    actionId: integer("action_id").references(() => agentActionsTable.id, { onDelete: "set null" }),
    sentTo: jsonb("sent_to").$type<string[] | null>(),
    sentAt: timestamp("sent_at"),
    createdBy: text("created_by").notNull().default("system:scheduler"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({ weekUnique: uniqueIndex("control_digests_week_unique").on(table.weekStart) }),
).enableRLS();

export type ControlCopyVariant = typeof controlCopyVariantsTable.$inferSelect;
export type ControlAdaptation = typeof controlAdaptationsTable.$inferSelect;
export type ControlDigest = typeof controlDigestsTable.$inferSelect;
