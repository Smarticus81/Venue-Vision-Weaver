import { db, organizationsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { shareUrlForToken } from "../../lib/appUrl.js";
import { logger } from "../../lib/logger.js";
import { proposeAction } from "../actions.js";
import { recordAuditEvent } from "../audit.js";
import { nudgeDaysBeforeEnd, nudgeGalleryCount, trialDays } from "./config.js";
import { DAY_MS } from "./kpiMath.js";
import {
  LIFECYCLE_TEMPLATES,
  lifecycleTemplateTitle,
  type LifecycleContext,
  type LifecycleTemplate,
} from "./lifecycleEmails.js";
import { resolveLifecycleRecipient } from "./lifecycleRecipient.js";

/*
 * Trial clock sweep (growth-loop.md 7.4). Spending is blocked by time through
 * lib/trial.ts the moment trial_ends_at passes; this sweep only records the
 * fact (trial_expired_at) and proposes the fixed-template nudges as governed
 * low-risk send_lifecycle_email actions, which wait for operator approval
 * until the lifecycle_email_auto_send policy is flipped.
 */

export type { LifecycleTemplate };

export interface TrialOrgState {
  id: number;
  plan: string;
  createdAt: Date;
  trialEndsAt: Date | null;
  trialExpiredAt: Date | null;
  creditsBalance: number;
  readySessions: number;
  firstGalleryAt: Date | null;
  sentTemplates: LifecycleTemplate[];
}

export interface TrialTransition {
  organizationId: number;
  kind: "expire" | "nudge";
  template?: LifecycleTemplate;
}

export interface TrialClockConfig {
  nudgeGalleryCount: number;
  nudgeDaysBeforeEnd: number;
  trialDays?: number;
}

/**
 * Pure: which transitions are due now. Expiry first, then at most one nudge
 * per sweep per organization; already-sent templates never repeat.
 */
export function trialTransitions(org: TrialOrgState, now: Date, cfg: TrialClockConfig): TrialTransition[] {
  if (org.plan !== "trial") return [];
  const out: TrialTransition[] = [];
  const sent = new Set(org.sentTemplates);
  const endsAt = org.trialEndsAt ?? new Date(org.createdAt.getTime() + (cfg.trialDays ?? 14) * DAY_MS);
  const expired = endsAt.getTime() <= now.getTime();

  if (expired) {
    if (org.trialExpiredAt == null) out.push({ organizationId: org.id, kind: "expire" });
    if (!sent.has("trial_expired")) out.push({ organizationId: org.id, kind: "nudge", template: "trial_expired" });
    return out;
  }
  if (org.trialExpiredAt != null) return out; // bookkeeping says expired already (clock moved back); nothing to nudge

  if (org.creditsBalance <= 0 && !sent.has("trial_credits_out")) {
    out.push({ organizationId: org.id, kind: "nudge", template: "trial_credits_out" });
    return out;
  }
  if (org.readySessions >= cfg.nudgeGalleryCount && org.creditsBalance > 0 && !sent.has("trial_gallery_3")) {
    out.push({ organizationId: org.id, kind: "nudge", template: "trial_gallery_3" });
    return out;
  }
  const dayWindowStart = endsAt.getTime() - cfg.nudgeDaysBeforeEnd * DAY_MS;
  if (now.getTime() >= dayWindowStart && now.getTime() < endsAt.getTime() && !sent.has("trial_day_10")) {
    out.push({ organizationId: org.id, kind: "nudge", template: "trial_day_10" });
  }
  return out;
}

type TrialRow = {
  id: number;
  name: string;
  plan: string;
  created_at: unknown;
  trial_ends_at: unknown;
  trial_expired_at: unknown;
  credits_balance: unknown;
  ready_sessions: unknown;
  first_gallery_at: unknown;
  first_share_token: string | null;
  venue_name: string | null;
  sent_templates: unknown;
};

function toDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toTemplates(value: unknown): LifecycleTemplate[] {
  let list: unknown[] = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === "string") {
    // pg may hand back a text[] literal such as {a,b}
    list = value.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  }
  return list.filter((t): t is LifecycleTemplate => (LIFECYCLE_TEMPLATES as readonly string[]).includes(String(t)));
}

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybeRows = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybeRows) ? (maybeRows as T[]) : [];
}

interface LoadedTrialOrg extends TrialOrgState {
  name: string;
  venueName: string | null;
  firstShareToken: string | null;
}

/** Trial organizations with ready-session counts, first venue name and the lifecycle templates already proposed/sent. */
export async function loadTrialOrgs(): Promise<LoadedTrialOrg[]> {
  const result = await db.execute<TrialRow>(sql`
    with galleries as (
      select v.organization_id,
             count(*)::int as ready_sessions,
             min(cs.completed_at) as first_gallery_at,
             (array_agg(cs.share_token order by cs.completed_at))[1] as first_share_token
      from couple_sessions cs
      join venues v on v.id = cs.venue_id
      where cs.status = 'ready' and cs.completed_at is not null and cs.kind = 'couple' and v.organization_id is not null
      group by v.organization_id
    ), first_venue as (
      select distinct on (v.organization_id) v.organization_id, v.name as venue_name
      from venues v
      where v.organization_id is not null
      order by v.organization_id, v.created_at asc, v.id asc
    )
    select o.id, o.name, o.plan, o.created_at, o.trial_ends_at, o.trial_expired_at, o.credits_balance,
           coalesce(g.ready_sessions, 0)::int as ready_sessions, g.first_gallery_at, g.first_share_token, fv.venue_name,
           coalesce((
             select array_agg(distinct a.params->>'template')
             from agent_actions a
             where a.action_type = 'send_lifecycle_email'
               and a.params->>'organizationId' = o.id::text
               and (a.status in ('pending', 'approved', 'executing', 'executed')
                    or (a.status = 'failed' and a.created_at > now() - interval '24 hours'))
           ), '{}') as sent_templates
    from organizations o
    left join galleries g on g.organization_id = o.id
    left join first_venue fv on fv.organization_id = o.id
    where o.plan = 'trial'
    order by o.created_at asc
    limit 5000
  `);
  return rowsOf<TrialRow>(result).map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    plan: String(row.plan),
    createdAt: toDate(row.created_at) ?? new Date(0),
    trialEndsAt: toDate(row.trial_ends_at),
    trialExpiredAt: toDate(row.trial_expired_at),
    creditsBalance: Number(row.credits_balance) || 0,
    readySessions: Number(row.ready_sessions) || 0,
    firstGalleryAt: toDate(row.first_gallery_at),
    sentTemplates: toTemplates(row.sent_templates),
    venueName: row.venue_name ?? null,
    firstShareToken: row.first_share_token ?? null,
  }));
}

const skippedNoRecipient = new Set<string>();
const HOUR_MS = 3_600_000;
let lastRunAt = 0;

export interface TrialClockResult {
  expired: number;
  nudgesProposed: number;
  skipped: number;
}

/** Full sweep (no hourly gate). */
export async function sweepTrialClock(now: Date = new Date()): Promise<TrialClockResult> {
  const cfg: TrialClockConfig = { nudgeGalleryCount: nudgeGalleryCount(), nudgeDaysBeforeEnd: nudgeDaysBeforeEnd(), trialDays: trialDays() };
  const orgs = await loadTrialOrgs();
  const result: TrialClockResult = { expired: 0, nudgesProposed: 0, skipped: 0 };

  for (const org of orgs) {
    const transitions = trialTransitions(org, now, cfg);
    for (const transition of transitions) {
      try {
        if (transition.kind === "expire") {
          const updated = await db
            .update(organizationsTable)
            .set({ trialExpiredAt: now })
            .where(and(eq(organizationsTable.id, org.id), eq(organizationsTable.plan, "trial"), isNull(organizationsTable.trialExpiredAt)))
            .returning({ id: organizationsTable.id });
          if (updated.length > 0) {
            result.expired += 1;
            await recordAuditEvent({
              actorType: "system",
              actor: "growth-trial-clock",
              eventType: "trial_expired",
              subjectType: "organization",
              subjectId: org.id,
              detail: { trialEndsAt: org.trialEndsAt?.toISOString() ?? null, creditsBalance: org.creditsBalance, readySessions: org.readySessions },
            });
          }
          continue;
        }

        const template = transition.template!;
        const recipient = await resolveLifecycleRecipient(org.id);
        if (!recipient) {
          const key = `${org.id}:${template}`;
          if (!skippedNoRecipient.has(key)) {
            skippedNoRecipient.add(key);
            await recordAuditEvent({
              actorType: "system",
              actor: "growth-trial-clock",
              eventType: "lifecycle_skipped_no_recipient",
              subjectType: "organization",
              subjectId: org.id,
              detail: { template },
            });
          }
          result.skipped += 1;
          continue;
        }

        const context: LifecycleContext = {
          orgName: org.name,
          venueName: org.venueName,
          creditsBalance: Math.max(0, org.creditsBalance),
          trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
          galleriesReady: org.readySessions,
          firstGalleryShareUrl: org.firstShareToken ? shareUrlForToken(org.firstShareToken) : null,
        };
        await proposeAction({
          agentKey: "growth-lifecycle",
          runId: null,
          actionType: "send_lifecycle_email",
          title: `${lifecycleTemplateTitle(template)}: ${org.name}`,
          reasoning: describeTrigger(template, org, now),
          params: { organizationId: org.id, template, context },
        });
        result.nudgesProposed += 1;
      } catch (err) {
        logger.error({ err, organizationId: org.id, transition }, "Trial clock transition failed");
      }
    }
  }
  if (result.expired > 0 || result.nudgesProposed > 0) {
    logger.info(result, "Trial clock sweep applied transitions");
  }
  return result;
}

function describeTrigger(template: LifecycleTemplate, org: LoadedTrialOrg, now: Date): string {
  const endsAt = org.trialEndsAt ? org.trialEndsAt.toISOString().slice(0, 10) : "unknown";
  switch (template) {
    case "trial_gallery_3":
      return `${org.readySessions} ready galleries, ${org.creditsBalance} credits left, trial ends ${endsAt}.`;
    case "trial_day_10": {
      const daysLeft = org.trialEndsAt ? Math.max(0, Math.ceil((org.trialEndsAt.getTime() - now.getTime()) / DAY_MS)) : null;
      return `${daysLeft ?? "?"} days left on the trial (ends ${endsAt}), ${org.readySessions} galleries made, ${org.creditsBalance} credits left.`;
    }
    case "trial_credits_out":
      return `Credit balance is ${org.creditsBalance} with ${org.readySessions} galleries made; trial ends ${endsAt}.`;
    case "trial_expired":
      return `Trial ended ${endsAt}; ${org.readySessions} galleries made, ${org.creditsBalance} credits still on the balance.`;
  }
}

/** Scheduler entry: runs the sweep at most once per hour. */
export async function runTrialClock(now: Date = new Date()): Promise<TrialClockResult | null> {
  if (now.getTime() - lastRunAt < HOUR_MS) return null;
  lastRunAt = now.getTime();
  return sweepTrialClock(now);
}

/** Test seam. */
export function resetTrialClock(): void {
  lastRunAt = 0;
  skippedNoRecipient.clear();
}
