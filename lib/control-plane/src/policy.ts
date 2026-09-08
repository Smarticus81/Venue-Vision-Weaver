import type {
  AutonomyLevel,
  DecisionEffect,
  DecisionEffectType,
  DecisionProposal,
  RiskLevel,
} from "./types.js";

/**
 * Guardrails. Every proposal passes through here before it can be stored as
 * auto-executable, and again before it actually runs. The rule the whole
 * system rests on: an agent can never widen its own authority — governance
 * proposals that change autonomy are themselves high risk, and high risk
 * always means a human.
 */

export interface ControlPlanePolicy {
  /** Master stop. When true nothing executes, including approved decisions. */
  killSwitch: boolean;
  /** When false the fleet still observes and proposes, but never self-executes. */
  autoExecuteEnabled: boolean;
  /** Org-wide ceiling on automatic executions per calendar day. */
  maxAutoExecutionsPerDay: number;
  /** Proposals below this confidence always wait for a human. */
  confidenceFloor: number;
  /** Effect types that always require approval regardless of autonomy. */
  alwaysApprove: DecisionEffectType[];
  /** Outbound email to venues, couples, and leads. Off by default. */
  outboundEmailEnabled: boolean;
  /** Largest credit grant an agent may propose at all. */
  maxCreditGrant: number;
  /** How long an open decision may sit before governance flags it. */
  reviewSlaHours: number;
  /** Decisions expire (and stop cluttering the queue) after this. */
  decisionTtlHours: number;
}

export const DEFAULT_POLICY: ControlPlanePolicy = {
  killSwitch: false,
  autoExecuteEnabled: true,
  maxAutoExecutionsPerDay: 40,
  confidenceFloor: 0.6,
  alwaysApprove: ["credits.grant", "policy.set", "agent.setAutonomy"],
  outboundEmailEnabled: false,
  maxCreditGrant: 25,
  reviewSlaHours: 48,
  decisionTtlHours: 168,
};

export const POLICY_KEYS = Object.keys(DEFAULT_POLICY) as (keyof ControlPlanePolicy)[];

/**
 * Base risk per effect type. Anything that reaches a human outside the
 * company, moves money, or changes the fleet's own authority starts at
 * medium or high — never low.
 */
const BASE_RISK: Record<DecisionEffectType, RiskLevel> = {
  "report.digest": "low",
  "notify.operator": "low",
  "memory.write": "low",
  "metric.record": "low",
  "workItem.upsert": "low",
  "workItem.close": "low",
  "ticket.triage": "low",
  "ticket.draftReply": "low",
  "lead.score": "low",
  "experiment.conclude": "medium",
  "experiment.abort": "medium",
  "experiment.launch": "medium",
  "session.retry": "medium",
  "ticket.resolve": "medium",
  "ticket.escalate": "medium",
  "lead.advance": "medium",
  "agent.pause": "medium",
  "agent.resume": "medium",
  "venue.nudge": "high",
  "lead.outreach": "high",
  "credits.grant": "high",
  "policy.set": "high",
  "agent.setAutonomy": "high",
};

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

/**
 * Risk for a concrete effect. Magnitude escalates: a 3-credit goodwill grant
 * and a 300-credit one are not the same decision.
 */
export function effectRisk(effect: DecisionEffect): RiskLevel {
  const base = BASE_RISK[effect.type] ?? "high";
  switch (effect.type) {
    case "credits.grant":
      return effect.amount > 10 ? "high" : base;
    case "experiment.launch":
      return effect.variants.length > 3 ? "high" : base;
    case "notify.operator":
      return effect.severity === "critical" ? "medium" : base;
    default:
      return base;
  }
}

const AUTONOMY_CEILING: Record<AutonomyLevel, RiskLevel | null> = {
  observe: null,
  recommend: null,
  supervised: "low",
  autonomous: "medium",
};

export interface PolicyInputs {
  policy: ControlPlanePolicy;
  autonomy: AutonomyLevel;
  agentEnabled: boolean;
  /** Remaining daily action budget for this agent. */
  agentBudgetRemaining: number;
  /** Remaining org-wide automatic executions for today. */
  orgAutoBudgetRemaining: number;
}

export interface PolicyVerdict {
  /** False means the proposal is dropped entirely, not queued. */
  admissible: boolean;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  /** Set when the proposal is queued for a human rather than auto-executed. */
  holdReason: string | null;
  /** Set when the proposal is refused outright. */
  rejectReason: string | null;
}

/**
 * Decide what happens to a proposal: dropped, queued for a human, or cleared
 * to execute on its own.
 */
export function evaluateProposal(
  proposal: DecisionProposal,
  inputs: PolicyInputs,
): PolicyVerdict {
  const { policy, autonomy } = inputs;
  const risk = maxRisk(effectRisk(proposal.effect), proposal.riskLevel ?? "low");

  const reject = (rejectReason: string): PolicyVerdict => ({
    admissible: false,
    riskLevel: risk,
    requiresApproval: true,
    holdReason: null,
    rejectReason,
  });

  if (!inputs.agentEnabled) return reject("Agent is disabled");
  if (autonomy === "observe") return reject("Agent is in observe-only mode");

  // Hard caps that no autonomy level can buy past.
  if (proposal.effect.type === "credits.grant") {
    if (proposal.effect.amount <= 0) return reject("Credit grant must be positive");
    if (proposal.effect.amount > policy.maxCreditGrant) {
      return reject(
        `Credit grant of ${proposal.effect.amount} exceeds the policy ceiling of ${policy.maxCreditGrant}`,
      );
    }
  }
  if (isOutbound(proposal.effect) && !policy.outboundEmailEnabled) {
    // Still worth a human's attention — queued, not dropped.
    return {
      admissible: true,
      riskLevel: risk,
      requiresApproval: true,
      holdReason: "Outbound email is disabled by policy",
      rejectReason: null,
    };
  }

  const hold = (holdReason: string): PolicyVerdict => ({
    admissible: true,
    riskLevel: risk,
    requiresApproval: true,
    holdReason,
    rejectReason: null,
  });

  if (policy.killSwitch) return hold("Control plane kill switch is engaged");
  if (!policy.autoExecuteEnabled) return hold("Autonomous execution is disabled by policy");
  if (policy.alwaysApprove.includes(proposal.effect.type)) {
    return hold(`Effect ${proposal.effect.type} always requires approval`);
  }
  if (risk === "high") return hold("High-risk decisions always require a human");
  if (proposal.confidence < policy.confidenceFloor) {
    return hold(
      `Confidence ${proposal.confidence.toFixed(2)} is below the floor of ${policy.confidenceFloor}`,
    );
  }

  const ceiling = AUTONOMY_CEILING[autonomy];
  if (ceiling === null) return hold(`Autonomy level "${autonomy}" never self-executes`);
  if (RISK_ORDER.indexOf(risk) > RISK_ORDER.indexOf(ceiling)) {
    return hold(`Autonomy level "${autonomy}" cannot execute ${risk}-risk decisions`);
  }

  if (inputs.agentBudgetRemaining <= 0) return hold("Agent daily action budget is spent");
  if (inputs.orgAutoBudgetRemaining <= 0) {
    return hold("Organization daily automatic-execution budget is spent");
  }

  return {
    admissible: true,
    riskLevel: risk,
    requiresApproval: false,
    holdReason: null,
    rejectReason: null,
  };
}

/** Effects that put a message in front of someone outside the company. */
export function isOutbound(effect: DecisionEffect): boolean {
  return effect.type === "venue.nudge" || effect.type === "lead.outreach";
}

/**
 * Re-check at execution time. A decision approved yesterday must not run
 * through a kill switch that was engaged since.
 */
export function canExecuteNow(
  effect: DecisionEffect,
  policy: ControlPlanePolicy,
): { allowed: boolean; reason: string | null } {
  if (policy.killSwitch) {
    return { allowed: false, reason: "Control plane kill switch is engaged" };
  }
  if (isOutbound(effect) && !policy.outboundEmailEnabled) {
    return { allowed: false, reason: "Outbound email is disabled by policy" };
  }
  if (effect.type === "credits.grant" && effect.amount > policy.maxCreditGrant) {
    return { allowed: false, reason: "Credit grant exceeds the policy ceiling" };
  }
  return { allowed: true, reason: null };
}

export function mergePolicy(overrides: Partial<ControlPlanePolicy>): ControlPlanePolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

/** Narrow an unknown stored policy value onto the typed policy shape. */
export function coercePolicyValue<K extends keyof ControlPlanePolicy>(
  key: K,
  value: unknown,
): ControlPlanePolicy[K] | undefined {
  const fallback = DEFAULT_POLICY[key];
  if (typeof fallback === "boolean") {
    return (typeof value === "boolean" ? value : undefined) as ControlPlanePolicy[K] | undefined;
  }
  if (typeof fallback === "number") {
    return (typeof value === "number" && Number.isFinite(value) ? value : undefined) as
      | ControlPlanePolicy[K]
      | undefined;
  }
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value)) return undefined;
    const known = new Set(Object.keys(BASE_RISK));
    const filtered = value.filter(
      (entry): entry is DecisionEffectType => typeof entry === "string" && known.has(entry),
    );
    return filtered as ControlPlanePolicy[K];
  }
  return undefined;
}
