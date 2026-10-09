import { randomBytes } from "node:crypto";
import {
  db,
  controlEmailEventsTable,
  controlOutreachEmailsTable,
  controlProspectAssetsTable,
  controlProspectsTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { recordFunnelEvent } from "../../lib/funnelEvents.js";
import { recordAuditEvent } from "../audit.js";
import { publicObjectUrl } from "./config.js";

/**
 * Claim links: every studio email carries a random per-email token in its
 * call-to-action (/claim/:token). The public page resolves it to the venue
 * the email was written for (name, website, region, the photos the email
 * showed) so signup is pre-filled, and the click is recorded on the email as
 * engagement. Only emails that were actually sent resolve.
 */

export const CLAIM_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function newClaimToken(): string {
  return randomBytes(18).toString("base64url");
}

export interface ClaimDetails {
  venueName: string;
  website: string | null;
  region: string | null;
  photoUrls: string[];
  prospectId: number;
}

/** Resolve a claim token to its venue and record the click (first click wins for clickedAt). */
export async function resolveClaim(token: string, now: Date = new Date()): Promise<ClaimDetails | null> {
  if (!CLAIM_TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({
      emailId: controlOutreachEmailsTable.id,
      prospectId: controlOutreachEmailsTable.prospectId,
      imageAssetIds: controlOutreachEmailsTable.imageAssetIds,
      clickedAt: controlOutreachEmailsTable.clickedAt,
      venueName: controlProspectsTable.name,
      website: controlProspectsTable.website,
      region: controlProspectsTable.region,
    })
    .from(controlOutreachEmailsTable)
    .innerJoin(controlProspectsTable, eq(controlOutreachEmailsTable.prospectId, controlProspectsTable.id))
    .where(and(eq(controlOutreachEmailsTable.claimToken, token), isNotNull(controlOutreachEmailsTable.sentAt)))
    .limit(1);
  if (!row) return null;

  const assets =
    row.imageAssetIds.length > 0
      ? await db
          .select({ id: controlProspectAssetsTable.id, objectKey: controlProspectAssetsTable.objectKey })
          .from(controlProspectAssetsTable)
          .where(and(inArray(controlProspectAssetsTable.id, row.imageAssetIds), eq(controlProspectAssetsTable.prospectId, row.prospectId)))
      : [];
  const byId = new Map(assets.map((asset) => [asset.id, asset.objectKey]));
  const photoUrls = row.imageAssetIds
    .map((id) => byId.get(id))
    .filter((key): key is string => Boolean(key))
    .map((key) => publicObjectUrl(key));

  // Only the first resolution counts as engagement: reloads of the claim page
  // must not inflate clicks or the funnel.
  const firstClick = await db
    .update(controlOutreachEmailsTable)
    .set({
      clickedAt: now,
      openedAt: sql`coalesce(${controlOutreachEmailsTable.openedAt}, ${now})`,
      updatedAt: now,
    })
    .where(and(eq(controlOutreachEmailsTable.id, row.emailId), isNull(controlOutreachEmailsTable.clickedAt)))
    .returning({ id: controlOutreachEmailsTable.id });
  if (firstClick.length === 0) {
    return {
      venueName: row.venueName,
      website: row.website ?? null,
      region: row.region ?? null,
      photoUrls,
      prospectId: row.prospectId,
    };
  }
  await db.insert(controlEmailEventsTable).values({
    emailId: row.emailId,
    providerEventId: null,
    eventType: "clicked",
    payload: { source: "claim_link" },
  });
  await recordAuditEvent({
    actorType: "system",
    actor: "outreach-claim",
    eventType: "outreach_claim_opened",
    subjectType: "outreach_email",
    subjectId: row.emailId,
    detail: { prospectId: row.prospectId },
  });
  await recordFunnelEvent({
    event: "cta_click",
    source: "outreach_claim",
    properties: { prospectId: row.prospectId, emailId: row.emailId },
  });

  return {
    venueName: row.venueName,
    website: row.website ?? null,
    region: row.region ?? null,
    photoUrls,
    prospectId: row.prospectId,
  };
}
