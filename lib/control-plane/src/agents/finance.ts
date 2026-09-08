import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal } from "../types.js";
import { clamp, dayBucket, formatPercent, formatUsd, observation, pct, round } from "../util.js";

const RUNWAY_WARNING_DAYS = 14;
const RUNWAY_CRITICAL_DAYS = 5;
const MARGIN_FLOOR = 0.4;

/**
 * Finance owns unit economics: what a delivered gallery costs, what the
 * organisation pays, how much credit is left, and how long it lasts.
 */
export const financeAgent: AgentDefinition = {
  key: "finance-agent",
  domain: "finance",
  displayName: "Finance",
  charter: "Protect margin and warn before an organisation runs out of credit.",
  defaultIntervalMinutes: 360,
  defaultAutonomy: "recommend",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const { finance, organization, funnel } = snapshot;
    const proposals: DecisionProposal[] = [];
    const today = dayBucket(now);

    const revenue = finance.estimatedRevenueUsd30d;
    const cogs = finance.estimatedCogsUsd30d;
    const grossMargin = revenue > 0 ? (revenue - cogs) / revenue : null;
    const costPerDelivery = funnel.last7d.ready > 0 ? cogs / Math.max(1, finance.creditsBurned30d) : null;
    const burnPerDay = finance.creditsBurned7d / 7;
    const refundRate = pct(finance.refunds30d, Math.max(1, finance.creditsBurned30d));

    const observations = [
      observation("credits_balance", "Credit balance", finance.creditsBalance, {
        goodDirection: "up",
        severity:
          finance.runwayDays !== null && finance.runwayDays <= RUNWAY_CRITICAL_DAYS
            ? "critical"
            : finance.runwayDays !== null && finance.runwayDays <= RUNWAY_WARNING_DAYS
              ? "warning"
              : "info",
      }),
      observation("runway_days", "Days of credit at current burn", finance.runwayDays, {
        goodDirection: "up",
        detail: burnPerDay > 0 ? `${round(burnPerDay, 2)} credits/day` : "no burn in the last week",
      }),
      observation("gross_margin_30d", "Gross margin, 30 days", grossMargin === null ? null : round(grossMargin, 3), {
        goodDirection: "up",
        detail:
          grossMargin === null
            ? "no recorded revenue in the window"
            : `${formatUsd(revenue)} revenue against ${formatUsd(cogs)} generation cost`,
        severity: grossMargin !== null && grossMargin < MARGIN_FLOOR ? "warning" : "info",
      }),
      observation("cost_per_delivery", "Estimated cost per delivered gallery",
        costPerDelivery === null ? null : round(costPerDelivery, 3), { goodDirection: "down" }),
      observation("refund_rate_30d", "Credit refund rate, 30 days", round(refundRate, 3), {
        goodDirection: "down",
        severity: refundRate > 0.1 ? "warning" : "info",
      }),
    ];

    // Running out of credit stops the product dead — this is the one finance
    // signal that must reach a person early.
    if (finance.runwayDays !== null && finance.runwayDays <= RUNWAY_WARNING_DAYS && burnPerDay > 0) {
      const critical = finance.runwayDays <= RUNWAY_CRITICAL_DAYS;
      proposals.push({
        kind: "finance.runway_alert",
        title: `${round(finance.runwayDays, 1)} days of credit left at the current burn`,
        rationale:
          `${organization.name} holds ${finance.creditsBalance} credits and is burning ${round(burnPerDay, 2)} ` +
          `per day (${finance.creditsBurned7d} in the last week). At that rate the balance reaches zero in ` +
          `${round(finance.runwayDays, 1)} days, after which couples on tour get a refusal rather than a gallery.`,
        effect: {
          type: "notify.operator",
          subject: critical
            ? `Credit balance runs out in ${round(finance.runwayDays, 1)} days`
            : `Credit runway is down to ${round(finance.runwayDays, 1)} days`,
          body:
            `Balance: ${finance.creditsBalance} credits\n` +
            `Burn: ${finance.creditsBurned7d} credits in 7 days (${round(burnPerDay, 2)}/day)\n` +
            `Plan: ${organization.plan}${organization.hasSubscription ? " (subscription active)" : " (no active subscription)"}\n` +
            `Granted in 30 days: ${finance.creditsGranted30d}`,
          severity: critical ? "critical" : "warning",
        },
        evidence: {
          creditsBalance: finance.creditsBalance,
          burnPerDay: round(burnPerDay, 3),
          runwayDays: round(finance.runwayDays, 2),
          plan: organization.plan,
        },
        confidence: 0.92,
        impactScore: critical ? 95 : 75,
        dedupeKey: `finance.runway.${critical ? "critical" : "warning"}.${today}`,
        expiresInHours: 48,
      });
    }

    // Margin below the floor means the business is buying revenue.
    if (grossMargin !== null && grossMargin < MARGIN_FLOOR && revenue > 0) {
      proposals.push({
        kind: "finance.margin_alert",
        title: `Gross margin is ${formatPercent(grossMargin)} — below the ${formatPercent(MARGIN_FLOOR)} floor`,
        rationale:
          `Thirty-day revenue of ${formatUsd(revenue)} carries ${formatUsd(cogs)} of generation cost, leaving ` +
          `${formatPercent(grossMargin)} gross margin. Either a delivered gallery costs more than it is priced ` +
          `for, or too many attempts are being spent per delivery.`,
        effect: {
          type: "workItem.upsert",
          workItem: {
            type: "upgrade",
            title: "Bring gallery unit cost back under the margin floor",
            detail:
              `30d revenue ${formatUsd(revenue)}, generation cost ${formatUsd(cogs)}, margin ` +
              `${formatPercent(grossMargin)}. Check attempts per delivered frame, quality-gate re-runs, and ` +
              `whether the credit price matches the model chain in use.`,
            severity: "high",
            surface: "unit_economics",
            dedupeKey: "finance.margin_floor",
            evidence: { revenue: round(revenue, 2), cogs: round(cogs, 2), grossMargin: round(grossMargin, 4) },
          },
        },
        evidence: { revenue: round(revenue, 2), cogs: round(cogs, 2), grossMargin: round(grossMargin, 4) },
        confidence: 0.8,
        impactScore: clamp(60 + (MARGIN_FLOOR - grossMargin) * 100, 40, 95),
        dedupeKey: "finance.margin_floor",
      });
    }

    // A high refund rate is money leaking through failures, and it is the
    // finance-side mirror of the product agent's failure work.
    if (refundRate > 0.1 && finance.refunds30d >= 3) {
      proposals.push({
        kind: "finance.refund_spike",
        title: `${formatPercent(refundRate)} of consumed credits were refunded`,
        rationale:
          `${finance.refunds30d} credits were refunded against ${finance.creditsBurned30d} consumed in 30 days. ` +
          `Refunds only happen when a gallery fails, so this is failure cost measured in money rather than in ` +
          `error rates.`,
        effect: {
          type: "notify.operator",
          subject: `Credit refunds at ${formatPercent(refundRate)} of consumption`,
          body:
            `Refunded: ${finance.refunds30d} credits in 30 days\n` +
            `Consumed: ${finance.creditsBurned30d} credits\n` +
            `Every refund is a couple who did not get their gallery — see the product agent's open repair items.`,
          severity: "warning",
        },
        evidence: { refunds30d: finance.refunds30d, burned30d: finance.creditsBurned30d },
        confidence: 0.85,
        impactScore: 60,
        dedupeKey: `finance.refund_spike.${today}`,
        expiresInHours: 72,
      });
    }

    // Trial organisations that are actually using the product are the ones
    // worth converting — hand that to sales rather than guessing at it here.
    if (
      organization.plan === "trial" &&
      !organization.hasSubscription &&
      funnel.last7d.ready >= 3 &&
      finance.creditsBalance <= 5
    ) {
      proposals.push({
        kind: "finance.conversion_ready",
        title: `${organization.name} is a trial that has run out of room`,
        rationale:
          `The organisation delivered ${funnel.last7d.ready} galleries this week on a trial plan and is down ` +
          `to ${finance.creditsBalance} credits. Usage has proven the product; the constraint now is the plan.`,
        effect: {
          type: "notify.operator",
          subject: `Trial ready to convert: ${organization.name}`,
          body:
            `Delivered this week: ${funnel.last7d.ready}\n` +
            `Credits remaining: ${finance.creditsBalance}\n` +
            `Account age: ${organization.ageDays} days\n` +
            `This account is using the product and is out of credit — a plan conversation is warranted.`,
          severity: "info",
        },
        evidence: {
          delivered7d: funnel.last7d.ready,
          creditsBalance: finance.creditsBalance,
          ageDays: organization.ageDays,
        },
        confidence: 0.78,
        impactScore: 70,
        dedupeKey: `finance.conversion_ready.${today}`,
        expiresInHours: 168,
      });
    }

    return {
      summary:
        `${finance.creditsBalance} credits` +
        (finance.runwayDays === null ? "" : ` (${round(finance.runwayDays, 1)}d runway)`) +
        `, margin ${grossMargin === null ? "n/a" : formatPercent(grossMargin)}, ` +
        `refund rate ${formatPercent(refundRate)}.`,
      observations,
      proposals,
      memory: [],
      metrics: [
        { metricKey: "finance.credits_balance", value: finance.creditsBalance },
        { metricKey: "finance.credits_burned_7d", value: finance.creditsBurned7d },
        { metricKey: "finance.cogs_usd_30d", value: round(cogs, 4) },
        { metricKey: "finance.revenue_usd_30d", value: round(revenue, 2) },
        ...(grossMargin === null ? [] : [{ metricKey: "finance.gross_margin_30d", value: round(grossMargin, 4) }]),
        ...(finance.runwayDays === null ? [] : [{ metricKey: "finance.runway_days", value: round(finance.runwayDays, 2) }]),
      ],
    };
  },
};
