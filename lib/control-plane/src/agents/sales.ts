import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal, LeadSnapshot } from "../types.js";
import { clamp, dayBucket, observation, pct, round } from "../util.js";

const QUALIFY_SCORE = 60;
const STALE_LEAD_DAYS = 30;
const OUTREACH_PER_TICK = 4;

const SOURCE_WEIGHTS: Record<string, number> = {
  referral: 40,
  inbound: 30,
  demo_request: 45,
  event: 25,
  outbound: 10,
  import: 5,
};

/**
 * Score a lead from what is actually known about it. Deterministic on
 * purpose: the same lead always scores the same, so stage changes are
 * explainable to the person who has to make the call.
 */
export function scoreLead(lead: LeadSnapshot): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = SOURCE_WEIGHTS[lead.source] ?? 10;
  reasons.push(`source ${lead.source} (+${SOURCE_WEIGHTS[lead.source] ?? 10})`);

  if (lead.contactEmail) {
    score += 15;
    reasons.push("has a contact email (+15)");
  }
  if (lead.contactName) {
    score += 10;
    reasons.push("has a named contact (+10)");
  }

  if (lead.ageDays <= 3) {
    score += 20;
    reasons.push("created in the last 3 days (+20)");
  } else if (lead.ageDays <= 14) {
    score += 10;
    reasons.push("created in the last 2 weeks (+10)");
  } else if (lead.ageDays > 60) {
    score -= 15;
    reasons.push("older than 60 days (-15)");
  }

  if (lead.daysSinceLastTouch !== null && lead.daysSinceLastTouch <= 7) {
    score += 10;
    reasons.push("touched within the week (+10)");
  }
  if (lead.stage === "demo") {
    score += 15;
    reasons.push("reached demo stage (+15)");
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

/**
 * Sales owns the pipeline's honesty: every lead scored on the same basis,
 * nothing sitting in a stage it has outgrown, nothing quietly rotting.
 */
export const salesAgent: AgentDefinition = {
  key: "sales-agent",
  domain: "sales",
  displayName: "Sales",
  charter: "Keep the venue pipeline scored, moving, and free of dead weight.",
  defaultIntervalMinutes: 240,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const proposals: DecisionProposal[] = [];
    const today = dayBucket(now);
    const leads = snapshot.leads;
    const openLeads = leads.filter((lead) => lead.stage !== "won" && lead.stage !== "lost");
    const won = leads.filter((lead) => lead.stage === "won");
    const winRate = pct(won.length, Math.max(1, leads.filter((lead) => lead.stage === "won" || lead.stage === "lost").length));

    const observations = [
      observation("open_pipeline", "Open leads", openLeads.length, { goodDirection: "up" }),
      observation("qualified_leads", "Leads at or above the qualification bar",
        openLeads.filter((lead) => scoreLead(lead).score >= QUALIFY_SCORE).length, { goodDirection: "up" }),
      observation("stale_leads", "Leads untouched 30+ days",
        openLeads.filter((lead) => (lead.daysSinceLastTouch ?? lead.ageDays) >= STALE_LEAD_DAYS).length,
        { goodDirection: "down", severity: openLeads.some((lead) => (lead.daysSinceLastTouch ?? lead.ageDays) >= STALE_LEAD_DAYS) ? "warning" : "info" }),
      observation("win_rate", "Win rate on closed leads", round(winRate, 3), { goodDirection: "up" }),
      observation("overdue_actions", "Leads with an overdue next action",
        openLeads.filter((lead) => (lead.nextActionOverdueDays ?? 0) > 0).length, { goodDirection: "down" }),
    ];

    for (const lead of openLeads) {
      const { score, reasons } = scoreLead(lead);

      // Re-score whenever the stored score has drifted materially.
      if (Math.abs(score - lead.score) >= 10) {
        proposals.push({
          kind: "sales.rescore",
          title: `Re-score ${lead.companyName}: ${lead.score} → ${score}`,
          rationale: `Scoring inputs changed. Basis: ${reasons.join(", ")}.`,
          effect: { type: "lead.score", leadId: lead.id, score, note: reasons.join("; ") },
          evidence: { leadId: lead.id, previousScore: lead.score, score, reasons },
          confidence: 0.85,
          impactScore: 20,
          dedupeKey: `sales.rescore.${lead.id}.${today}`,
          expiresInHours: 72,
        });
      }

      // Promotion out of "new" once the lead clears the bar.
      if (lead.stage === "new" && score >= QUALIFY_SCORE) {
        proposals.push({
          kind: "sales.qualify",
          title: `Qualify ${lead.companyName} (score ${score})`,
          rationale:
            `${lead.companyName} scores ${score}, at or above the ${QUALIFY_SCORE} qualification bar. ` +
            `Basis: ${reasons.join(", ")}. Leaving a qualified lead in "new" hides it from the working queue.`,
          effect: {
            type: "lead.advance",
            leadId: lead.id,
            stage: "qualified",
            note: `Auto-qualified at score ${score}`,
          },
          evidence: { leadId: lead.id, score, reasons },
          confidence: 0.8,
          impactScore: 45,
          dedupeKey: `sales.qualify.${lead.id}`,
        });
      }

      // Dead weight: nothing has happened for a month.
      const untouched = lead.daysSinceLastTouch ?? lead.ageDays;
      if (untouched >= STALE_LEAD_DAYS && lead.stage !== "demo") {
        proposals.push({
          kind: "sales.close_stale",
          title: `Close ${lead.companyName} as lost — ${untouched} days untouched`,
          rationale:
            `No contact with ${lead.companyName} in ${untouched} days at stage "${lead.stage}". A pipeline that ` +
            `keeps unworked leads open reports a number nobody can act on.`,
          effect: {
            type: "lead.advance",
            leadId: lead.id,
            stage: "lost",
            note: `No contact in ${untouched} days`,
          },
          evidence: { leadId: lead.id, untouchedDays: untouched, stage: lead.stage },
          confidence: 0.7,
          impactScore: 25,
          dedupeKey: `sales.close_stale.${lead.id}`,
        });
      }
    }

    // Outreach on the strongest overdue leads only — this reaches a human
    // outside the company, so it is high risk by construction.
    const outreachTargets = openLeads
      .filter((lead) => (lead.nextActionOverdueDays ?? 0) > 0 && lead.contactEmail)
      .sort((a, b) => scoreLead(b).score - scoreLead(a).score)
      .slice(0, OUTREACH_PER_TICK);

    for (const lead of outreachTargets) {
      const { score } = scoreLead(lead);
      proposals.push({
        kind: "sales.outreach",
        title: `Follow up with ${lead.companyName} (${lead.nextActionOverdueDays}d overdue)`,
        rationale:
          `The scheduled next action for ${lead.companyName} is ${lead.nextActionOverdueDays} days overdue and the ` +
          `lead scores ${score}. This is the highest-value follow-up currently unsent.`,
        effect: {
          type: "lead.outreach",
          leadId: lead.id,
          subject: `Showing couples their wedding at ${lead.companyName}`,
          body:
            `Hi${lead.contactName ? ` ${lead.contactName}` : ""},\n\n` +
            `Following up on glimpse for ${lead.companyName}. Couples on a tour upload one photo and get four ` +
            `images of their own wedding at your venue, plus a short branded reel — usually before they leave ` +
            `the car park.\n\n` +
            `Worth fifteen minutes to see it run on your own photography?`,
        },
        evidence: { leadId: lead.id, score, overdueDays: lead.nextActionOverdueDays },
        confidence: 0.65,
        impactScore: clamp(score, 20, 85),
        dedupeKey: `sales.outreach.${lead.id}.${today}`,
        expiresInHours: 96,
      });
    }

    return {
      summary:
        `${openLeads.length} open leads, ` +
        `${openLeads.filter((lead) => scoreLead(lead).score >= QUALIFY_SCORE).length} qualified, ` +
        `${openLeads.filter((lead) => (lead.daysSinceLastTouch ?? lead.ageDays) >= STALE_LEAD_DAYS).length} stale.`,
      observations,
      proposals,
      memory: [],
      metrics: [
        { metricKey: "sales.open_leads", value: openLeads.length },
        { metricKey: "sales.win_rate", value: round(winRate, 4) },
      ],
    };
  },
};
