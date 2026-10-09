import {
  db,
  agentActionsTable,
  agentRunsTable,
  controlAdaptationsTable,
  controlDigestsTable,
  controlExperimentsTable,
  type ControlAdaptation,
  type ControlDigest,
  type ControlExperiment,
} from "@workspace/db";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { proposeAction } from "../actions.js";
import type { BusinessMetrics } from "../metrics.js";
import { growthSnapshotNearest, latestGrowthSnapshot, snapshotMetrics } from "../metrics.js";
import { operatorEmails } from "../operatorAuth.js";
import { digestHourUtc, digestWeekday, growthLoopEnabled } from "./config.js";
import { escapeHtml, growthCtaButton, growthEmailLayout } from "./emailRender.js";
import { DAY_MS, kpiDeltas, mondayOf, rate, type KpiDelta } from "./kpiMath.js";
import type { GrowthKpis } from "./kpiTypes.js";
import { controlUrl } from "./config.js";

/*
 * Weekly operator digest (growth-loop.md section 10): built deterministically
 * by code from KPI snapshots, stored in control_digests, shown in /control ->
 * Growth, and emailed to the internal operator list through the low-risk
 * send_operator_digest action. No model text in this window (polishedBy stays
 * null). Also: the daily aging-approvals nudge.
 */

export interface DigestDocument {
  weekStart: string;
  generatedAt: string;
  headline: string;
  narrative: string | null;
  kpis: Array<{ key: string; label: string; value: string; previous: string | null; delta: string | null; tone: "good" | "bad" | "neutral" }>;
  activation: GrowthKpis["activation"]["funnel"] & { timeToFirstGalleryMedianHours: number | null };
  outbound: GrowthKpis["outbound"]["funnel"] & { topSegments: Array<{ segment: string; positiveReplyRate: number | null; sent: number }> };
  deliverability: { status: string; bounceRate: number | null; complaintRate: number | null; effectiveCap: number; baseCap: number };
  experiments: {
    due: Array<{ id: number; name: string; decisionDate: string; observed: number | null; target: number | null }>;
    decided: Array<{ id: number; name: string; decision: string; decidedAt: string }>;
  };
  recommendations: Array<{ kind: "scale" | "kill" | "fix" | "watch"; text: string }>;
  adaptations: Array<{ at: string; ruleKey: string; action: string; reason: string }>;
  pendingApprovals: number;
  dataQuality: string[];
}

export interface DigestInput {
  current: GrowthKpis;
  previous: GrowthKpis | null;
  base: BusinessMetrics;
  experiments: ControlExperiment[];
  adaptations: ControlAdaptation[];
  pendingApprovals: number;
  /** Pending actions older than three days. */
  agingApprovals?: number;
  weekStart: Date;
  now: Date;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPercent(value: number | null, digits = 1): string {
  if (value == null) return "—";
  const pct = value * 100;
  const rounded = Math.round(pct * 10 ** digits) / 10 ** digits;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(digits)}%`;
}

export function formatMoney(cents: number | null): string {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours >= 48) return `${(hours / 24).toFixed(1)} d`;
  return `${hours.toFixed(1)} h`;
}

export function formatKpiValue(unit: KpiDelta["unit"], value: number | null): string {
  if (value == null) return "—";
  switch (unit) {
    case "rate":
      return formatPercent(value, 1);
    case "cents":
      return formatMoney(value);
    case "hours":
      return formatHours(value);
    case "count":
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
}

export function formatDelta(unit: KpiDelta["unit"], delta: number | null): string | null {
  if (delta == null || delta === 0) return delta === 0 ? "±0" : null;
  const sign = delta > 0 ? "+" : "−";
  const abs = Math.abs(delta);
  switch (unit) {
    case "rate":
      return `${sign}${(abs * 100).toFixed(1)} pts`;
    case "cents":
      return `${sign}${formatMoney(abs).slice(1).length ? formatMoney(abs) : "$0"}`;
    case "hours":
      return `${sign}${formatHours(abs)}`;
    case "count":
      return `${sign}${Number.isInteger(abs) ? abs : abs.toFixed(1)}`;
  }
}

/** Pure: the digest document for one week. */
export function buildDigest(input: DigestInput): DigestDocument {
  const { current, previous, now } = input;
  const weekStart = input.weekStart;
  const deltas = kpiDeltas(current, previous);
  const firstGalleryRate = rate(current.activation.funnel.firstGallery, current.activation.funnel.withVenue);
  const headline = `Week of ${MONTHS[weekStart.getUTCMonth()]} ${weekStart.getUTCDate()}: ${current.signups.orgs7d} signups, ${formatPercent(firstGalleryRate, 1)} reach a first gallery, ${current.revenue.paidOrgs} paid`;

  const guidance = { prioritize: current.outbound.bySegment.filter((s) => s.guidance === "prioritize"), pause: current.outbound.bySegment.filter((s) => s.guidance === "pause") };
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const next7 = new Date(now.getTime() + 7 * DAY_MS);

  const recommendations: DigestDocument["recommendations"] = [];
  for (const s of guidance.prioritize) {
    recommendations.push({ kind: "scale", text: `Scale ${s.segmentType === "region" ? "region" : "venue type"} ${s.segment}: ${formatPercent(s.positiveReplyRate, 1)} positive replies on ${s.sent} sends.` });
  }
  for (const s of guidance.pause) {
    recommendations.push({ kind: "kill", text: `Stop spending on ${s.segmentType === "region" ? "region" : "venue type"} ${s.segment}: 0 positive replies and 0 signups on ${s.sent} sends.` });
  }
  for (const a of input.adaptations) {
    if (a.ruleKey === "variant_weights" && a.action === "pause" && a.createdAt >= weekAgo) {
      recommendations.push({ kind: "kill", text: `Copy variant ${a.subjectId ?? "?"} was paused: ${a.reason}` });
    }
  }
  const deliverability = current.deliverability;
  if (deliverability.status === "warn" || deliverability.status === "throttled" || deliverability.status === "paused") {
    recommendations.push({
      kind: "fix",
      text: `Deliverability is ${deliverability.status}: bounce ${formatPercent(deliverability.window14d.bounceRate, 2)}, complaints ${formatPercent(deliverability.window14d.complaintRate, 3)} over 14 days; sending ${deliverability.guard.effectiveCap}/${deliverability.guard.baseCap} per day.`,
    });
  }
  if (input.pendingApprovals > 5) {
    recommendations.push({
      kind: "fix",
      text:
        input.agingApprovals && input.agingApprovals > 0
          ? `Approvals queue has ${input.pendingApprovals} items, ${input.agingApprovals} older than 3 days.`
          : `Approvals queue has ${input.pendingApprovals} items waiting.`,
    });
  }
  if (current.activation.funnel.withVenue >= 5 && firstGalleryRate != null && firstGalleryRate < 0.3) {
    recommendations.push({
      kind: "fix",
      text: `Fewer than 30% of venues reach a first gallery (${current.activation.funnel.firstGallery}/${current.activation.funnel.withVenue}) — review onboarding.`,
    });
  }
  if (current.churn.trialsExpiringNext7dWithoutGallery > 0) {
    recommendations.push({
      kind: "fix",
      text: `${current.churn.trialsExpiringNext7dWithoutGallery} of ${current.churn.trialsExpiringNext7d} trials expiring this week never made a gallery.`,
    });
  }
  const due = input.experiments
    .filter((e) => e.status === "running" && e.decisionDate != null && e.decisionDate < next7)
    .sort((a, b) => a.decisionDate!.getTime() - b.decisionDate!.getTime());
  for (const e of due) {
    recommendations.push({ kind: "watch", text: `Experiment #${e.id} "${e.name}" decides on ${e.decisionDate!.toISOString().slice(0, 10)}.` });
  }
  for (const text of current.dataQuality) recommendations.push({ kind: "watch", text });

  return {
    weekStart: weekStart.toISOString(),
    generatedAt: now.toISOString(),
    headline,
    narrative: null,
    kpis: deltas.map((d) => ({
      key: d.key,
      label: d.label,
      value: formatKpiValue(d.unit, d.current),
      previous: d.previous == null ? null : formatKpiValue(d.unit, d.previous),
      delta: formatDelta(d.unit, d.delta),
      tone: d.tone,
    })),
    activation: { ...current.activation.funnel, timeToFirstGalleryMedianHours: current.activation.timeToFirstGalleryHours.median },
    outbound: {
      ...current.outbound.funnel,
      topSegments: [...current.outbound.bySegment]
        .filter((s) => s.sent > 0)
        .sort((a, b) => (b.positiveReplyRate ?? 0) - (a.positiveReplyRate ?? 0) || b.sent - a.sent)
        .slice(0, 5)
        .map((s) => ({ segment: `${s.segmentType}:${s.segment}`, positiveReplyRate: s.positiveReplyRate, sent: s.sent })),
    },
    deliverability: {
      status: deliverability.status,
      bounceRate: deliverability.window14d.bounceRate,
      complaintRate: deliverability.window14d.complaintRate,
      effectiveCap: deliverability.guard.effectiveCap,
      baseCap: deliverability.guard.baseCap,
    },
    experiments: {
      due: due.map((e) => ({
        id: e.id,
        name: e.name,
        decisionDate: e.decisionDate!.toISOString(),
        observed: e.observedValue ?? null,
        target: readTarget(e),
      })),
      decided: input.experiments
        .filter((e) => e.decidedAt != null && e.decidedAt >= weekAgo && e.decision)
        .map((e) => ({ id: e.id, name: e.name, decision: e.decision!, decidedAt: e.decidedAt!.toISOString() })),
    },
    recommendations,
    adaptations: input.adaptations
      .filter((a) => a.createdAt >= weekAgo)
      .slice(0, 20)
      .map((a) => ({ at: a.createdAt.toISOString(), ruleKey: a.ruleKey, action: a.action, reason: a.reason })),
    pendingApprovals: input.pendingApprovals,
    dataQuality: current.dataQuality,
  };
}

function readTarget(e: ControlExperiment): number | null {
  const evaluation = e.evaluation as { target?: unknown } | null;
  return evaluation && typeof evaluation.target === "number" ? evaluation.target : null;
}

/* ————— Rendering ————— */

const TONE_COLOR: Record<DigestDocument["kpis"][number]["tone"], string> = { good: "#1f7a4d", bad: "#b3261e", neutral: "#6b6b6b" };

function row(cells: string[], header = false): string {
  const tag = header ? "th" : "td";
  return `<tr>${cells.map((c) => `<${tag} style="text-align:left;padding:8px 10px;border-bottom:1px solid #e6e2da;font-size:14px;${header ? "font-weight:600;" : ""}">${c}</${tag}>`).join("")}</tr>`;
}

function table(rows: string[]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0 20px;">${rows.join("")}</table>`;
}

function section(title: string, inner: string): string {
  return `<h2 style="margin:24px 0 8px;font-size:17px;font-weight:600;">${escapeHtml(title)}</h2>${inner}`;
}

export function renderDigestHtml(doc: DigestDocument): string {
  const kpiRows = [
    row(["Metric", "This week", "Previous", "Change"], true),
    ...doc.kpis.map((k) =>
      row([
        escapeHtml(k.label),
        `<strong>${escapeHtml(k.value)}</strong>`,
        escapeHtml(k.previous ?? "—"),
        `<span style="color:${TONE_COLOR[k.tone]}">${escapeHtml(k.delta ?? "—")}</span>`,
      ]),
    ),
  ];
  const activation = doc.activation;
  const activationRows = [
    row(["Stage", "Count"], true),
    row(["Organizations", String(activation.orgs)]),
    row(["With a venue", String(activation.withVenue)]),
    row(["Photos ready", String(activation.photosReady)]),
    row(["First gallery", String(activation.firstGallery)]),
    row(["Gallery viewed", String(activation.galleryViewed)]),
    row(["Second gallery within 14 days", String(activation.secondGallery14d)]),
    row(["Median hours to first gallery", escapeHtml(formatHours(activation.timeToFirstGalleryMedianHours))]),
  ];
  const outbound = doc.outbound;
  const outboundRows = [
    row(["Outbound (30d)", "Count"], true),
    row(["Drafted", String(outbound.drafted)]),
    row(["Approved", String(outbound.approved)]),
    row(["Sent", String(outbound.sent)]),
    row(["Delivered", String(outbound.delivered)]),
    row(["Bounced", String(outbound.bounced)]),
    row(["Complained", String(outbound.complained)]),
    row(["Replied (positive)", `${outbound.replied} (${outbound.positiveReplied})`]),
    row(["Signups / activated / paid", `${outbound.signups} / ${outbound.activated} / ${outbound.paid}`]),
  ];
  const segmentRows = outbound.topSegments.length
    ? [row(["Segment", "Positive replies", "Sent"], true), ...outbound.topSegments.map((s) => row([escapeHtml(s.segment), escapeHtml(formatPercent(s.positiveReplyRate, 1)), String(s.sent)]))]
    : [row(["No outreach sent in the window."])];
  const deliverability = doc.deliverability;
  const deliverabilityRows = [
    row(["Status", escapeHtml(deliverability.status)]),
    row(["Bounce rate (14d)", escapeHtml(formatPercent(deliverability.bounceRate, 2))]),
    row(["Complaint rate (14d)", escapeHtml(formatPercent(deliverability.complaintRate, 3))]),
    row(["Daily cap", `${deliverability.effectiveCap} of base ${deliverability.baseCap}`]),
  ];
  const experimentRows = [
    ...doc.experiments.due.map((e) => row([`#${e.id} ${escapeHtml(e.name)}`, `decides ${escapeHtml(e.decisionDate.slice(0, 10))}`, `observed ${escapeHtml(fmtNumber(e.observed))} vs target ${escapeHtml(fmtNumber(e.target))}`])),
    ...doc.experiments.decided.map((e) => row([`#${e.id} ${escapeHtml(e.name)}`, escapeHtml(e.decision), `decided ${escapeHtml(e.decidedAt.slice(0, 10))}`])),
  ];
  const recommendationItems = doc.recommendations.length
    ? `<ul style="margin:8px 0 20px;padding-left:20px;">${doc.recommendations.map((r) => `<li style="margin:0 0 8px;"><strong>${escapeHtml(r.kind)}</strong> — ${escapeHtml(r.text)}</li>`).join("")}</ul>`
    : `<p>No recommendations this week.</p>`;
  const adaptationRows = doc.adaptations.length
    ? doc.adaptations.map((a) => row([escapeHtml(a.at.slice(0, 16).replace("T", " ")), escapeHtml(`${a.ruleKey} · ${a.action}`), escapeHtml(a.reason)]))
    : [row(["No rule firings this week."])];

  const body = [
    `<p>${escapeHtml(doc.headline)}</p>`,
    `<p>${doc.pendingApprovals} action${doc.pendingApprovals === 1 ? "" : "s"} waiting for approval.</p>`,
    section("Key numbers", table(kpiRows)),
    section("Recommendations", recommendationItems),
    section("Activation funnel", table(activationRows)),
    section("Outbound", table(outboundRows) + table(segmentRows)),
    section("Deliverability", table(deliverabilityRows)),
    section("Experiments", experimentRows.length ? table(experimentRows) : "<p>No experiments due or decided.</p>"),
    section("Adaptations", table(adaptationRows)),
    growthCtaButton(controlUrl("growth"), "Open the Growth tab"),
  ].join("\n");
  return growthEmailLayout("Weekly growth digest", body, { preheader: doc.headline });
}

function fmtNumber(value: number | null): string {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

export function renderDigestText(doc: DigestDocument): string {
  const lines: string[] = [doc.headline, "", `${doc.pendingApprovals} action(s) waiting for approval.`, "", "KEY NUMBERS"];
  for (const k of doc.kpis) {
    lines.push(`- ${k.label}: ${k.value}${k.previous ? ` (previous ${k.previous}${k.delta ? `, ${k.delta}` : ""})` : ""}`);
  }
  lines.push("", "RECOMMENDATIONS");
  if (doc.recommendations.length === 0) lines.push("- none this week");
  for (const r of doc.recommendations) lines.push(`- [${r.kind}] ${r.text}`);
  lines.push(
    "",
    "ACTIVATION FUNNEL",
    `- organizations ${doc.activation.orgs}, with a venue ${doc.activation.withVenue}, photos ready ${doc.activation.photosReady}, first gallery ${doc.activation.firstGallery}, viewed ${doc.activation.galleryViewed}, second gallery <= 14d ${doc.activation.secondGallery14d}`,
    `- median hours to first gallery: ${formatHours(doc.activation.timeToFirstGalleryMedianHours)}`,
    "",
    "OUTBOUND (30d)",
    `- drafted ${doc.outbound.drafted}, approved ${doc.outbound.approved}, sent ${doc.outbound.sent}, delivered ${doc.outbound.delivered}, bounced ${doc.outbound.bounced}, complained ${doc.outbound.complained}, replied ${doc.outbound.replied} (${doc.outbound.positiveReplied} positive), signups ${doc.outbound.signups}, activated ${doc.outbound.activated}, paid ${doc.outbound.paid}`,
  );
  for (const s of doc.outbound.topSegments) lines.push(`- ${s.segment}: ${formatPercent(s.positiveReplyRate, 1)} positive replies on ${s.sent} sent`);
  lines.push(
    "",
    "DELIVERABILITY",
    `- status ${doc.deliverability.status}; bounce ${formatPercent(doc.deliverability.bounceRate, 2)}; complaints ${formatPercent(doc.deliverability.complaintRate, 3)}; cap ${doc.deliverability.effectiveCap} of base ${doc.deliverability.baseCap}`,
    "",
    "EXPERIMENTS",
  );
  if (doc.experiments.due.length === 0 && doc.experiments.decided.length === 0) lines.push("- none due or decided");
  for (const e of doc.experiments.due) lines.push(`- #${e.id} ${e.name}: decides ${e.decisionDate.slice(0, 10)}, observed ${fmtNumber(e.observed)} vs target ${fmtNumber(e.target)}`);
  for (const e of doc.experiments.decided) lines.push(`- #${e.id} ${e.name}: ${e.decision} on ${e.decidedAt.slice(0, 10)}`);
  lines.push("", "ADAPTATIONS");
  if (doc.adaptations.length === 0) lines.push("- no rule firings this week");
  for (const a of doc.adaptations) lines.push(`- ${a.at.slice(0, 16).replace("T", " ")} ${a.ruleKey} ${a.action}: ${a.reason}`);
  lines.push("", `Growth tab: ${controlUrl("growth")}`);
  return lines.join("\n");
}

/* ————— Persistence and scheduling ————— */

const SNAPSHOT_FRESH_MS = 2 * 60 * 60 * 1000;

async function currentGrowthSnapshot(maxAgeMs: number | null) {
  let snapshot = await latestGrowthSnapshot();
  if (!snapshot || (maxAgeMs != null && Date.now() - snapshot.createdAt.getTime() > maxAgeMs)) {
    const fresh = await snapshotMetrics();
    if (fresh.metrics.growth) {
      snapshot = {
        snapshotId: fresh.snapshotId,
        createdAt: fresh.createdAt,
        metrics: fresh.metrics as BusinessMetrics & { growth: GrowthKpis },
        growth: fresh.metrics.growth,
      };
    }
  }
  if (!snapshot) throw new Error("No growth KPI snapshot is available; the KPI loaders may be failing.");
  return snapshot;
}

export async function latestDigest(): Promise<ControlDigest | null> {
  const [row] = await db.select().from(controlDigestsTable).orderBy(desc(controlDigestsTable.weekStart)).limit(1);
  return row ?? null;
}

export async function generateWeeklyDigest(options: { weekStart: Date; createdBy: string; force?: boolean; now?: Date }): Promise<ControlDigest> {
  const now = options.now ?? new Date();
  const weekStart = mondayOf(options.weekStart);
  const [existing] = await db.select().from(controlDigestsTable).where(eq(controlDigestsTable.weekStart, weekStart)).limit(1);
  if (existing && !options.force) return existing;

  const snapshot = await currentGrowthSnapshot(options.force ? SNAPSHOT_FRESH_MS : null);
  const previous = await growthSnapshotNearest(new Date(now.getTime() - 7 * DAY_MS));
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const [experiments, adaptations, [pending], [aging]] = await Promise.all([
    db
      .select()
      .from(controlExperimentsTable)
      .where(sql`${controlExperimentsTable.status} in ('proposed', 'running') or ${controlExperimentsTable.decidedAt} >= ${weekAgo}`)
      .orderBy(asc(controlExperimentsTable.decisionDate))
      .limit(50),
    db.select().from(controlAdaptationsTable).where(gte(controlAdaptationsTable.createdAt, weekAgo)).orderBy(desc(controlAdaptationsTable.createdAt)).limit(50),
    db.select({ total: sql<number>`count(*)::int` }).from(agentActionsTable).where(eq(agentActionsTable.status, "pending")),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentActionsTable)
      .where(and(eq(agentActionsTable.status, "pending"), lt(agentActionsTable.createdAt, new Date(now.getTime() - 3 * DAY_MS)))),
  ]);

  const document = buildDigest({
    current: snapshot.growth,
    previous: previous?.growth ?? null,
    base: snapshot.metrics,
    experiments,
    adaptations,
    pendingApprovals: pending?.total ?? 0,
    agingApprovals: aging?.total ?? 0,
    weekStart,
    now,
  });
  const html = renderDigestHtml(document);
  const text = renderDigestText(document);

  const [row] = await db
    .insert(controlDigestsTable)
    .values({ weekStart, document: document as unknown as Record<string, unknown>, html, text, createdBy: options.createdBy })
    .onConflictDoUpdate({
      target: controlDigestsTable.weekStart,
      set: { document: document as unknown as Record<string, unknown>, html, text, createdBy: options.createdBy },
    })
    .returning();
  if (!row) throw new Error("Failed to persist the digest.");

  if (row.sentAt == null && (await needsSendAction(row))) {
    try {
      const action = await proposeAction({
        agentKey: "growth-digest",
        runId: null,
        actionType: "send_operator_digest",
        title: `Send weekly growth digest (week of ${weekStart.toISOString().slice(0, 10)})`,
        reasoning: document.headline,
        params: { digestId: row.id },
      });
      const [withAction] = await db.update(controlDigestsTable).set({ actionId: action.id }).where(eq(controlDigestsTable.id, row.id)).returning();
      return withAction ?? row;
    } catch (err) {
      logger.error({ err, digestId: row.id }, "Could not queue the digest send action");
    }
  }
  return row;
}

/** A digest needs a (new) send action when it has none or its last one ended without sending. */
async function needsSendAction(row: ControlDigest): Promise<boolean> {
  if (row.actionId == null) return true;
  const [action] = await db.select({ status: agentActionsTable.status }).from(agentActionsTable).where(eq(agentActionsTable.id, row.actionId)).limit(1);
  if (!action) return true;
  return action.status === "failed" || action.status === "rejected";
}

/** Scheduler entry: generate this week's digest once the configured weekday/hour has passed. */
export async function maybeGenerateWeeklyDigest(now: Date = new Date()): Promise<ControlDigest | null> {
  if (!growthLoopEnabled()) return null;
  if (now.getUTCDay() !== digestWeekday() || now.getUTCHours() < digestHourUtc()) return null;
  const weekStart = mondayOf(now);
  const [existing] = await db.select({ id: controlDigestsTable.id }).from(controlDigestsTable).where(eq(controlDigestsTable.weekStart, weekStart)).limit(1);
  if (existing) return null;
  return generateWeeklyDigest({ weekStart, createdBy: "system:scheduler", now });
}

/* ————— Daily aging-approvals nudge ————— */

export const AGING_APPROVAL_HOURS = 48;
let lastNudgeCheckAt = 0;
let warnedNoOperators = false;

/** Once per UTC day: when governed actions have waited > 48h, propose the internal operator nudge. */
export async function maybeSendAgingApprovalsNudge(now: Date = new Date()): Promise<boolean> {
  if (!growthLoopEnabled()) return false;
  if (now.getTime() - lastNudgeCheckAt < DAY_MS) return false;
  lastNudgeCheckAt = now.getTime();
  if (operatorEmails().length === 0) {
    if (!warnedNoOperators) {
      warnedNoOperators = true;
      logger.warn("CONTROL_PLANE_OPERATOR_EMAILS is empty; the aging-approvals nudge has nobody to email");
    }
    return false;
  }
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [already] = await db
    .select({ id: agentActionsTable.id })
    .from(agentActionsTable)
    .where(and(eq(agentActionsTable.actionType, "send_operator_nudge"), gte(agentActionsTable.createdAt, dayStart)))
    .limit(1);
  if (already) return false;

  const cutoff = new Date(now.getTime() - AGING_APPROVAL_HOURS * 3_600_000);
  const aging = await db
    .select({ id: agentActionsTable.id, actionType: agentActionsTable.actionType, title: agentActionsTable.title, agentKey: agentActionsTable.agentKey, createdAt: agentActionsTable.createdAt })
    .from(agentActionsTable)
    .where(and(eq(agentActionsTable.status, "pending"), lt(agentActionsTable.createdAt, cutoff)))
    .orderBy(asc(agentActionsTable.createdAt))
    .limit(200);
  if (aging.length === 0) return false;
  const [failed] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentRunsTable)
    .where(and(eq(agentRunsTable.status, "failed"), gte(agentRunsTable.startedAt, new Date(now.getTime() - DAY_MS))));
  const oldest = aging[0]!;
  await proposeAction({
    agentKey: "growth-digest",
    runId: null,
    actionType: "send_operator_nudge",
    title: `${aging.length} approval${aging.length === 1 ? "" : "s"} waiting more than ${AGING_APPROVAL_HOURS}h`,
    reasoning: `Oldest pending action #${oldest.id} (${oldest.actionType}) has waited ${Math.round((now.getTime() - oldest.createdAt.getTime()) / 3_600_000)} hours.`,
    params: {
      kind: "aging_approvals",
      pendingCount: aging.length,
      oldestHours: Math.round((now.getTime() - oldest.createdAt.getTime()) / 3_600_000),
      failedRuns24h: failed?.total ?? 0,
      items: aging.slice(0, 20).map((a) => ({
        id: a.id,
        actionType: a.actionType,
        title: a.title.slice(0, 200),
        agentKey: a.agentKey,
        ageHours: Math.round((now.getTime() - a.createdAt.getTime()) / 3_600_000),
      })),
    },
  });
  return true;
}
