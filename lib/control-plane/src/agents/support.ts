import type { AgentContext, AgentDefinition, AgentOutput, DecisionProposal, TicketSnapshot } from "../types.js";
import { clamp, dayBucket, observation, round } from "../util.js";

const FIRST_RESPONSE_SLA_HOURS = 8;
const ESCALATION_HOURS = 24;
const MAX_DRAFTS_PER_TICK = 8;

interface Classification {
  category: string;
  sentiment: string;
  priority: string;
}

const CATEGORY_RULES: { category: string; patterns: RegExp[] }[] = [
  { category: "gallery_failed", patterns: [/fail/i, /error/i, /didn'?t work/i, /broken/i, /stuck/i] },
  { category: "gallery_quality", patterns: [/look(s)? (wrong|weird|off)/i, /doesn'?t look like/i, /quality/i, /face/i] },
  { category: "billing", patterns: [/charg/i, /invoice/i, /refund/i, /billing/i, /subscription/i, /credit/i] },
  { category: "access", patterns: [/sign in/i, /log ?in/i, /password/i, /access/i, /link (doesn'?t|not) work/i] },
  { category: "setup", patterns: [/upload/i, /photo/i, /set ?up/i, /onboard/i, /qr/i] },
  { category: "sales", patterns: [/pricing/i, /demo/i, /plan/i, /how much/i, /trial/i] },
];

const NEGATIVE_PATTERNS = [/angry/i, /unacceptable/i, /terrible/i, /awful/i, /refund/i, /cancel/i, /disappoint/i, /furious/i];
const POSITIVE_PATTERNS = [/thank/i, /love/i, /amazing/i, /great/i, /perfect/i];
const URGENT_PATTERNS = [/urgent/i, /asap/i, /today/i, /wedding is/i, /tour (is|starts)/i, /tomorrow/i];

/** Deterministic triage: the same ticket always lands in the same bucket. */
export function classifyTicket(ticket: Pick<TicketSnapshot, "subject" | "body">): Classification {
  const text = `${ticket.subject}\n${ticket.body}`;
  const category =
    CATEGORY_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)))?.category ??
    "general";

  const negative = NEGATIVE_PATTERNS.some((pattern) => pattern.test(text));
  const positive = POSITIVE_PATTERNS.some((pattern) => pattern.test(text));
  const sentiment = negative ? "negative" : positive ? "positive" : "neutral";

  const urgent = URGENT_PATTERNS.some((pattern) => pattern.test(text));
  const priority =
    urgent || (negative && (category === "gallery_failed" || category === "billing"))
      ? "urgent"
      : negative || category === "gallery_failed" || category === "billing"
        ? "high"
        : "normal";

  return { category, sentiment, priority };
}

const REPLY_TEMPLATES: Record<string, (ticket: TicketSnapshot) => string> = {
  gallery_failed: (ticket) =>
    `Thanks for flagging this — a failed gallery is on us, not on you.\n\n` +
    `I've pulled up${ticket.sessionId ? ` gallery #${ticket.sessionId}` : " the session"} and queued it to run again. ` +
    `If the retry doesn't land within about fifteen minutes, the credit is returned automatically and we'll ` +
    `follow up here with what went wrong.`,
  gallery_quality: () =>
    `Thanks for the detail — likeness is the part we hold to the highest bar.\n\n` +
    `Two things usually move it: a clearer, front-facing photo of each partner, and a fuller set of venue ` +
    `photos so the scene has more to draw from. If you re-run with a sharper reference photo and it still ` +
    `looks off, reply here and we'll review the frames directly.`,
  billing: () =>
    `Thanks for writing in about billing.\n\n` +
    `Credits are only consumed by a delivered gallery — anything that fails is refunded to your balance ` +
    `automatically. I'm reviewing your recent charges now and will confirm the exact figures in this thread.`,
  access: () =>
    `Sorry for the trouble getting in.\n\n` +
    `Sign-in runs through your own profile, so the fastest fix is a fresh sign-in from the login page. ` +
    `If your organisation shows no venues after signing in, reply here and we'll re-link the account.`,
  setup: () =>
    `Happy to help finish setup.\n\n` +
    `Galleries need venue photos across exterior, ceremony, reception and detail coverage. Once those are ` +
    `uploaded from your dashboard your couple link goes live immediately, QR code included.`,
  sales: () =>
    `Thanks for the interest.\n\n` +
    `Venues buy credits and each delivered gallery uses one. New venues start with trial credits so you can ` +
    `see real output before committing. Tell me roughly how many tours you run a month and I'll point you at ` +
    `the plan that fits.`,
  general: () =>
    `Thanks for reaching out — I've got this and I'm looking into it now. ` +
    `I'll come back in this thread shortly with a concrete answer.`,
};

/**
 * Support owns the inbox: nothing sits untriaged, nothing sits unanswered
 * past the response target, and anything angry or expensive reaches a human.
 */
export const supportAgent: AgentDefinition = {
  key: "support-agent",
  domain: "support",
  displayName: "Support",
  charter: "Triage, draft, and resolve every inbound request inside the response target.",
  defaultIntervalMinutes: 15,
  defaultAutonomy: "supervised",

  run(ctx: AgentContext): AgentOutput {
    const { snapshot, now } = ctx;
    const proposals: DecisionProposal[] = [];
    const today = dayBucket(now);
    const open = snapshot.tickets.filter(
      (ticket) => ticket.status === "open" || ticket.status === "pending",
    );

    const untriaged = open.filter((ticket) => ticket.category === "general" && ticket.ageHours < 72);
    const awaitingDraft = open.filter((ticket) => !ticket.hasDraft);
    const breaching = open.filter(
      (ticket) => ticket.hoursSinceFirstResponse === null && ticket.ageHours >= FIRST_RESPONSE_SLA_HOURS,
    );
    const stale = open.filter((ticket) => ticket.ageHours >= ESCALATION_HOURS);
    const responded = snapshot.tickets.filter((ticket) => ticket.hoursSinceFirstResponse !== null);
    const medianFirstResponse = median(
      responded.map((ticket) => ticket.ageHours - (ticket.hoursSinceFirstResponse ?? 0)),
    );

    const observations = [
      observation("open_tickets", "Open tickets", open.length, {
        goodDirection: "down",
        severity: breaching.length > 0 ? "warning" : "info",
      }),
      observation("awaiting_first_response", "Past the response target", breaching.length, {
        goodDirection: "down",
        severity: breaching.length > 0 ? "warning" : "info",
      }),
      observation("median_first_response_hours", "Median hours to first response", medianFirstResponse, {
        goodDirection: "down",
      }),
      observation("urgent_open", "Urgent tickets open", open.filter((ticket) => ticket.priority === "urgent").length, {
        goodDirection: "down",
      }),
    ];

    // Triage first — priority drives everything downstream.
    for (const ticket of untriaged.slice(0, MAX_DRAFTS_PER_TICK)) {
      const classification = classifyTicket(ticket);
      if (
        classification.category === ticket.category &&
        classification.priority === ticket.priority &&
        classification.sentiment === ticket.sentiment
      ) {
        continue;
      }
      proposals.push({
        kind: "support.triage",
        title: `Triage ticket #${ticket.id} as ${classification.category} / ${classification.priority}`,
        rationale:
          `Ticket #${ticket.id} ("${truncate(ticket.subject, 60)}") is untriaged after ` +
          `${round(ticket.ageHours, 1)}h. Keyword classification puts it in ${classification.category} with ` +
          `${classification.sentiment} sentiment, which sets its response priority to ${classification.priority}.`,
        effect: {
          type: "ticket.triage",
          ticketId: ticket.id,
          category: classification.category,
          sentiment: classification.sentiment,
          priority: classification.priority,
        },
        evidence: { ticketId: ticket.id, subject: ticket.subject, ...classification },
        confidence: 0.8,
        impactScore: classification.priority === "urgent" ? 60 : 30,
        dedupeKey: `support.triage.${ticket.id}`,
        expiresInHours: 72,
      });
    }

    // Draft a reply for anything without one. Drafts are low risk by design —
    // writing is automatic, sending is a human's call.
    for (const ticket of awaitingDraft.slice(0, MAX_DRAFTS_PER_TICK)) {
      const category = ticket.category === "general" ? classifyTicket(ticket).category : ticket.category;
      const template = REPLY_TEMPLATES[category] ?? REPLY_TEMPLATES.general;
      proposals.push({
        kind: "support.draft_reply",
        title: `Draft a reply to ticket #${ticket.id}`,
        rationale:
          `Ticket #${ticket.id} has waited ${round(ticket.ageHours, 1)}h without a drafted response. ` +
          `A ${category} reply is prepared from the standing playbook so a human only has to read and send.`,
        effect: {
          type: "ticket.draftReply",
          ticketId: ticket.id,
          message: template(ticket),
        },
        evidence: { ticketId: ticket.id, category },
        confidence: 0.85,
        impactScore: clamp(40 + ticket.ageHours, 20, 75),
        dedupeKey: `support.draft.${ticket.id}`,
        expiresInHours: 72,
      });
    }

    // Escalate anything that has aged out or is angry and expensive.
    for (const ticket of stale.slice(0, 5)) {
      if (ticket.priority === "urgent") continue;
      proposals.push({
        kind: "support.escalate",
        title: `Escalate ticket #${ticket.id} — open ${round(ticket.ageHours, 0)}h`,
        rationale:
          `Ticket #${ticket.id} has been open ${round(ticket.ageHours, 0)}h, past the ${ESCALATION_HOURS}h ` +
          `escalation line, at ${ticket.priority} priority and ${ticket.sentiment} sentiment. Ageing quietly ` +
          `is how a support queue loses a customer.`,
        effect: {
          type: "ticket.escalate",
          ticketId: ticket.id,
          priority: "urgent",
          note: `Open ${round(ticket.ageHours, 0)}h without resolution`,
        },
        evidence: { ticketId: ticket.id, ageHours: round(ticket.ageHours, 1) },
        confidence: 0.82,
        impactScore: 65,
        dedupeKey: `support.escalate.${ticket.id}`,
        expiresInHours: 72,
      });
    }

    if (breaching.length >= 3) {
      proposals.push({
        kind: "support.sla_breach",
        title: `${breaching.length} tickets are past the ${FIRST_RESPONSE_SLA_HOURS}h response target`,
        rationale:
          `${breaching.length} open tickets have had no first response inside ${FIRST_RESPONSE_SLA_HOURS} hours. ` +
          `At this volume the queue needs a person, not another draft.`,
        effect: {
          type: "notify.operator",
          subject: `${breaching.length} support tickets past the response target`,
          body: breaching
            .slice(0, 10)
            .map((ticket) => `#${ticket.id} (${round(ticket.ageHours, 0)}h, ${ticket.priority}): ${truncate(ticket.subject, 70)}`)
            .join("\n"),
          severity: breaching.length >= 6 ? "critical" : "warning",
        },
        evidence: { breaching: breaching.length },
        confidence: 0.9,
        impactScore: 70,
        dedupeKey: `support.sla_breach.${today}`,
        expiresInHours: 24,
      });
    }

    return {
      summary:
        `${open.length} open (${breaching.length} past target, ` +
        `${open.filter((ticket) => ticket.priority === "urgent").length} urgent); ` +
        `${awaitingDraft.length} awaiting a draft.`,
      observations,
      proposals,
      memory: [],
      metrics: [
        { metricKey: "support.open_tickets", value: open.length },
        { metricKey: "support.breaching_tickets", value: breaching.length },
        ...(medianFirstResponse === null
          ? []
          : [{ metricKey: "support.median_first_response_hours", value: round(medianFirstResponse, 2) }]),
      ],
    };
  },
};

function median(values: number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.floor(sorted.length / 2)];
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
