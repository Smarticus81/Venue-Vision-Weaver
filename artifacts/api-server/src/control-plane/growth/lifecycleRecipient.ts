import { db, organizationsTable, venuesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";

/*
 * Who receives a trial lifecycle email: the organization's contact email
 * (first signed-in member or Stripe billing email), else the owner email of
 * its earliest venue. Kept in its own module so both the trial sweep and the
 * governed action can import it without a cycle through actions.ts.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v && EMAIL_REGEX.test(v) ? v : null;
}

export async function resolveLifecycleRecipient(organizationId: number): Promise<string | null> {
  const [org] = await db
    .select({ contactEmail: organizationsTable.contactEmail })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId))
    .limit(1);
  if (!org) return null;
  const fromOrg = clean(org.contactEmail);
  if (fromOrg) return fromOrg;
  const [venue] = await db
    .select({ ownerEmail: venuesTable.ownerEmail })
    .from(venuesTable)
    .where(eq(venuesTable.organizationId, organizationId))
    .orderBy(asc(venuesTable.createdAt))
    .limit(1);
  return clean(venue?.ownerEmail) ?? null;
}
