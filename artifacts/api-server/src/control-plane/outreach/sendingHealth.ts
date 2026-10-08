import {
  db,
  agentActionsTable,
  agentTasksTable,
  controlOutreachEmailsTable,
} from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import { startOfUtcDay } from "../actionCounts.js";
import { getPolicy, getPolicyNumber, setPolicy } from "../policies.js";

/**
 * Deliverability guard: ONE pause switch for prospect outreach.
 *
 * State lives in two policy rows: `deliverability_guard` (status + reason)
 * and `max_prospect_emails_per_day` (the cap sender.ts actually enforces;
 * 0 when paused). Two writers feed it — the Resend webhook at event time
 * (vetting.md 6.2: first complaint, or >= 2 bounces at >= 4%) and the growth
 * loop's periodic rule R1 (growth-loop.md 9.2: warn / throttle / restore) —
 * and both go through the helpers here so there is never a second switch.
 * A paused guard is never auto-resumed; only an operator reset clears it.
 */

export type GuardStatus = "ok" | "warn" | "throttled" | "paused";

export interface GuardState {
  status: GuardStatus;
  since: string | null;
  reason: string | null;
  okDays: number;
}

export interface SendingHealth {
  windowDays: number;
  sent: number;
  bounced: number;
  complained: number;
  bounceRatePct: number;
}

export interface SendingState {
  guard: GuardState;
  dailyCap: { policyMax: number; sentToday: number };
  health: SendingHealth;
}

export const GUARD_POLICY_KEY = "deliverability_guard";
export const DAILY_CAP_POLICY_KEY = "max_prospect_emails_per_day";
export const BASE_DAILY_CAP_POLICY_KEY = "max_prospect_emails_per_day_base";
export const DEFAULT_BASE_DAILY_CAP = 15;
export const HEALTH_WINDOW_DAYS = 14;
/** Below this cap a throttled guard would starve warm-up entirely. */
export const MIN_THROTTLED_CAP = 5;
export const PAUSE_TASK_TITLE = "Outreach sending paused by the deliverability guard";

/** Both action types count toward the prospect cap so historical legacy sends still count. */
const PROSPECT_SEND_ACTION_TYPES = ["send_prospect_email", "send_outreach_email"] as const;

const GUARD_STATUSES: readonly GuardStatus[] = ["ok", "warn", "throttled", "paused"];

export const DEFAULT_GUARD: GuardState = { status: "ok", since: null, reason: null, okDays: 0 };

/** Coerce a raw policy value into a well-formed GuardState (defaults for anything odd). */
export function normalizeGuard(raw: unknown): GuardState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_GUARD };
  const value = raw as Record<string, unknown>;
  const status = GUARD_STATUSES.includes(value.status as GuardStatus) ? (value.status as GuardStatus) : "ok";
  const okDays = Number(value.okDays);
  return {
    status,
    since: typeof value.since === "string" && value.since ? value.since : null,
    reason: typeof value.reason === "string" && value.reason ? value.reason : null,
    okDays: Number.isFinite(okDays) && okDays >= 0 ? okDays : 0,
  };
}

/** getPolicy("deliverability_guard") with defaults. */
export async function loadGuard(): Promise<GuardState> {
  return normalizeGuard(await getPolicy(GUARD_POLICY_KEY));
}

/** Operator-set base cap the guard restores to. */
export async function baseDailyCap(): Promise<number> {
  return getPolicyNumber(BASE_DAILY_CAP_POLICY_KEY, "emails", DEFAULT_BASE_DAILY_CAP);
}

/** The cap sender.ts enforces right now (0 while paused). */
export async function effectiveDailyCap(): Promise<number> {
  return getPolicyNumber(DAILY_CAP_POLICY_KEY, "emails", DEFAULT_BASE_DAILY_CAP);
}

/**
 * Pure: the daily cap a guard state implies for a given base. paused -> 0,
 * throttled -> half the base (never below MIN_THROTTLED_CAP, never above the
 * base), warn/ok -> base. The guard may only lower the cap below the base.
 */
export function computeEffectiveCap(guard: Pick<GuardState, "status">, baseCap: number): number {
  const base = Math.max(0, Math.floor(baseCap));
  switch (guard.status) {
    case "paused":
      return 0;
    case "throttled":
      return Math.min(base, Math.max(MIN_THROTTLED_CAP, Math.floor(base / 2)));
    default:
      return base;
  }
}

/** Prospect emails sent today (UTC) via the governed send actions. */
export async function prospectSendsToday(now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActionsTable)
    .where(
      and(
        inArray(agentActionsTable.actionType, [...PROSPECT_SEND_ACTION_TYPES]),
        eq(agentActionsTable.status, "executed"),
        gte(agentActionsTable.executedAt, startOfUtcDay(now)),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Window math over control_outreach_emails (+ control_email_events for
 * provider events that arrived after the row's status moved on). An email
 * counts once however many events it has. Rates are percentages, rounded
 * to one decimal; 0 when nothing was sent.
 */
export async function computeSendingHealth(
  windowDays: number = HEALTH_WINDOW_DAYS,
  now: Date = new Date(),
): Promise<SendingHealth> {
  const days = Math.max(1, Math.floor(windowDays));
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const emails = controlOutreachEmailsTable;
  const bouncedEvent = sql`exists (select 1 from control_email_events ev where ev.email_id = ${emails.id} and ev.event_type = 'bounced')`;
  const complainedEvent = sql`exists (select 1 from control_email_events ev where ev.email_id = ${emails.id} and ev.event_type = 'complained')`;
  const [row] = await db
    .select({
      sent: sql<number>`count(*)::int`,
      bounced: sql<number>`count(*) filter (where ${emails.status} = 'bounced' or ${emails.bouncedAt} is not null or ${bouncedEvent})::int`,
      complained: sql<number>`count(*) filter (where ${emails.status} = 'complained' or ${complainedEvent})::int`,
    })
    .from(emails)
    .where(and(sql`${emails.sentAt} is not null`, gte(emails.sentAt, since)));
  const sent = row?.sent ?? 0;
  const bounced = row?.bounced ?? 0;
  const complained = row?.complained ?? 0;
  return {
    windowDays: days,
    sent,
    bounced,
    complained,
    bounceRatePct: sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
  };
}

/**
 * Pure event-time rule (vetting.md 6.2; research 1.7 / Resend AUP):
 * a single complaint pauses; bounces pause at >= 2 bounces and >= 4%.
 * Returns the operator-readable reason, or null when sending may continue.
 */
export function shouldPauseOnEvent(health: SendingHealth, trigger: "bounced" | "complained"): string | null {
  if (trigger === "complained") {
    if (health.complained >= 1) {
      return `${health.complained} spam complaint${health.complained === 1 ? "" : "s"} in ${health.windowDays} days (policy: pause at the first complaint)`;
    }
    return null;
  }
  if (health.bounced >= 2 && health.bounceRatePct >= 4) {
    return `bounce rate ${health.bounceRatePct.toFixed(1)}% (${health.bounced} of ${health.sent}) over ${health.windowDays} days (policy: pause at 4% with at least 2 bounces)`;
  }
  return null;
}

function actorType(actor: string): "system" | "operator" {
  return actor.startsWith("system:") ? "system" : "operator";
}

async function writeGuard(next: GuardState): Promise<GuardState> {
  const saved = await setPolicy(GUARD_POLICY_KEY, { ...next });
  return saved ? normalizeGuard(saved.value) : next;
}

async function ensurePauseTask(reason: string): Promise<void> {
  const [existing] = await db
    .select({ id: agentTasksTable.id })
    .from(agentTasksTable)
    .where(and(eq(agentTasksTable.title, PAUSE_TASK_TITLE), sql`${agentTasksTable.status} in ('open', 'in_progress')`))
    .limit(1);
  if (existing) return;
  await db.insert(agentTasksTable).values({
    agentKey: "governance",
    title: PAUSE_TASK_TITLE,
    detail: [
      `Prospect outreach is paused: ${reason}.`,
      "",
      "Remediation checklist:",
      "1. Check the Resend dashboard for the bounced/complained messages and their recipients.",
      "2. Review those emails in /control → Outreach (who was targeted, which list or research produced the address).",
      "3. Confirm list quality: vetting status, email published on the venue's own site, no role mailbox at a free-mail domain.",
      "4. Fix the cause (suppress the addresses, re-vet the segment, adjust the daily cap), then reset the guard in /control → Outreach.",
    ].join("\n"),
    category: "deliverability",
    priority: "critical",
  });
}

/**
 * Pause everything: guard -> paused, daily cap -> 0, audit, and a critical
 * governance task with the remediation checklist (deduplicated by title).
 */
export async function pauseGuard(reason: string, actor: string): Promise<GuardState> {
  const now = new Date().toISOString();
  const previous = await loadGuard();
  const next = await writeGuard({ status: "paused", since: now, reason, okDays: 0 });
  await setPolicy(DAILY_CAP_POLICY_KEY, { emails: 0 });
  await recordAuditEvent({
    actorType: actorType(actor),
    actor,
    eventType: "outreach_guard_paused",
    subjectType: "policy",
    subjectId: GUARD_POLICY_KEY,
    detail: { reason, previous, cap: 0 },
  });
  try {
    await ensurePauseTask(reason);
  } catch (err) {
    logger.error({ err }, "Deliverability guard: failed to raise the governance task");
  }
  return next;
}

/**
 * Operator-only: restore the base cap and clear the guard. Never called by
 * rules (R1 restores through setGuardStatus only from warn/throttled).
 */
export async function resetGuard(note: string, operatorEmail: string): Promise<GuardState> {
  const now = new Date().toISOString();
  const previous = await loadGuard();
  const base = await baseDailyCap();
  await setPolicy(DAILY_CAP_POLICY_KEY, { emails: base });
  const next = await writeGuard({ status: "ok", since: now, reason: null, okDays: 0 });
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "outreach_guard_reset",
    subjectType: "policy",
    subjectId: GUARD_POLICY_KEY,
    detail: { note, previous, cap: base },
  });
  return next;
}

/**
 * Rule-driven transitions other than pause/reset (warn, throttled, restore):
 * writes the guard row and, when `cap` is not null, max_prospect_emails_per_day
 * (clamped so the guard never raises the cap above the operator's base);
 * audits outreach_guard_changed. Never lowers a "paused" guard's state —
 * a paused guard is returned untouched; use resetGuard (operator) instead.
 * Passing `next.status === "paused"` delegates to pauseGuard so the task and
 * cap-0 bookkeeping always happen together.
 */
export async function setGuardStatus(next: GuardState, cap: number | null, actor: string): Promise<GuardState> {
  const current = await loadGuard();
  if (current.status === "paused") return current;
  if (next.status === "paused") {
    return pauseGuard(next.reason ?? "paused by rule", actor);
  }
  const base = await baseDailyCap();
  const normalized: GuardState = {
    status: next.status,
    since: next.since ?? new Date().toISOString(),
    reason: next.reason ?? null,
    okDays: Number.isFinite(next.okDays) && next.okDays >= 0 ? next.okDays : 0,
  };
  const saved = await writeGuard(normalized);
  let appliedCap: number | null = null;
  if (cap !== null) {
    appliedCap = Math.max(0, Math.min(Math.floor(cap), base));
    await setPolicy(DAILY_CAP_POLICY_KEY, { emails: appliedCap });
  }
  await recordAuditEvent({
    actorType: actorType(actor),
    actor,
    eventType: "outreach_guard_changed",
    subjectType: "policy",
    subjectId: GUARD_POLICY_KEY,
    detail: { previous: current, next: saved, cap: appliedCap, baseCap: base },
  });
  return saved;
}

/**
 * Event-time hook for the Resend webhook: recompute the 14-day window and
 * pause when the rule fires; a first bounce on an "ok" guard moves it to
 * "warn" so operators see it before the threshold. Never auto-resumes.
 */
export async function evaluateEventAndMaybePause(trigger: "bounced" | "complained", actor: string): Promise<GuardState> {
  const guard = await loadGuard();
  const health = await computeSendingHealth(HEALTH_WINDOW_DAYS);
  const reason = shouldPauseOnEvent(health, trigger);
  if (reason) {
    if (guard.status === "paused") return guard;
    return pauseGuard(reason, actor);
  }
  if (trigger === "bounced" && guard.status === "ok") {
    return setGuardStatus(
      {
        status: "warn",
        since: new Date().toISOString(),
        reason: `${health.bounced || 1} bounce${health.bounced === 1 || health.bounced === 0 ? "" : "s"} in ${health.windowDays} days`,
        okDays: 0,
      },
      null,
      actor,
    );
  }
  return guard;
}

/** Everything the /control Outreach tab shows: guard, enforced cap vs sends today, 14-day health. */
export async function getSendingState(now: Date = new Date()): Promise<SendingState> {
  const [guard, policyMax, sentToday, health] = await Promise.all([
    loadGuard(),
    effectiveDailyCap(),
    prospectSendsToday(now),
    computeSendingHealth(HEALTH_WINDOW_DAYS, now),
  ]);
  return { guard, dailyCap: { policyMax, sentToday }, health };
}
