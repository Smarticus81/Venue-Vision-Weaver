import { db, venuesTable, type ControlProspect } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getPolicyNumber } from "../policies.js";
import { isSuppressed } from "./unsubscribe.js";

/** Statuses a prospect may be in for the control plane to email them. */
export const CONTACTABLE_PROSPECT_STATUSES = ["new", "qualified", "contacted"] as const;

export interface ContactPolicy {
  maxContacts: number;
  minGapHours: number;
}

export async function loadContactPolicy(): Promise<ContactPolicy> {
  return {
    maxContacts: await getPolicyNumber("max_contacts_per_prospect", "contacts", 3),
    minGapHours: await getPolicyNumber("min_hours_between_prospect_contacts", "hours", 72),
  };
}

/**
 * Pure consent/cadence check shared by every prospect-facing send path.
 * Throws with an operator-readable reason; returns nothing when sending is
 * allowed. The suppression list and the existing-customer check are passed
 * in so this stays testable without a database.
 */
export function assertProspectContactable(
  prospect: Pick<ControlProspect, "id" | "email" | "status" | "contactCount" | "lastContactedAt">,
  policy: ContactPolicy,
  flags: { suppressed: boolean; existingCustomerSlug: string | null },
  now: Date = new Date(),
): void {
  if (flags.suppressed) {
    throw new Error(`${prospect.email} is on the suppression list (unsubscribed, bounced, or complained) and must not be emailed.`);
  }
  if (!CONTACTABLE_PROSPECT_STATUSES.includes(prospect.status as (typeof CONTACTABLE_PROSPECT_STATUSES)[number])) {
    throw new Error(`Prospect ${prospect.id} is "${prospect.status}" and may not be emailed by the control plane.`);
  }
  if (prospect.contactCount >= policy.maxContacts) {
    throw new Error(
      `Prospect ${prospect.id} already received ${prospect.contactCount}/${policy.maxContacts} emails; no further automated contact allowed.`,
    );
  }
  if (prospect.lastContactedAt) {
    const hoursSince = (now.getTime() - prospect.lastContactedAt.getTime()) / 3_600_000;
    if (hoursSince < policy.minGapHours) {
      throw new Error(
        `Prospect ${prospect.id} was contacted ${Math.round(hoursSince)}h ago; policy requires a ${policy.minGapHours}h gap.`,
      );
    }
  }
  if (flags.existingCustomerSlug) {
    throw new Error(
      `Prospect ${prospect.id} (${prospect.email}) already owns venue "${flags.existingCustomerSlug}"; use send_venue_email instead.`,
    );
  }
}

export async function existingCustomerSlug(email: string): Promise<string | null> {
  const [venue] = await db
    .select({ slug: venuesTable.slug })
    .from(venuesTable)
    .where(sql`lower(${venuesTable.ownerEmail}) = ${email.toLowerCase()}`)
    .limit(1);
  return venue?.slug ?? null;
}

/** Database-backed guard used by the governed send actions. */
export async function assertProspectContactableNow(
  prospect: Pick<ControlProspect, "id" | "email" | "status" | "contactCount" | "lastContactedAt">,
): Promise<void> {
  const [policy, suppressed, customerSlug] = await Promise.all([
    loadContactPolicy(),
    isSuppressed(prospect.email),
    existingCustomerSlug(prospect.email),
  ]);
  assertProspectContactable(prospect, policy, { suppressed, existingCustomerSlug: customerSlug });
}
