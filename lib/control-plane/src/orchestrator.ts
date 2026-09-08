import type {
  AgentContext,
  AgentDefinition,
  AgentOutput,
  BusinessSnapshot,
  FleetAgentSnapshot,
  Observation,
  Severity,
} from "./types.js";
import { AGENT_REGISTRY, getAgent } from "./agents/index.js";
import { formatPercent, round, severityRank } from "./util.js";

/**
 * The chief of staff. It does not reason about the business itself — the
 * domain agents do that. It decides who runs this tick, in what order, and
 * turns the fleet's separate outputs into one readable state of the business.
 */

export interface ScheduledAgent {
  agentKey: string;
  definition: AgentDefinition;
  /** Higher runs first when a tick can only afford part of the fleet. */
  priority: number;
  reason: string;
}

export interface TickPlan {
  due: ScheduledAgent[];
  skipped: { agentKey: string; reason: string }[];
}

/**
 * Priority ordering when several agents come due at once. Repair before
 * revenue: a broken pipeline invalidates every other agent's reading of the
 * business, and governance runs last so it sees this tick's results.
 */
const DOMAIN_PRIORITY: Record<string, number> = {
  product: 100,
  support: 90,
  finance: 70,
  activation: 60,
  growth: 50,
  sales: 40,
  experiments: 30,
  governance: 10,
};

export interface FleetRow {
  agentKey: string;
  enabled: boolean;
  nextRunAt: Date | null;
  status: string;
}

export function planTick(
  fleet: FleetRow[],
  now: Date,
  options: { maxAgents?: number; forceAgentKey?: string } = {},
): TickPlan {
  const due: ScheduledAgent[] = [];
  const skipped: { agentKey: string; reason: string }[] = [];

  for (const row of fleet) {
    const definition = getAgent(row.agentKey);
    if (!definition) {
      skipped.push({ agentKey: row.agentKey, reason: "No such agent is registered in this build" });
      continue;
    }
    if (options.forceAgentKey && row.agentKey !== options.forceAgentKey) {
      continue;
    }
    if (!options.forceAgentKey) {
      if (!row.enabled) {
        skipped.push({ agentKey: row.agentKey, reason: "Agent is disabled" });
        continue;
      }
      if (row.status === "running") {
        skipped.push({ agentKey: row.agentKey, reason: "Previous run is still in flight" });
        continue;
      }
      if (row.nextRunAt && row.nextRunAt.getTime() > now.getTime()) {
        continue;
      }
    }
    due.push({
      agentKey: row.agentKey,
      definition,
      priority: DOMAIN_PRIORITY[definition.domain] ?? 50,
      reason: options.forceAgentKey ? "Manual run" : "Scheduled",
    });
  }

  due.sort((a, b) => b.priority - a.priority || a.agentKey.localeCompare(b.agentKey));
  const limit = options.maxAgents ?? due.length;
  for (const extra of due.slice(limit)) {
    skipped.push({ agentKey: extra.agentKey, reason: "Deferred to the next tick — per-tick agent limit" });
  }
  return { due: due.slice(0, limit), skipped };
}

/** Run one agent, converting any throw into a recorded failure. */
export function runAgent(
  definition: AgentDefinition,
  ctx: AgentContext,
): { output: AgentOutput | null; error: string | null } {
  try {
    return { output: definition.run(ctx), error: null };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

export interface StateOfBusiness {
  headline: string;
  severity: Severity;
  highlights: Observation[];
  concerns: Observation[];
  narrative: string;
}

/**
 * One paragraph an operator can read in ten seconds: what is wrong, what is
 * working, and what the fleet is waiting on them for.
 */
export function stateOfBusiness(
  snapshot: BusinessSnapshot,
  observations: Observation[],
): StateOfBusiness {
  const concerns = observations
    .filter((observation) => severityRank(observation.severity ?? "info") > 0)
    .sort((a, b) => severityRank(b.severity ?? "info") - severityRank(a.severity ?? "info"))
    .slice(0, 6);

  const highlights = observations
    .filter((observation) => (observation.severity ?? "info") === "info" && observation.value !== null)
    .slice(0, 6);

  const severity: Severity = concerns.some((concern) => concern.severity === "critical")
    ? "critical"
    : concerns.length > 0
      ? "warning"
      : "info";

  const { funnel, finance, ledger, venues } = snapshot;
  const deliveryRate =
    funnel.last7d.started > 0 ? funnel.last7d.ready / funnel.last7d.started : null;

  const headline =
    severity === "critical"
      ? concerns[0]?.label
        ? `${concerns[0].label}: ${concerns[0].value}`
        : "Critical condition in the fleet"
      : severity === "warning"
        ? `${concerns.length} condition${concerns.length === 1 ? "" : "s"} need attention`
        : "Business is operating within every guardrail";

  const narrative =
    `${venues.length} venue${venues.length === 1 ? "" : "s"} produced ${funnel.last7d.started} gallery ` +
    `start${funnel.last7d.started === 1 ? "" : "s"} in the last seven days, ${funnel.last7d.ready} delivered` +
    (deliveryRate === null ? "" : ` (${formatPercent(deliveryRate)})`) +
    `. Credit balance is ${finance.creditsBalance}` +
    (finance.runwayDays === null ? "" : `, about ${round(finance.runwayDays, 1)} days at the current burn`) +
    `. The fleet has ${ledger.openCount} decision${ledger.openCount === 1 ? "" : "s"} waiting on a human and ` +
    `executed ${ledger.executed24h} in the last day.` +
    (concerns.length
      ? ` Open concerns: ${concerns.map((concern) => concern.label.toLowerCase()).join(", ")}.`
      : " Nothing is currently flagged.");

  return { headline, severity, highlights, concerns, narrative };
}

/** Snapshot of the fleet's own health, used by governance and the console. */
export function fleetHealth(fleet: FleetAgentSnapshot[]): number {
  if (!fleet.length) return 0;
  const total = fleet.reduce((sum, agent) => {
    const penalty =
      (agent.enabled ? 0 : 0.25) +
      Math.min(0.5, agent.failedRuns24h * 0.15) +
      (agent.lastError ? 0.1 : 0);
    return sum + Math.max(0, 1 - penalty);
  }, 0);
  return round(total / fleet.length, 3);
}

export const REGISTERED_AGENT_COUNT = AGENT_REGISTRY.length;
