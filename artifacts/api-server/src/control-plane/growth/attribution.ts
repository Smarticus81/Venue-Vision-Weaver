import { db, controlProspectsTable, organizationsTable, venuesTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { recordAuditEvent } from "../audit.js";
import type { ProspectFact } from "./kpiTypes.js";

/*
 * Prospect -> customer attribution (growth-loop.md section 6). A signup is
 * linked to a prospect by exact contact email, then by website host, then by
 * a non-free-mail email domain. The prospect is marked converted (which locks
 * it against any further outreach) and the organization is stamped with the
 * prospect / campaign it came from.
 */

export const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "comcast.net",
  "att.net",
  "verizon.net",
  "sbcglobal.net",
  "cox.net",
  "mail.com",
  "gmx.com",
  "zoho.com",
]);

export type AttributionMatch = "email" | "website_domain" | "email_domain";

/** Lowercased host without scheme, "www." or path; null when unparsable. */
export function normalizeHost(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
    const stripped = host.replace(/^www\./, "");
    if (!stripped || !stripped.includes(".")) return null;
    return stripped;
  } catch {
    return null;
  }
}

export function emailDomain(email: string | null | undefined): string | null {
  const raw = email?.trim().toLowerCase();
  if (!raw) return null;
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) return null;
  const domain = raw.slice(at + 1);
  return domain.includes(".") ? domain : null;
}

export interface SignupCandidate {
  organizationId: number;
  venueId: number | null;
  ownerEmail: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  orgContactEmail: string | null;
}

function lower(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Order of checks: exact email against the owner, venue contact and org
 * contact; website host equality; then a shared non-free-mail email domain.
 */
export function matchProspect(
  prospect: Pick<ProspectFact, "email"> & { website: string | null },
  signup: SignupCandidate,
): AttributionMatch | null {
  const prospectEmail = lower(prospect.email);
  const emails = [signup.ownerEmail, signup.contactEmail, signup.orgContactEmail].map(lower).filter((e): e is string => e !== null);
  if (prospectEmail && emails.includes(prospectEmail)) return "email";

  const prospectHost = normalizeHost(prospect.website);
  const signupHost = normalizeHost(signup.websiteUrl);
  if (prospectHost && signupHost && prospectHost === signupHost) return "website_domain";

  const prospectDomain = emailDomain(prospectEmail);
  const signupDomain = emailDomain(signup.ownerEmail ?? signup.orgContactEmail);
  if (prospectDomain && signupDomain && prospectDomain === signupDomain && !FREE_MAIL_DOMAINS.has(prospectDomain)) {
    return "email_domain";
  }
  return null;
}

const CANDIDATE_STATUSES = ["new", "qualified", "contacted", "replied"] as const;

/**
 * Match unconverted prospects against organizations (left-joined to venues so
 * an org with a contact email and no venue yet still matches). Returns the
 * number of prospects converted. Runs after venue creation and on the hourly
 * sweep; every write is conditional so repeats are harmless.
 */
export async function attributeSignups(options: { organizationId?: number } = {}): Promise<number> {
  const prospects = await db
    .select({
      id: controlProspectsTable.id,
      email: controlProspectsTable.email,
      website: controlProspectsTable.website,
      campaignId: controlProspectsTable.campaignId,
      contactCount: controlProspectsTable.contactCount,
    })
    .from(controlProspectsTable)
    .where(
      and(isNull(controlProspectsTable.convertedOrganizationId), inArray(controlProspectsTable.status, [...CANDIDATE_STATUSES])),
    )
    .limit(10_000);
  if (prospects.length === 0) return 0;

  const rows = await db
    .select({
      organizationId: organizationsTable.id,
      orgContactEmail: organizationsTable.contactEmail,
      venueId: venuesTable.id,
      ownerEmail: venuesTable.ownerEmail,
      contactEmail: venuesTable.contactEmail,
      websiteUrl: venuesTable.websiteUrl,
    })
    .from(organizationsTable)
    .leftJoin(venuesTable, eq(venuesTable.organizationId, organizationsTable.id))
    .where(options.organizationId != null ? eq(organizationsTable.id, options.organizationId) : undefined)
    .limit(5000);

  const signups: SignupCandidate[] = rows.map((row) => ({
    organizationId: row.organizationId,
    venueId: row.venueId ?? null,
    ownerEmail: row.ownerEmail ?? null,
    contactEmail: row.contactEmail ?? null,
    websiteUrl: row.websiteUrl ?? null,
    orgContactEmail: row.orgContactEmail ?? null,
  }));
  if (signups.length === 0) return 0;

  let converted = 0;
  const now = new Date();
  for (const prospect of prospects) {
    let hit: { signup: SignupCandidate; method: AttributionMatch } | null = null;
    for (const signup of signups) {
      const method = matchProspect(prospect, signup);
      if (method) {
        hit = { signup, method };
        break;
      }
    }
    if (!hit) continue;

    const [updated] = await db
      .update(controlProspectsTable)
      .set({
        status: "converted",
        convertedAt: now,
        convertedOrganizationId: hit.signup.organizationId,
        convertedCampaignId: prospect.campaignId,
        attributionMethod: hit.method,
        statusChangedBy: "system:attribution",
        updatedAt: now,
      })
      .where(and(eq(controlProspectsTable.id, prospect.id), isNull(controlProspectsTable.convertedOrganizationId)))
      .returning({ id: controlProspectsTable.id });
    if (!updated) continue;
    converted += 1;

    // Stamp the organization once (first matching prospect wins).
    await db
      .update(organizationsTable)
      .set({ attributionProspectId: prospect.id, attributionCampaignId: prospect.campaignId })
      .where(and(eq(organizationsTable.id, hit.signup.organizationId), isNull(organizationsTable.attributionProspectId)));

    await recordAuditEvent({
      actorType: "system",
      actor: "growth-attribution",
      eventType: "prospect_converted_auto",
      subjectType: "prospect",
      subjectId: prospect.id,
      detail: {
        organizationId: hit.signup.organizationId,
        venueId: hit.signup.venueId,
        method: hit.method,
        contactCount: prospect.contactCount,
        campaignId: prospect.campaignId,
      },
    });
  }
  if (converted > 0) logger.info({ converted, organizationId: options.organizationId ?? null }, "Attribution sweep converted prospects");
  return converted;
}

const HOUR_MS = 3_600_000;
let lastSweepAt = 0;

/** Scheduler entry: full sweep at most once per hour. */
export async function maybeRunAttribution(now: Date = new Date()): Promise<number | null> {
  if (now.getTime() - lastSweepAt < HOUR_MS) return null;
  lastSweepAt = now.getTime();
  return attributeSignups();
}

/** Test seam: reset the hourly gate. */
export function resetAttributionClock(): void {
  lastSweepAt = 0;
}
