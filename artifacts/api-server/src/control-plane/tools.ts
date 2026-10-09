import {
  db,
  venuesTable,
  coupleSessionsTable,
  creditTransactionsTable,
  agentTasksTable,
  agentActionsTable,
  agentRunsTable,
  controlAuditEventsTable,
  controlProspectsTable,
  controlCampaignsTable,
  AGENT_TASK_PRIORITIES,
  PROSPECT_STATUSES,
  PROSPECT_SOURCES,
  VETTING_STATUSES,
} from "@workspace/db";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { computeBusinessMetrics } from "./metrics.js";
import { ACTION_CATALOG, describeActionCatalog, proposableActionTypes, proposeAction } from "./actions.js";
import { getPolicyNumber, listPolicies } from "./policies.js";
import { recordAuditEvent } from "./audit.js";
import type { ToolDeclaration } from "./grok.js";
import { createDraft, ensureResearch, loadProspectAssets, loadProspectById, loadResearch } from "./outreach/studio.js";
import { publicObjectUrl } from "./outreach/config.js";
import { daysAgo, num, str, type ControlPlaneTool, type ToolContext } from "./toolTypes.js";
import { vettingTools } from "./vetting/tools.js";
import { ensureVetted, loadVetting, vettingIsFresh } from "./vetting/vet.js";
import { citableFacts, isHttpUrl, loadFacts, upsertFacts } from "./vetting/facts.js";
import type { DiscoveredFact, FactKind } from "./vetting/types.js";
import { getAgentDefinition } from "./agents.js";
import { growthTools } from "./growth/tools.js";
import { listOrganizationsQuery, listVenuesQuery } from "./growth/queries.js";
import { classifyVenueType } from "./growth/segments.js";

export type { ControlPlaneTool, ToolContext } from "./toolTypes.js";

/** Fact kinds an agent may cite when saving a prospect (vetting.md 3.1). */
const AGENT_FACT_KINDS: ReadonlySet<string> = new Set(["space", "location", "capacity", "style", "owner_name", "marketplace", "social"]);

/**
 * Pure: the sourced, unverified facts an upsert_prospect call records (email,
 * owner name, and the optional facts array), plus the entries refused with a
 * reason. Vetting and research later verify them or leave them unverified.
 */
export function agentFacts(input: {
  email: string;
  emailSourceUrl: string | null;
  contactName: string | null;
  contactNameSourceUrl: string | null;
  facts: unknown;
}): { facts: DiscoveredFact[]; rejectedFacts: Array<{ kind: unknown; value: unknown; reason: string }> } {
  const facts: DiscoveredFact[] = [];
  const rejectedFacts: Array<{ kind: unknown; value: unknown; reason: string }> = [];
  if (input.emailSourceUrl && isHttpUrl(input.emailSourceUrl)) {
    facts.push({ kind: "email", value: input.email, sourceUrl: input.emailSourceUrl.trim(), sourceKind: "agent_research", status: "unverified" });
  }
  if (input.contactName && input.contactNameSourceUrl && isHttpUrl(input.contactNameSourceUrl)) {
    facts.push({
      kind: "owner_name",
      value: input.contactName,
      sourceUrl: input.contactNameSourceUrl.trim(),
      sourceKind: "agent_research",
      status: "unverified",
    });
  }
  const entries = Array.isArray(input.facts) ? input.facts : [];
  for (const entry of entries.slice(0, 30)) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const kind = record.kind;
    const value = typeof record.value === "string" ? record.value.replace(/\s+/g, " ").trim() : "";
    if (typeof kind !== "string" || !AGENT_FACT_KINDS.has(kind)) {
      rejectedFacts.push({ kind, value: record.value, reason: `kind must be one of ${[...AGENT_FACT_KINDS].join(", ")}` });
      continue;
    }
    if (value.length < 2 || value.length > 160) {
      rejectedFacts.push({ kind, value: record.value, reason: "value must be 2-160 characters" });
      continue;
    }
    if (!isHttpUrl(record.sourceUrl)) {
      rejectedFacts.push({ kind, value, reason: "sourceUrl must be the http(s) page where the fact appears" });
      continue;
    }
    facts.push({ kind: kind as FactKind, value, sourceUrl: (record.sourceUrl as string).trim(), sourceKind: "agent_research", status: "unverified" });
  }
  return { facts, rejectedFacts };
}

/**
 * Core tools every agent registry builds on. Vetting (vetting/tools.ts) and
 * growth (growth/tools.ts) own their own records; TOOLS below merges all three.
 */
const CORE_TOOLS: Record<string, ControlPlaneTool> = {
  get_business_metrics: {
    declaration: {
      name: "get_business_metrics",
      description:
        "Live business KPIs computed from production tables: organizations, venues, sessions, credits, activation, failure rates.",
      parameters: { type: "object", properties: {} },
    },
    execute: () => computeBusinessMetrics(),
  },

  list_venues: {
    declaration: {
      name: "list_venues",
      description:
        "List venues with organization plan/credits, media count, and session counts. Sort by newest or least_active to find activation and sales targets.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
          sort: { type: "string", enum: ["newest", "least_active"], description: "Sort order." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      const rows = await listVenuesQuery(limit, args.sort === "least_active" ? "least_active" : "newest");
      return { venues: rows };
    },
  },

  list_organizations: {
    declaration: {
      name: "list_organizations",
      description:
        "List billing organizations with plan, credit balance, venue count, and last session date. Use to find upsell, churn-risk, and low-credit accounts.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      return { organizations: await listOrganizationsQuery(limit) };
    },
  },

  list_recent_sessions: {
    declaration: {
      name: "list_recent_sessions",
      description:
        "Recent couple sessions with venue name, status, error message, and timings. Filter by status (pending, processing, ready, failed) to find stuck or failed work.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional status filter." },
          days: { type: "integer", description: "Lookback window in days (default 14, max 90)." },
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      const days = num(args.days, 14, 90);
      const status = str(args.status);
      const conditions = [gte(coupleSessionsTable.createdAt, daysAgo(days))];
      if (status) conditions.push(eq(coupleSessionsTable.status, status));
      const rows = await db
        .select({
          id: coupleSessionsTable.id,
          venueId: coupleSessionsTable.venueId,
          venueName: venuesTable.name,
          venueSlug: venuesTable.slug,
          status: coupleSessionsTable.status,
          errorMessage: coupleSessionsTable.errorMessage,
          coupleName: coupleSessionsTable.coupleName,
          creditsCharged: coupleSessionsTable.creditsCharged,
          createdAt: coupleSessionsTable.createdAt,
          completedAt: coupleSessionsTable.completedAt,
        })
        .from(coupleSessionsTable)
        .leftJoin(venuesTable, eq(coupleSessionsTable.venueId, venuesTable.id))
        .where(and(...conditions))
        .orderBy(desc(coupleSessionsTable.createdAt))
        .limit(limit);
      return { sessions: rows };
    },
  },

  get_credit_ledger: {
    declaration: {
      name: "get_credit_ledger",
      description:
        "Recent credit ledger rows plus per-reason totals over a window. This is the financial source of truth (grants, purchases, session debits, refunds).",
      parameters: {
        type: "object",
        properties: {
          days: { type: "integer", description: "Lookback window in days (default 30, max 180)." },
          limit: { type: "integer", description: "Max ledger rows (default 40, max 100)." },
        },
      },
    },
    async execute(args) {
      const days = num(args.days, 30, 180);
      const limit = num(args.limit, 40, 100);
      const since = daysAgo(days);
      const [rows, totals] = await Promise.all([
        db
          .select({
            id: creditTransactionsTable.id,
            organizationId: creditTransactionsTable.organizationId,
            venueId: creditTransactionsTable.venueId,
            sessionId: creditTransactionsTable.sessionId,
            delta: creditTransactionsTable.delta,
            reason: creditTransactionsTable.reason,
            createdAt: creditTransactionsTable.createdAt,
          })
          .from(creditTransactionsTable)
          .where(gte(creditTransactionsTable.createdAt, since))
          .orderBy(desc(creditTransactionsTable.createdAt))
          .limit(limit),
        db
          .select({
            reason: creditTransactionsTable.reason,
            total: sql<number>`coalesce(sum(${creditTransactionsTable.delta}), 0)::int`,
            rows: sql<number>`count(*)::int`,
          })
          .from(creditTransactionsTable)
          .where(gte(creditTransactionsTable.createdAt, since))
          .groupBy(creditTransactionsTable.reason),
      ]);
      return { windowDays: days, totalsByReason: totals, transactions: rows };
    },
  },

  list_open_tasks: {
    declaration: {
      name: "list_open_tasks",
      description:
        "Open and in-progress control-plane tasks across all agents. Check before creating a task to avoid duplicates.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 30, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 30, 100);
      const rows = await db
        .select()
        .from(agentTasksTable)
        .where(sql`${agentTasksTable.status} in ('open', 'in_progress')`)
        .orderBy(desc(agentTasksTable.createdAt))
        .limit(limit);
      return { tasks: rows };
    },
  },

  list_recent_actions: {
    declaration: {
      name: "list_recent_actions",
      description:
        "Recent governed actions (pending, approved, rejected, executed, failed) across all agents, with params and results.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 30, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 30, 100);
      const rows = await db
        .select()
        .from(agentActionsTable)
        .orderBy(desc(agentActionsTable.createdAt))
        .limit(limit);
      return { actionCatalog: describeActionCatalog(), actions: rows };
    },
  },

  list_recent_runs: {
    declaration: {
      name: "list_recent_runs",
      description:
        "Recent agent runs across the control plane with status, summary, and tool-call counts. Use to review what other agents did.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 20, max 50)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 20, 50);
      const rows = await db
        .select({
          id: agentRunsTable.id,
          agentKey: agentRunsTable.agentKey,
          trigger: agentRunsTable.trigger,
          status: agentRunsTable.status,
          summary: agentRunsTable.summary,
          error: agentRunsTable.error,
          toolCallCount: agentRunsTable.toolCallCount,
          startedAt: agentRunsTable.startedAt,
          finishedAt: agentRunsTable.finishedAt,
        })
        .from(agentRunsTable)
        .orderBy(desc(agentRunsTable.startedAt))
        .limit(limit);
      return { runs: rows };
    },
  },

  get_audit_log: {
    declaration: {
      name: "get_audit_log",
      description:
        "Immutable audit trail of agent, operator, and system events (proposals, approvals, executions, policy changes).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 40, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 40, 100);
      const rows = await db
        .select()
        .from(controlAuditEventsTable)
        .orderBy(desc(controlAuditEventsTable.createdAt))
        .limit(limit);
      return { events: rows };
    },
  },

  get_policies: {
    declaration: {
      name: "get_policies",
      description: "Current governance policies (spend caps, email caps, auto-execution flags).",
      parameters: { type: "object", properties: {} },
    },
    async execute() {
      return { policies: await listPolicies() };
    },
  },

  list_prospects: {
    declaration: {
      name: "list_prospects",
      description:
        "Prospect pipeline rows (potential venue customers) with score, status, campaign membership, and contact history, plus summary.byVettingStatus over the whole pipeline. Set dueFollowUp=true to get contacted prospects who are past the minimum contact gap, under the lifetime contact cap, and have not replied or opted out. Rows carry vettingStatus (unvetted/passed/review/failed/error) and legitimacyScore; only vettingStatus=passed prospects can be drafted for.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: [...PROSPECT_STATUSES],
            description: "Optional status filter.",
          },
          vettingStatus: { type: "string", enum: [...VETTING_STATUSES], description: "Optional legitimacy vetting filter." },
          campaignId: { type: "integer", description: "Only prospects enrolled in this campaign." },
          dueFollowUp: {
            type: "boolean",
            description: "Only prospects eligible for a follow-up email right now.",
          },
          limit: { type: "integer", description: "Max rows (default 25, max 100)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 25, 100);
      const status = str(args.status);
      const campaignId = Number(args.campaignId);
      const conditions = [];
      if (status && PROSPECT_STATUSES.includes(status as (typeof PROSPECT_STATUSES)[number])) {
        conditions.push(eq(controlProspectsTable.status, status));
      }
      if (Number.isInteger(campaignId) && campaignId > 0) {
        conditions.push(eq(controlProspectsTable.campaignId, campaignId));
      }
      const vettingStatus = str(args.vettingStatus);
      if (vettingStatus && VETTING_STATUSES.includes(vettingStatus as (typeof VETTING_STATUSES)[number])) {
        conditions.push(eq(controlProspectsTable.vettingStatus, vettingStatus));
      }
      if (args.dueFollowUp === true) {
        const minGapHours = await getPolicyNumber("min_hours_between_prospect_contacts", "hours", 72);
        const maxContacts = await getPolicyNumber("max_contacts_per_prospect", "contacts", 3);
        conditions.push(
          eq(controlProspectsTable.status, "contacted"),
          lt(controlProspectsTable.contactCount, maxContacts),
          sql`${controlProspectsTable.lastContactedAt} < now() - (${minGapHours} * interval '1 hour')`,
        );
      }
      const rows = await db
        .select()
        .from(controlProspectsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(controlProspectsTable.score), desc(controlProspectsTable.updatedAt))
        .limit(limit);
      const byVetting = await db
        .select({ vettingStatus: controlProspectsTable.vettingStatus, total: sql<number>`count(*)::int` })
        .from(controlProspectsTable)
        .groupBy(controlProspectsTable.vettingStatus);
      return {
        prospects: rows,
        summary: { byVettingStatus: Object.fromEntries(byVetting.map((row) => [row.vettingStatus, row.total])) },
      };
    },
  },

  upsert_prospect: {
    declaration: {
      name: "upsert_prospect",
      description:
        "Create or update a prospect record (deduplicated by email). Only verifiable businesses with a publicly listed email belong here, and every address and name needs the URL it was found at (emailSourceUrl, contactNameSourceUrl). Saving runs legitimacy vetting automatically (site reachable, domain age, mail records, address/phone on site, marketplace presence, optional Google listing); a prospect that fails is disqualified and one that needs review stays 'new' regardless of the status you pass. Agents may set status new, qualified, or disqualified; contacted/replied/converted/unsubscribed are managed by the send action and operators and cannot be changed here.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string", description: "Public contact email; the dedupe key." },
          name: { type: "string", description: "Venue / business name." },
          contactName: { type: "string", description: "Person to address, if their name is published." },
          phone: { type: "string" },
          website: { type: "string" },
          region: { type: "string", description: "City/region, e.g. 'Austin, TX'." },
          source: { type: "string", enum: [...PROSPECT_SOURCES] },
          score: { type: "integer", description: "Fit score 0-100." },
          qualification: {
            type: "string",
            description: "Why they fit (or not), with the source of every claim.",
          },
          status: { type: "string", enum: ["new", "qualified", "disqualified"] },
          emailSourceUrl: {
            type: "string",
            description:
              "Exact page URL where this email address is published (the venue's own site preferred). Required when creating a prospect.",
          },
          contactNameSourceUrl: {
            type: "string",
            description: "Exact page URL where the contact's name and role are published. Required whenever contactName is given.",
          },
          facts: {
            type: "array",
            description:
              "Optional additional facts with sources, e.g. [{kind:'space', value:'The Timber Barn', sourceUrl:'https://.../spaces'}]. Allowed kinds: space, location, capacity, style, owner_name, marketplace, social.",
            items: {
              type: "object",
              properties: { kind: { type: "string" }, value: { type: "string" }, sourceUrl: { type: "string" } },
              required: ["kind", "value", "sourceUrl"],
            },
          },
        },
        required: ["email", "name"],
      },
    },
    async execute(args, ctx) {
      const email = str(args.email)?.toLowerCase() ?? null;
      if (!email) throw new Error("email is required.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        throw new Error(`"${email}" is not a valid email address.`);
      }

      const [existingVenue] = await db
        .select({ slug: venuesTable.slug })
        .from(venuesTable)
        .where(sql`lower(${venuesTable.ownerEmail}) = ${email}`)
        .limit(1);
      if (existingVenue) {
        return {
          saved: false,
          reason: "already_customer",
          detail: `This email owns venue "${existingVenue.slug}". Existing customers are not prospects.`,
        };
      }

      const [existing] = await db
        .select()
        .from(controlProspectsTable)
        .where(eq(controlProspectsTable.email, email));

      // Name falls back to the stored one so a partial update never blanks it.
      const name = str(args.name) ?? existing?.name ?? null;
      if (!name) throw new Error("name is required.");
      const contactName = str(args.contactName);
      const emailSourceUrl = str(args.emailSourceUrl);
      const contactNameSourceUrl = str(args.contactNameSourceUrl);
      if (!existing && !isHttpUrl(emailSourceUrl)) {
        throw new Error(`emailSourceUrl is required: cite the page where ${email} is published.`);
      }
      if (emailSourceUrl && !isHttpUrl(emailSourceUrl)) throw new Error("emailSourceUrl must be an http(s) URL.");
      if (contactName && !isHttpUrl(contactNameSourceUrl)) {
        throw new Error("contactNameSourceUrl is required when contactName is given.");
      }

      const statusRaw = str(args.status);
      const requestedStatus =
        statusRaw && ["new", "qualified", "disqualified"].includes(statusRaw) ? statusRaw : null;
      const sourceRaw = str(args.source);
      const source =
        sourceRaw && PROSPECT_SOURCES.includes(sourceRaw as (typeof PROSPECT_SOURCES)[number])
          ? sourceRaw
          : "agent_research";
      const scoreRaw = Number(args.score);
      const score =
        Number.isFinite(scoreRaw) && scoreRaw >= 0 ? Math.min(Math.floor(scoreRaw), 100) : null;
      const qualification = str(args.qualification);

      let saved: typeof controlProspectsTable.$inferSelect;
      let created = false;
      let statusLocked = false;
      let websiteChanged = false;
      if (existing) {
        const lockedStatuses = ["contacted", "replied", "converted", "unsubscribed"];
        statusLocked = lockedStatuses.includes(existing.status);
        const nextQualification = qualification ?? existing.qualification;
        const segmentChanged = name !== existing.name || nextQualification !== existing.qualification;
        const website = str(args.website) ?? existing.website;
        websiteChanged = website !== existing.website;
        const nextStatus = statusLocked ? existing.status : (requestedStatus ?? existing.status);
        const [updated] = await db
          .update(controlProspectsTable)
          .set({
            name,
            contactName: contactName ?? existing.contactName,
            phone: str(args.phone) ?? existing.phone,
            website,
            region: str(args.region) ?? existing.region,
            score: score ?? existing.score,
            qualification: nextQualification,
            status: nextStatus,
            ...(nextStatus !== existing.status ? { statusChangedBy: ctx.agentKey } : {}),
            ...(segmentChanged || !existing.venueType
              ? { venueType: classifyVenueType({ name, qualification: nextQualification }) }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(controlProspectsTable.id, existing.id))
          .returning();
        if (!updated) throw new Error(`Prospect ${existing.id} vanished during update.`);
        saved = updated;
        await recordAuditEvent({
          actorType: "agent",
          actor: ctx.agentKey,
          eventType: "prospect_updated",
          subjectType: "prospect",
          subjectId: existing.id,
          detail: { email, score: score ?? existing.score, statusLocked, websiteChanged },
        });
      } else {
        const [prospect] = await db
          .insert(controlProspectsTable)
          .values({
            name,
            contactName,
            email,
            phone: str(args.phone),
            website: str(args.website),
            region: str(args.region),
            source,
            score: score ?? 0,
            qualification,
            status: requestedStatus ?? "new",
            venueType: classifyVenueType({ name, qualification }),
            createdByAgent: ctx.agentKey,
          })
          .returning();
        if (!prospect) throw new Error("Failed to persist prospect.");
        saved = prospect;
        created = true;
        await recordAuditEvent({
          actorType: "agent",
          actor: ctx.agentKey,
          eventType: "prospect_created",
          subjectType: "prospect",
          subjectId: prospect.id,
          detail: { email, name, score: score ?? 0 },
        });
      }

      // Facts with sources, written before vetting (which reads the cited URLs).
      const { facts, rejectedFacts } = agentFacts({
        email,
        emailSourceUrl,
        contactName,
        contactNameSourceUrl,
        facts: args.facts,
      });
      await upsertFacts(saved.id, facts, ctx.agentKey);

      const existingVetting = created ? null : await loadVetting(saved.id);
      const needsVetting = created || !existingVetting || !vettingIsFresh(existingVetting) || websiteChanged;
      const vetting = needsVetting
        ? (await ensureVetted(saved, { force: true, requestedBy: ctx.agentKey })).vetting
        : existingVetting;

      // ensureVetted demotes failed/review prospects; an agent may also never
      // leave a prospect qualified before vetting has passed.
      let fresh = (await loadProspectById(saved.id)) ?? saved;
      if (fresh.status === "qualified" && fresh.vettingStatus !== "passed") {
        const [demoted] = await db
          .update(controlProspectsTable)
          .set({ status: "new", statusChangedBy: "system:vetting", updatedAt: new Date() })
          .where(and(eq(controlProspectsTable.id, saved.id), eq(controlProspectsTable.status, "qualified")))
          .returning();
        if (demoted) fresh = demoted;
      }
      return {
        saved: true,
        created,
        statusLocked,
        prospect: fresh,
        vetting: vetting
          ? { status: vetting.status, score: vetting.score, hardFails: vetting.hardFails, summary: vetting.summary }
          : null,
        statusApplied: fresh.status,
        statusOverridden: requestedStatus != null && fresh.status !== requestedStatus,
        rejectedFacts,
        note:
          fresh.vettingStatus === "passed"
            ? undefined
            : "This prospect is not eligible for outreach until vetting passes. Do not try to qualify it again without new evidence.",
      };
    },
  },

  list_campaigns: {
    declaration: {
      name: "list_campaigns",
      description:
        "Outreach campaigns with their sequence steps, status, and per-status prospect counts (enrolled, contacted, replied, converted, unsubscribed).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 20, max 50)." },
        },
      },
    },
    async execute(args) {
      const limit = num(args.limit, 20, 50);
      const campaigns = await db
        .select()
        .from(controlCampaignsTable)
        .orderBy(desc(controlCampaignsTable.createdAt))
        .limit(limit);
      const counts = await db
        .select({
          campaignId: controlProspectsTable.campaignId,
          status: controlProspectsTable.status,
          total: sql<number>`count(*)::int`,
        })
        .from(controlProspectsTable)
        .where(sql`${controlProspectsTable.campaignId} is not null`)
        .groupBy(controlProspectsTable.campaignId, controlProspectsTable.status);
      return {
        campaigns: campaigns.map((campaign) => ({
          ...campaign,
          prospectCounts: Object.fromEntries(
            counts
              .filter((row) => row.campaignId === campaign.id)
              .map((row) => [row.status, row.total]),
          ),
        })),
      };
    },
  },

  create_campaign: {
    declaration: {
      name: "create_campaign",
      description:
        "Design a multi-step outreach campaign (created as draft; contacts nobody). Steps define the sequence: wait time and drafting guidance per touch. Launching it later is a governed high-risk action.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short unique campaign name." },
          objective: {
            type: "string",
            description: "What the campaign should achieve and how success is measured.",
          },
          audience: { type: "string", description: "Who qualifies for enrollment." },
          steps: {
            type: "array",
            description:
              "Ordered sequence of 1-3 touches; the max_campaign_steps policy is enforced: [{waitDays, guidance}]. waitDays is the gap after the previous touch (0 for the first).",
            items: {
              type: "object",
              properties: {
                waitDays: { type: "integer", description: "Days after the previous touch." },
                guidance: {
                  type: "string",
                  description: "What this touch should say and what it asks for.",
                },
              },
              required: ["waitDays", "guidance"],
            },
          },
        },
        required: ["name", "objective", "steps"],
      },
    },
    async execute(args, ctx) {
      const name = str(args.name);
      const objective = str(args.objective);
      if (!name || !objective) throw new Error("name and objective are required.");
      const maxSteps = await getPolicyNumber("max_campaign_steps", "steps", 3);
      const stepsRaw = Array.isArray(args.steps) ? args.steps : [];
      const steps = stepsRaw
        .filter(
          (step): step is Record<string, unknown> =>
            Boolean(step) && typeof step === "object" && !Array.isArray(step),
        )
        .slice(0, Math.max(1, maxSteps))
        .map((step, index) => ({
          step: index + 1,
          waitDays: Math.max(0, Math.min(Math.floor(Number(step.waitDays) || 0), 60)),
          guidance: str(step.guidance) ?? "",
        }));
      if (steps.length === 0 || steps.some((step) => !step.guidance)) {
        throw new Error(`steps must contain 1-${maxSteps} entries, each with guidance text.`);
      }

      const [duplicate] = await db
        .select({ id: controlCampaignsTable.id })
        .from(controlCampaignsTable)
        .where(
          and(
            eq(controlCampaignsTable.name, name),
            sql`${controlCampaignsTable.status} in ('draft', 'active', 'paused')`,
          ),
        )
        .limit(1);
      if (duplicate) {
        return { created: false, reason: "duplicate_campaign", existingCampaignId: duplicate.id };
      }

      const [campaign] = await db
        .insert(controlCampaignsTable)
        .values({
          name,
          objective,
          audience: str(args.audience),
          steps,
          createdByAgent: ctx.agentKey,
        })
        .returning();
      await recordAuditEvent({
        actorType: "agent",
        actor: ctx.agentKey,
        eventType: "campaign_created",
        subjectType: "campaign",
        subjectId: campaign?.id,
        detail: { name, steps: steps.length },
      });
      return { created: true, campaign };
    },
  },

  get_prospect_research: {
    declaration: {
      name: "get_prospect_research",
      description:
        "What the outreach studio knows about a prospect's venue from its own public website: grounded facts (name, location, named spaces, style, capacity), the pages consulted, warnings, and the venue photos saved with their source URLs. Set refresh=true to re-fetch the site (slow; only when the saved research is missing or stale).",
      parameters: {
        type: "object",
        properties: {
          prospectId: { type: "integer" },
          refresh: { type: "boolean", description: "Re-run the website research now." },
        },
        required: ["prospectId"],
      },
    },
    async execute(args, ctx) {
      const prospectId = num(args.prospectId, 0, Number.MAX_SAFE_INTEGER);
      if (!prospectId) throw new Error("prospectId is required.");
      const prospect = await loadProspectById(prospectId);
      if (!prospect) throw new Error(`Prospect ${prospectId} not found.`);
      if (args.refresh === true) {
        const refreshed = await ensureResearch(prospect, { force: true, actor: ctx.agentKey });
        const [vetting, facts] = await Promise.all([loadVetting(prospectId), loadFacts(prospectId)]);
        return {
          research: refreshed.research,
          images: refreshed.assets.map((asset) => ({ ...asset, url: publicObjectUrl(asset.objectKey) })),
          vetting,
          facts,
          citable: citableFacts(facts),
        };
      }
      const [research, assets, vetting, facts] = await Promise.all([
        loadResearch(prospectId),
        loadProspectAssets(prospectId),
        loadVetting(prospectId),
        loadFacts(prospectId),
      ]);
      return {
        research,
        images: assets.map((asset) => ({ ...asset, url: publicObjectUrl(asset.objectKey) })),
        vetting,
        facts,
        citable: citableFacts(facts),
        hint: research ? undefined : "No research yet; draft_outreach_email runs it automatically.",
      };
    },
  },

  draft_outreach_email: {
    declaration: {
      name: "draft_outreach_email",
      description:
        "Produce a studio outreach email for one prospect and queue it for operator approval. Requires vettingStatus=passed and at least two verified venue facts. Researches the venue's own website (facts + real photos), writes a short personal note in plain words that cites at least two verified facts and makes one ask, adds a tracked claim link, and proposes the governed send_outreach_email action. Nothing is sent until an operator approves it in /control. Fails for prospects who replied, converted, unsubscribed, bounced, are disqualified, are not vetted, already have a pending email, or are inside the contact gap.",
      parameters: {
        type: "object",
        properties: {
          prospectId: { type: "integer" },
          ask: {
            type: "string",
            enum: ["preview", "call"],
            description: "The one ask: a free preview for their venue (default for first touch) or a short call (default for follow-ups).",
          },
          campaignId: { type: "integer", description: "Campaign this touch belongs to, if any." },
          step: { type: "integer", description: "Campaign step number (1-based) this touch fulfils." },
        },
        required: ["prospectId"],
      },
    },
    async execute(args, ctx) {
      const prospectId = num(args.prospectId, 0, Number.MAX_SAFE_INTEGER);
      if (!prospectId) throw new Error("prospectId is required.");
      const askRaw = str(args.ask);
      const campaignId = num(args.campaignId, 0, Number.MAX_SAFE_INTEGER) || null;
      const step = num(args.step, 0, 10) || null;
      const result = await createDraft({
        prospectId,
        ask: askRaw === "call" || askRaw === "preview" ? askRaw : undefined,
        campaignId,
        step,
        agentKey: ctx.agentKey,
        runId: ctx.runId,
        actor: ctx.agentKey,
      });
      return {
        emailId: result.email.id,
        actionId: result.actionId,
        actionStatus: result.actionStatus,
        subjectOptions: result.email.subjectOptions,
        body: result.email.body,
        images: result.email.imageAssetIds.length,
        copy: result.copy,
        warnings: result.warnings,
        citedFacts: result.email.citedFacts,
        note: "Queued for operator review in /control → Outreach. send_prospect_email is retired; never propose it.",
      };
    },
  },

  create_task: {
    declaration: {
      name: "create_task",
      description:
        "Raise a work item for the operator team (or a future agent run). Duplicate open titles are rejected, so check list_open_tasks first.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short imperative title." },
          detail: {
            type: "string",
            description: "Full context: evidence, affected entities, and the recommended fix.",
          },
          category: {
            type: "string",
            description: "Free-form category, e.g. sales, prospecting, support, engineering, finance.",
          },
          priority: { type: "string", enum: [...AGENT_TASK_PRIORITIES] },
        },
        required: ["title", "detail", "priority"],
      },
    },
    async execute(args, ctx) {
      const title = str(args.title);
      const detail = str(args.detail);
      const priorityRaw = str(args.priority);
      const priority = AGENT_TASK_PRIORITIES.includes(
        priorityRaw as (typeof AGENT_TASK_PRIORITIES)[number],
      )
        ? (priorityRaw as (typeof AGENT_TASK_PRIORITIES)[number])
        : "medium";
      if (!title || !detail) throw new Error("title and detail are required.");

      const [duplicate] = await db
        .select({ id: agentTasksTable.id })
        .from(agentTasksTable)
        .where(
          and(
            eq(agentTasksTable.title, title),
            sql`${agentTasksTable.status} in ('open', 'in_progress')`,
          ),
        )
        .limit(1);
      if (duplicate) {
        return { created: false, reason: "duplicate_open_task", existingTaskId: duplicate.id };
      }

      const [task] = await db
        .insert(agentTasksTable)
        .values({
          agentKey: ctx.agentKey,
          runId: ctx.runId,
          title,
          detail,
          category: str(args.category),
          priority,
        })
        .returning();
      await recordAuditEvent({
        actorType: "agent",
        actor: ctx.agentKey,
        eventType: "task_created",
        subjectType: "task",
        subjectId: task?.id,
        detail: { title, priority },
      });
      return { created: true, task };
    },
  },

  propose_action: {
    declaration: {
      name: "propose_action",
      description:
        `Propose a governed side effect. Low-risk actions may auto-execute; medium/high risk actions enter the operator approval queue. Each agent may only propose the action types its definition allows. Action types: ${Object.values(
          ACTION_CATALOG,
        )
          .filter((a) => !a.retired)
          .map((a) => `${a.type} (${a.riskLevel}): ${a.description}`)
          .join(" | ")}`,
      parameters: {
        type: "object",
        properties: {
          actionType: { type: "string", enum: proposableActionTypes() },
          title: { type: "string", description: "One-line description of the concrete effect." },
          reasoning: {
            type: "string",
            description: "Why this action is justified now, citing the data you inspected.",
          },
          params: {
            type: "object",
            description:
              "Action parameters. send_outreach_email: {emailId} (use draft_outreach_email instead, which proposes this for you). enroll_prospects_in_campaign: {campaignId, prospectIds}. launch_campaign/pause_campaign/complete_campaign: {campaignId}. send_venue_email: {venueSlug, subject, message}. grant_promo_credits: {organizationId, amount, note}. requeue_failed_session: {sessionId}. pause_agent: {agentKey}. update_policy: {key, value, note} (value fields and bounds are validated per policy).",
          },
        },
        required: ["actionType", "title", "reasoning", "params"],
      },
    },
    async execute(args, ctx) {
      const actionType = str(args.actionType);
      const title = str(args.title);
      const reasoning = str(args.reasoning);
      const params =
        args.params && typeof args.params === "object" && !Array.isArray(args.params)
          ? (args.params as Record<string, unknown>)
          : null;
      if (!actionType || !title || !params) {
        throw new Error("actionType, title, and params are required.");
      }
      const action = await proposeAction({
        agentKey: ctx.agentKey,
        runId: ctx.runId,
        actionType,
        title,
        reasoning: reasoning ?? undefined,
        params,
      });
      return {
        actionId: action.id,
        status: action.status,
        riskLevel: action.riskLevel,
        requiresApproval: action.requiresApproval,
        result: action.result,
        error: action.error,
      };
    },
  },
};

/** The full registry: core + vetting + growth. Every tool granted in agents.ts must resolve here. */
const TOOLS: Record<string, ControlPlaneTool> = { ...CORE_TOOLS, ...vettingTools, ...growthTools };

export const TOOL_NAMES = Object.keys(TOOLS) as Array<keyof typeof TOOLS & string>;

/**
 * Pure: the action types one agent may propose — the non-retired catalog
 * narrowed by its AgentDefinition.actions allowlist (no allowlist or no
 * definition = the whole proposable catalog).
 */
export function proposableActionTypesFor(agentKey: string | null | undefined): string[] {
  const all = proposableActionTypes();
  if (!agentKey) return all;
  const allow = getAgentDefinition(agentKey)?.actions;
  return allow === undefined ? all : all.filter((type) => allow.includes(type));
}

/**
 * Declarations for an agent's granted tools. With agentKey, propose_action's
 * actionType enum and description list only the actions that agent may
 * propose, so the model never sees options the action layer would refuse.
 */
export function toolDeclarations(names: string[], agentKey?: string): ToolDeclaration[] {
  return names
    .map((name) => {
      const declaration = TOOLS[name]?.declaration;
      if (!declaration || name !== "propose_action" || !agentKey) return declaration;
      const allowed = proposableActionTypesFor(agentKey);
      const parameters = structuredClone(declaration.parameters) as {
        properties: Record<string, Record<string, unknown>>;
      };
      parameters.properties.actionType = { ...parameters.properties.actionType, enum: allowed };
      const offered = Object.values(ACTION_CATALOG)
        .filter((a) => allowed.includes(a.type))
        .map((a) => `${a.type} (${a.riskLevel}): ${a.description}`)
        .join(" | ");
      return {
        ...declaration,
        description: `Propose a governed side effect. Medium/high risk actions enter the operator approval queue. You may propose: ${offered || "nothing (your role takes no governed actions)"}`,
        parameters: parameters as unknown as ToolDeclaration["parameters"],
      };
    })
    .filter((decl): decl is ToolDeclaration => Boolean(decl));
}


export async function executeControlPlaneTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  return tool.execute(args, ctx);
}
