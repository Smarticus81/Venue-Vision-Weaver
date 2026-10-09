import { db, controlOutreachEmailsTable, controlProspectsTable, organizationsTable, venuesTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { FREE_MAIL_DOMAINS as VETTING_FREE_MAIL_DOMAINS } from "../vetting/lists.js";
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
  // ISP and regional consumer mail: a shared domain proves nothing.
  "bellsouth.net",
  "earthlink.net",
  "charter.net",
  "optonline.net",
  "frontier.com",
  "frontiernet.net",
  "windstream.net",
  "centurylink.net",
  "q.com",
  "roadrunner.com",
  "rr.com",
  "twc.com",
  "spectrum.net",
  "juno.com",
  "netzero.net",
  "aim.com",
  "rocketmail.com",
  "yahoo.co.uk",
  "yahoo.ca",
  "yahoo.com.au",
  "hotmail.co.uk",
  "hotmail.ca",
  "live.co.uk",
  "outlook.co.uk",
  "btinternet.com",
  "sky.com",
  "talktalk.net",
  "virginmedia.com",
  "ntlworld.com",
  "blueyonder.co.uk",
  "shaw.ca",
  "rogers.com",
  "sympatico.ca",
  "telus.net",
  "bigpond.com",
  "optusnet.com.au",
  "web.de",
  "gmx.de",
  "gmx.net",
  "t-online.de",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "pm.me",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "yandex.com",
  ...VETTING_FREE_MAIL_DOMAINS,
]);

/**
 * Hosts shared by many businesses (social profiles, wedding marketplaces,
 * link-in-bio and site-builder roots). A matching host there says nothing
 * about the venue (facebook.com/RoseHall vs facebook.com/OtherVenue), so it
 * never attributes a signup. Subdomains count too (m.facebook.com).
 */
export const SHARED_WEBSITE_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "pinterest.com",
  "linkedin.com",
  "threads.net",
  "theknot.com",
  "weddingwire.com",
  "weddingwire.ca",
  "zola.com",
  "herecomestheguide.com",
  "weddingspot.com",
  "venuereport.com",
  "junebugweddings.com",
  "brides.com",
  "eventective.com",
  "peerspace.com",
  "tagvenue.com",
  "hitched.co.uk",
  "bridebook.com",
  "yelp.com",
  "tripadvisor.com",
  "google.com",
  "goo.gl",
  "g.page",
  "business.site",
  "maps.app.goo.gl",
  "linktr.ee",
  "beacons.ai",
  "bio.link",
  "linkin.bio",
  "bit.ly",
  "tinyurl.com",
  "airbnb.com",
  "vrbo.com",
  "booking.com",
]);

export function isSharedWebsiteHost(host: string): boolean {
  const lowerHost = host.toLowerCase();
  for (const shared of SHARED_WEBSITE_HOSTS) {
    if (lowerHost === shared || lowerHost.endsWith(`.${shared}`)) return true;
  }
  return false;
}

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
  if (prospectHost && signupHost && prospectHost === signupHost && !isSharedWebsiteHost(prospectHost)) return "website_domain";

  const prospectDomain = emailDomain(prospectEmail);
  const signupDomain = emailDomain(signup.ownerEmail ?? signup.orgContactEmail);
  if (prospectDomain && signupDomain && prospectDomain === signupDomain && !FREE_MAIL_DOMAINS.has(prospectDomain)) {
    return "email_domain";
  }
  return null;
}

const CANDIDATE_STATUSES = ["new", "qualified", "contacted", "replied"] as const;

/**
 * True when the organization existed before we first emailed the prospect:
 * it is a customer we found, not one outreach brought in. Prospects never
 * contacted are not "pre-existing" (they are simply customers now).
 */
export function isPreexistingCustomer(
  orgCreatedAt: Date | null,
  prospect: { contactCount: number; firstContactAt: Date | null },
): boolean {
  if (prospect.contactCount <= 0 || orgCreatedAt == null || prospect.firstContactAt == null) return false;
  return orgCreatedAt.getTime() < prospect.firstContactAt.getTime();
}

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
      lastContactedAt: controlProspectsTable.lastContactedAt,
    })
    .from(controlProspectsTable)
    .where(
      and(isNull(controlProspectsTable.convertedOrganizationId), inArray(controlProspectsTable.status, [...CANDIDATE_STATUSES])),
    )
    .limit(10_000);
  if (prospects.length === 0) return 0;

  // First studio email sent to each candidate (legacy sends fall back to lastContactedAt).
  const firstSends = await db
    .select({
      prospectId: controlOutreachEmailsTable.prospectId,
      firstSentAt: sql<Date | string | null>`min(${controlOutreachEmailsTable.sentAt})`,
    })
    .from(controlOutreachEmailsTable)
    .where(
      and(
        isNotNull(controlOutreachEmailsTable.sentAt),
        inArray(
          controlOutreachEmailsTable.prospectId,
          prospects.map((p) => p.id),
        ),
      ),
    )
    .groupBy(controlOutreachEmailsTable.prospectId);
  const firstSentById = new Map(
    firstSends.map((row) => [row.prospectId, row.firstSentAt ? new Date(row.firstSentAt) : null] as const),
  );

  const rows = await db
    .select({
      organizationId: organizationsTable.id,
      orgCreatedAt: organizationsTable.createdAt,
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

  const orgCreatedAt = new Map(rows.map((row) => [row.organizationId, row.orgCreatedAt] as const));
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

    const firstContactAt = firstSentById.get(prospect.id) ?? prospect.lastContactedAt ?? null;
    if (isPreexistingCustomer(orgCreatedAt.get(hit.signup.organizationId) ?? null, { contactCount: prospect.contactCount, firstContactAt })) {
      // Already a customer before we wrote to them: lock it against outreach,
      // but never credit outbound or stamp the organization with it.
      const [locked] = await db
        .update(controlProspectsTable)
        .set({ status: "disqualified", statusChangedBy: "system:attribution", updatedAt: now })
        .where(and(eq(controlProspectsTable.id, prospect.id), inArray(controlProspectsTable.status, [...CANDIDATE_STATUSES])))
        .returning({ id: controlProspectsTable.id });
      if (locked) {
        await recordAuditEvent({
          actorType: "system",
          actor: "growth-attribution",
          eventType: "prospect_matched_existing_customer",
          subjectType: "prospect",
          subjectId: prospect.id,
          detail: { organizationId: hit.signup.organizationId, method: hit.method, contactCount: prospect.contactCount },
        });
      }
      continue;
    }

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
