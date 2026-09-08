import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal } from "../types.js";
import { clamp, dayBucket, formatPercent, observation, pct, pluralize, round } from "../util.js";

const UNHEALTHY_FAILED_RUNS = 3;
const HIGH_REJECTION_RATE = 0.5;
const MIN_DECISIONS_FOR_REJECTION_JUDGEMENT = 6;
const SILENT_AGENT_MINUTES_MULTIPLIER = 4;

/**
 * Governance supervises the fleet rather than the business. It is the only
 * agent that acts on other agents, and it is deliberately unable to widen
 * anyone's authority without a human: every autonomy change it proposes is a
 * high-risk effect, which policy always routes to approval.
 */
export const governanceAgent: AgentDefinition = {
  key: "governance-agent",
  domain: "governance",
  displayName: "Governance",
  charter: "Hold the fleet to its guardrails and stop agents that misbehave.",
  defaultIntervalMinutes: 60,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const { fleet, ledger } = snapshot;
    const proposals: DecisionProposal[] = [];
    const today = dayBucket(now);

    const others = fleet.filter((agent) => agent.agentKey !== governanceAgent.key);
    const unhealthy = others.filter((agent) => agent.failedRuns24h >= UNHEALTHY_FAILED_RUNS);
    const silent = others.filter(
      (agent) =>
        agent.enabled &&
        agent.minutesSinceLastRun !== null &&
        agent.minutesSinceLastRun > expectedSilenceMinutes(agent.agentKey, ctx),
    );
    const disabled = others.filter((agent) => !agent.enabled);
    const autoExecuting = others.filter((agent) => agent.autonomy === "autonomous");
    const budgetExhausted = others.filter((agent) => agent.actionsToday >= agent.dailyActionBudget);

    const staleDecisions = ledger.stale;
    const decisionThroughput = ledger.approved7d + ledger.rejected7d;
    const rejectionRate = pct(ledger.rejected7d, Math.max(1, decisionThroughput));

    const observations = [
      observation("fleet_size", "Agents registered", fleet.length),
      observation("unhealthy_agents", "Agents failing repeatedly", unhealthy.length, {
        goodDirection: "down",
        severity: unhealthy.length > 0 ? "critical" : "info",
      }),
      observation("silent_agents", "Enabled agents overdue for a run", silent.length, {
        goodDirection: "down",
        severity: silent.length > 0 ? "warning" : "info",
      }),
      observation("open_decisions", "Decisions awaiting a human", ledger.openCount, {
        goodDirection: "down",
        severity: staleDecisions.length > 0 ? "warning" : "info",
      }),
      observation("stale_decisions", "Open past the review target", staleDecisions.length, {
        goodDirection: "down",
        severity: staleDecisions.length >= 5 ? "critical" : staleDecisions.length > 0 ? "warning" : "info",
      }),
      observation("rejection_rate_7d", "Share of reviewed decisions rejected", round(rejectionRate, 3), {
        goodDirection: "down",
        detail: `${ledger.rejected7d} rejected of ${decisionThroughput} reviewed`,
        severity: rejectionRate >= HIGH_REJECTION_RATE && decisionThroughput >= MIN_DECISIONS_FOR_REJECTION_JUDGEMENT ? "warning" : "info",
      }),
      observation("executed_24h", "Decisions executed in 24h", ledger.executed24h),
      observation("autonomous_agents", "Agents at autonomous level", autoExecuting.length),
    ];

    // An agent that keeps throwing is worse than an absent one: it burns
    // budget and fills the audit log with noise. Pause it and say so.
    for (const agent of unhealthy) {
      proposals.push({
        kind: "governance.pause_unhealthy_agent",
        title: `Pause ${agent.agentKey} — ${pluralize(agent.failedRuns24h, "failed run")} in 24h`,
        rationale:
          `${agent.agentKey} failed ${agent.failedRuns24h} of its last ${agent.failedRuns24h + agent.succeededRuns24h} ` +
          `runs in 24 hours${agent.lastError ? ` (last error: ${truncate(agent.lastError, 160)})` : ""}. ` +
          `Pausing stops it consuming budget and producing half-formed decisions until the fault is fixed.`,
        effect: {
          type: "agent.pause",
          targetAgentKey: agent.agentKey,
          note: `${agent.failedRuns24h} failed runs in 24h`,
        },
        evidence: {
          agentKey: agent.agentKey,
          failedRuns24h: agent.failedRuns24h,
          succeededRuns24h: agent.succeededRuns24h,
          lastError: agent.lastError,
        },
        confidence: 0.88,
        impactScore: 80,
        dedupeKey: `governance.pause.${agent.agentKey}.${today}`,
        expiresInHours: 48,
      });
    }

    // A high rejection rate means an agent's judgement does not match the
    // operator's. Narrowing its autonomy is a high-risk effect on purpose.
    for (const entry of ledger.byAgent) {
      const reviewed = entry.executed7d + entry.rejected7d;
      if (reviewed < MIN_DECISIONS_FOR_REJECTION_JUDGEMENT) continue;
      const agentRejectionRate = pct(entry.rejected7d, reviewed);
      if (agentRejectionRate < HIGH_REJECTION_RATE) continue;
      const agent = others.find((candidate) => candidate.agentKey === entry.agentKey);
      if (!agent || agent.autonomy === "recommend" || agent.autonomy === "observe") continue;

      proposals.push({
        kind: "governance.reduce_autonomy",
        title: `Reduce ${entry.agentKey} to recommend-only — ${formatPercent(agentRejectionRate)} rejected`,
        rationale:
          `${entry.rejected7d} of ${reviewed} ${entry.agentKey} decisions reviewed in the last week were rejected. ` +
          `An agent whose proposals are wrong more often than not should not be executing any of them on its own ` +
          `until its inputs or its rules are corrected.`,
        effect: {
          type: "agent.setAutonomy",
          targetAgentKey: entry.agentKey,
          autonomy: "recommend",
          note: `${formatPercent(agentRejectionRate)} rejection rate over ${reviewed} reviewed decisions`,
        },
        evidence: {
          agentKey: entry.agentKey,
          rejected7d: entry.rejected7d,
          executed7d: entry.executed7d,
          rejectionRate: round(agentRejectionRate, 3),
        },
        confidence: 0.8,
        impactScore: 70,
        dedupeKey: `governance.reduce_autonomy.${entry.agentKey}`,
      });
    }

    // Decisions rotting in the queue are the failure mode of a system like
    // this: it keeps proposing, nobody reviews, and trust quietly dies.
    if (staleDecisions.length > 0) {
      const highRisk = staleDecisions.filter((decision) => decision.riskLevel === "high");
      proposals.push({
        kind: "governance.stale_queue",
        title: `${staleDecisions.length} decisions are past the review target`,
        rationale:
          `${staleDecisions.length} open ${staleDecisions.length === 1 ? "decision has" : "decisions have"} been ` +
          `waiting past the review target, ${highRisk.length} of them high risk. The oldest has waited ` +
          `${round(staleDecisions[0]?.ageHours ?? 0, 0)} hours.`,
        effect: {
          type: "notify.operator",
          subject: `${staleDecisions.length} control plane decisions need review`,
          body: staleDecisions
            .slice(0, 10)
            .map(
              (decision) =>
                `#${decision.id} [${decision.riskLevel}] ${decision.agentKey}: ${truncate(decision.title, 80)} (${round(decision.ageHours, 0)}h)`,
            )
            .join("\n"),
          severity: highRisk.length > 0 ? "warning" : "info",
        },
        evidence: { stale: staleDecisions.length, highRisk: highRisk.length },
        confidence: 0.95,
        impactScore: clamp(40 + staleDecisions.length * 5, 40, 90),
        dedupeKey: `governance.stale_queue.${today}`,
        expiresInHours: 24,
      });
    }

    // Silence is a failure too — a scheduler that stopped looks identical to
    // a healthy quiet week unless somebody checks.
    for (const agent of silent) {
      proposals.push({
        kind: "governance.silent_agent",
        title: `${agent.agentKey} has not run in ${round((agent.minutesSinceLastRun ?? 0) / 60, 1)}h`,
        rationale:
          `${agent.agentKey} is enabled but has not completed a run in ` +
          `${round((agent.minutesSinceLastRun ?? 0) / 60, 1)} hours, far past its schedule. Either the worker is ` +
          `not ticking or the agent is wedged.`,
        effect: {
          type: "notify.operator",
          subject: `Agent ${agent.agentKey} is overdue`,
          body:
            `Last run: ${agent.lastRunAt ?? "never"}\n` +
            `Status: ${agent.status}\n` +
            `Last error: ${agent.lastError ?? "none"}`,
          severity: "warning",
        },
        evidence: { agentKey: agent.agentKey, minutesSinceLastRun: agent.minutesSinceLastRun },
        confidence: 0.85,
        impactScore: 55,
        dedupeKey: `governance.silent.${agent.agentKey}.${today}`,
        expiresInHours: 24,
      });
    }

    // A daily record of what the fleet did, written whether or not anything
    // went wrong — the audit trail is only useful if it is unbroken.
    proposals.push({
      kind: "governance.daily_digest",
      title: `Fleet governance digest — ${today}`,
      rationale:
        `Daily record of fleet state: ${fleet.length} agents registered, ${disabled.length} disabled, ` +
        `${unhealthy.length} unhealthy, ${ledger.openCount} decisions open, ${ledger.executed24h} executed in 24h.`,
      effect: {
        type: "report.digest",
        title: `Governance digest ${today}`,
        audience: "operator",
        body:
          `Agents: ${fleet.length} registered, ${disabled.length} disabled, ${autoExecuting.length} autonomous.\n` +
          `Health: ${unhealthy.length} failing, ${silent.length} overdue, ${budgetExhausted.length} out of budget.\n` +
          `Ledger: ${ledger.openCount} open, ${ledger.executed24h} executed in 24h, ` +
          `${ledger.approved7d} approved and ${ledger.rejected7d} rejected in 7 days.\n` +
          `Review debt: ${staleDecisions.length} decisions past the review target.\n` +
          fleet
            .map(
              (agent) =>
                `  • ${agent.agentKey}: ${agent.enabled ? agent.autonomy : "disabled"}, health ${round(agent.healthScore, 2)}, ` +
                `${agent.actionsToday}/${agent.dailyActionBudget} actions today`,
            )
            .join("\n"),
      },
      evidence: {
        fleetSize: fleet.length,
        unhealthy: unhealthy.length,
        openDecisions: ledger.openCount,
        executed24h: ledger.executed24h,
      },
      confidence: 0.99,
      impactScore: 10,
      dedupeKey: `governance.digest.${today}`,
      expiresInHours: 48,
    });

    const healthScore = clamp(
      1 -
        (unhealthy.length * 0.2 +
          silent.length * 0.1 +
          Math.min(0.3, staleDecisions.length * 0.03)),
      0,
      1,
    );

    return {
      summary:
        `${fleet.length} agents, ${unhealthy.length} unhealthy, ${silent.length} overdue; ` +
        `${ledger.openCount} decisions open (${staleDecisions.length} stale).`,
      observations,
      proposals,
      memory:
        unhealthy.length > 0
          ? [
              {
                kind: "lesson" as const,
                content: `${today}: paused or flagged ${unhealthy.map((agent) => agent.agentKey).join(", ")} for repeated run failures.`,
                importance: 0.7,
                tags: ["governance", "health"],
              },
            ]
          : [],
      metrics: [
        { metricKey: "governance.fleet_health", value: round(healthScore, 3) },
        { metricKey: "governance.open_decisions", value: ledger.openCount },
        { metricKey: "governance.stale_decisions", value: staleDecisions.length },
        { metricKey: "governance.executed_24h", value: ledger.executed24h },
      ],
    };
  },
};

/** How long an agent may stay quiet before governance treats it as stuck. */
function expectedSilenceMinutes(agentKey: string, ctx: AgentContext): number {
  const configured = ctx.agent.config[`expectedIntervalMinutes.${agentKey}`];
  const base = typeof configured === "number" && configured > 0 ? configured : 240;
  return base * SILENT_AGENT_MINUTES_MULTIPLIER;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
