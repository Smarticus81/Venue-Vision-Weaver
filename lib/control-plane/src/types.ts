/**
 * The contract between the business and the agent fleet.
 *
 * Agents are pure functions over a snapshot: they never touch the database,
 * the network, or the clock directly. Everything they need arrives in an
 * AgentContext, and everything they want to change leaves as a
 * DecisionProposal carrying a declarative effect. The api-server assembles
 * the snapshot and executes approved effects — which is what makes the fleet
 * testable, replayable, and safe to run unattended.
 */

export type AgentDomain =
  | "growth"
  | "support"
  | "product"
  | "finance"
  | "experiments"
  | "sales"
  | "activation"
  | "governance";

export type AutonomyLevel = "observe" | "recommend" | "supervised" | "autonomous";
export type RiskLevel = "low" | "medium" | "high";
export type Severity = "info" | "warning" | "critical";

/* ————————————————————————— Snapshot ————————————————————————— */

export interface OrganizationSnapshot {
  id: number;
  name: string;
  plan: string;
  creditsBalance: number;
  hasSubscription: boolean;
  billingPeriodEnd: string | null;
  createdAt: string;
  ageDays: number;
}

export interface VenueSnapshot {
  id: number;
  name: string;
  slug: string;
  ownerEmail: string;
  contactEmail: string | null;
  createdAt: string;
  ageDays: number;
  mediaCount: number;
  coverageGaps: string[];
  /** True once the venue has enough imagery for the couple flow to run. */
  ready: boolean;
  sessionsTotal: number;
  sessionsLast7d: number;
  sessionsPrev7d: number;
  sessionsLast30d: number;
  readyCount: number;
  failedCount: number;
  lastSessionAt: string | null;
  daysSinceLastSession: number | null;
}

export interface SessionFailureSnapshot {
  id: number;
  venueId: number;
  venueSlug: string;
  errorMessage: string | null;
  createdAt: string;
  ageHours: number;
  creditsCharged: number;
}

export interface FunnelWindowSnapshot {
  started: number;
  ready: number;
  failed: number;
  processing: number;
  /** Median wall-clock minutes from start to ready over the window. */
  medianMinutesToReady: number | null;
}

export interface FunnelSnapshot {
  last7d: FunnelWindowSnapshot;
  prev7d: FunnelWindowSnapshot;
  last24h: FunnelWindowSnapshot;
}

export interface FinanceSnapshot {
  creditsBalance: number;
  creditsGranted30d: number;
  creditsBurned30d: number;
  creditsBurned7d: number;
  estimatedCogsUsd30d: number;
  estimatedRevenueUsd30d: number;
  /** Days of credit left at the current burn rate; null when burn is zero. */
  runwayDays: number | null;
  refunds30d: number;
  planPriceUsd: number;
}

export interface TicketSnapshot {
  id: number;
  subject: string;
  body: string;
  category: string;
  sentiment: string;
  priority: string;
  status: string;
  source: string;
  requesterEmail: string | null;
  venueId: number | null;
  sessionId: number | null;
  hasDraft: boolean;
  ageHours: number;
  hoursSinceFirstResponse: number | null;
}

export interface LeadSnapshot {
  id: number;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  source: string;
  stage: string;
  score: number;
  ageDays: number;
  daysSinceLastTouch: number | null;
  nextActionOverdueDays: number | null;
}

export interface ExperimentVariantResult {
  key: string;
  label: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
}

export interface ExperimentSnapshot {
  id: number;
  key: string;
  hypothesis: string;
  surface: string;
  primaryMetric: string;
  status: string;
  minimumSampleSize: number;
  ageDays: number | null;
  variants: ExperimentVariantResult[];
}

export interface WorkItemSnapshot {
  id: number;
  type: string;
  title: string;
  severity: string;
  status: string;
  surface: string;
  dedupeKey: string;
  ageDays: number;
}

export interface SignalSnapshot {
  id: number;
  kind: string;
  severity: Severity;
  source: string;
  title: string;
  venueId: number | null;
  subjectType: string | null;
  subjectId: string | null;
  payload: Record<string, unknown>;
  ageHours: number;
}

export interface FleetAgentSnapshot {
  agentKey: string;
  domain: AgentDomain;
  enabled: boolean;
  autonomy: AutonomyLevel;
  status: string;
  healthScore: number;
  actionsToday: number;
  dailyActionBudget: number;
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  lastError: string | null;
  failedRuns24h: number;
  succeededRuns24h: number;
}

export interface DecisionLedgerSnapshot {
  openCount: number;
  executed24h: number;
  rejected7d: number;
  approved7d: number;
  /** Open decisions older than the review SLA, oldest first. */
  stale: { id: number; agentKey: string; title: string; ageHours: number; riskLevel: RiskLevel }[];
  byAgent: { agentKey: string; open: number; executed7d: number; rejected7d: number }[];
}

export interface MetricPoint {
  date: string;
  value: number;
}

export interface BusinessSnapshot {
  now: string;
  organization: OrganizationSnapshot;
  venues: VenueSnapshot[];
  funnel: FunnelSnapshot;
  failures: SessionFailureSnapshot[];
  finance: FinanceSnapshot;
  tickets: TicketSnapshot[];
  leads: LeadSnapshot[];
  experiments: ExperimentSnapshot[];
  workItems: WorkItemSnapshot[];
  signals: SignalSnapshot[];
  fleet: FleetAgentSnapshot[];
  ledger: DecisionLedgerSnapshot;
  metrics: Record<string, MetricPoint[]>;
}

/* ————————————————————————— Effects ————————————————————————— */

export interface WorkItemDraft {
  type: "repair" | "upgrade" | "chore";
  title: string;
  detail: string;
  severity: "low" | "medium" | "high" | "critical";
  surface: string;
  dedupeKey: string;
  evidence?: Record<string, unknown>;
}

export interface ExperimentVariantDraft {
  key: string;
  label: string;
  weight: number;
}

export type DecisionEffect =
  | { type: "report.digest"; title: string; body: string; audience: "operator" | "owner" }
  | { type: "notify.operator"; subject: string; body: string; severity: Severity }
  | { type: "venue.nudge"; venueId: number; subject: string; body: string; reason: string }
  | { type: "credits.grant"; amount: number; reason: string; note: string }
  | { type: "workItem.upsert"; workItem: WorkItemDraft }
  | { type: "workItem.close"; dedupeKey: string; note: string }
  | { type: "session.retry"; sessionId: number; note: string }
  | { type: "ticket.triage"; ticketId: number; category: string; sentiment: string; priority: string }
  | { type: "ticket.draftReply"; ticketId: number; message: string }
  | { type: "ticket.resolve"; ticketId: number; note: string }
  | { type: "ticket.escalate"; ticketId: number; priority: string; note: string }
  | {
      type: "experiment.launch";
      key: string;
      hypothesis: string;
      surface: string;
      primaryMetric: string;
      variants: ExperimentVariantDraft[];
      minimumSampleSize: number;
    }
  | { type: "experiment.conclude"; key: string; winner: string | null; note: string }
  | { type: "experiment.abort"; key: string; note: string }
  | { type: "lead.advance"; leadId: number; stage: string; note: string }
  | { type: "lead.score"; leadId: number; score: number; note: string }
  | { type: "lead.outreach"; leadId: number; subject: string; body: string }
  | { type: "agent.setAutonomy"; targetAgentKey: string; autonomy: AutonomyLevel; note: string }
  | { type: "agent.pause"; targetAgentKey: string; note: string }
  | { type: "agent.resume"; targetAgentKey: string; note: string }
  | { type: "policy.set"; key: string; value: unknown; note: string }
  | { type: "memory.write"; content: string; importance: number; tags: string[] }
  | { type: "metric.record"; metricKey: string; value: number; dimensions?: Record<string, unknown> };

export type DecisionEffectType = DecisionEffect["type"];

/* ————————————————————————— Agent I/O ————————————————————————— */

export interface Observation {
  key: string;
  label: string;
  value: number | string | null;
  /** Direction that counts as good, used by the console to colour deltas. */
  goodDirection?: "up" | "down" | "neutral";
  delta?: number | null;
  severity?: Severity;
  detail?: string;
}

export interface DecisionProposal {
  kind: string;
  title: string;
  rationale: string;
  effect: DecisionEffect;
  evidence?: Record<string, unknown>;
  /** 0–1. Below the policy floor the proposal is held for a human. */
  confidence: number;
  /** 0–100, used to rank the operator's queue. */
  impactScore: number;
  /** Stable across ticks so a standing condition yields one open decision. */
  dedupeKey: string;
  /** Optional agent-declared risk; policy may raise it, never lower it. */
  riskLevel?: RiskLevel;
  expiresInHours?: number;
}

export interface MemoryNoteDraft {
  kind: "insight" | "lesson" | "fact";
  content: string;
  importance: number;
  tags: string[];
}

export interface MetricSample {
  metricKey: string;
  value: number;
  dimensions?: Record<string, unknown>;
}

export interface AgentOutput {
  summary: string;
  observations: Observation[];
  proposals: DecisionProposal[];
  memory: MemoryNoteDraft[];
  metrics: MetricSample[];
}

export interface AgentRuntimeState {
  agentKey: string;
  autonomy: AutonomyLevel;
  enabled: boolean;
  actionsRemainingToday: number;
  config: Record<string, unknown>;
}

export interface MemoryNote {
  agentKey: string;
  kind: string;
  content: string;
  importance: number;
  tags: string[];
  ageDays: number;
}

export interface OpenDecisionRef {
  id: number;
  agentKey: string;
  dedupeKey: string;
  kind: string;
  status: string;
  ageHours: number;
}

export interface AgentContext {
  now: Date;
  snapshot: BusinessSnapshot;
  agent: AgentRuntimeState;
  memory: MemoryNote[];
  openDecisions: OpenDecisionRef[];
}

export interface AgentDefinition {
  key: string;
  domain: AgentDomain;
  displayName: string;
  /** One sentence the console shows: what this agent is accountable for. */
  charter: string;
  defaultIntervalMinutes: number;
  defaultAutonomy: AutonomyLevel;
  run(ctx: AgentContext): AgentOutput;
}
