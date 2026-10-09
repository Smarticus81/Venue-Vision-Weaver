import { db, controlOutreachEmailsTable, controlProspectsTable, type ControlProspect } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import type { VenueFacts } from "../outreach/venueResearch.js";
import { getPolicyNumber } from "../policies.js";
import { classifyVenueType } from "./segments.js";
import { chooseVariant, listVariants } from "./variants.js";

/**
 * Growth's hooks into the outreach studio (shared-contract D12). studio.ts
 * calls these at fixed points and never needs to change: variant choice
 * (weighted over the registry; follow-ups reuse the thread's variant so one
 * prospect hears one angle), the max_campaign_steps refusal, and venue-type
 * re-classification from research facts.
 */

export interface DraftHookInput {
  prospect: ControlProspect;
  campaignId: number | null;
  step: number | null;
  requestedVariantKey: string | null;
}

export interface DraftHookResult {
  variantKey: string | null;
  variantAngle: string | null;
}

export class CampaignStepCapError extends Error {
  constructor(step: number, cap: number) {
    super(`Campaign step ${step} exceeds policy max_campaign_steps (${cap}).`);
    this.name = "CampaignStepCapError";
  }
}

/** Pure: the step-cap rule shared with the send-time re-check. */
export function stepExceedsCap(step: number | null, cap: number): boolean {
  return step != null && Number.isFinite(step) && step > cap;
}

/** The variant the prospect's thread already uses (latest sent studio email), or null. */
async function threadVariantKey(prospectId: number): Promise<string | null> {
  const [row] = await db
    .select({ variantKey: controlOutreachEmailsTable.variantKey })
    .from(controlOutreachEmailsTable)
    .where(and(eq(controlOutreachEmailsTable.prospectId, prospectId), isNotNull(controlOutreachEmailsTable.sentAt)))
    .orderBy(desc(controlOutreachEmailsTable.sentAt))
    .limit(1);
  return row?.variantKey ?? null;
}

/**
 * Variant choice + step cap. Throws CampaignStepCapError when the requested
 * step is above the policy (the draft is refused); a registry failure never
 * blocks a draft — the copywriter simply gets no angle.
 */
export async function beforeDraft(input: DraftHookInput): Promise<DraftHookResult> {
  const cap = await getPolicyNumber("max_campaign_steps", "steps", 3);
  if (stepExceedsCap(input.step, cap)) throw new CampaignStepCapError(input.step!, cap);

  try {
    const variants = await listVariants();
    const byKey = new Map(variants.map((v) => [v.key, v]));

    // 1. An explicit, known key wins (operator or agent asked for it).
    if (input.requestedVariantKey) {
      const requested = byKey.get(input.requestedVariantKey);
      if (requested) return { variantKey: requested.key, variantAngle: requested.angle };
      logger.warn({ prospectId: input.prospect.id, variantKey: input.requestedVariantKey }, "Requested copy variant is not in the registry; choosing by weight instead");
    }

    // 2. Follow-ups keep the thread's angle.
    if (input.prospect.contactCount > 0 || (input.step != null && input.step > 1)) {
      const previous = await threadVariantKey(input.prospect.id);
      const existing = previous ? byKey.get(previous) : undefined;
      if (existing) return { variantKey: existing.key, variantAngle: existing.angle };
    }

    // 3. First touch: weighted pick over the active registry rows.
    const chosen = chooseVariant(variants);
    return chosen ? { variantKey: chosen.key, variantAngle: chosen.angle } : { variantKey: null, variantAngle: null };
  } catch (err) {
    logger.warn({ err, prospectId: input.prospect.id }, "Copy-variant choice failed; drafting without an angle");
    return { variantKey: input.requestedVariantKey, variantAngle: null };
  }
}

/** Re-classify control_prospects.venue_type once the venue's own site has been read. */
export async function afterResearch(prospectId: number, facts: VenueFacts): Promise<void> {
  try {
    const [prospect] = await db
      .select({ name: controlProspectsTable.name, qualification: controlProspectsTable.qualification, venueType: controlProspectsTable.venueType })
      .from(controlProspectsTable)
      .where(eq(controlProspectsTable.id, prospectId))
      .limit(1);
    if (!prospect) return;
    const venueType = classifyVenueType({
      name: prospect.name,
      qualification: prospect.qualification,
      facts: { style: facts.style, spaces: facts.spaces, summary: facts.summary },
    });
    // Facts only ever sharpen the segment: never move a classified prospect back to "other".
    if (venueType === "other" && prospect.venueType && prospect.venueType !== "other") return;
    if (venueType === prospect.venueType) return;
    await db.update(controlProspectsTable).set({ venueType }).where(eq(controlProspectsTable.id, prospectId));
  } catch (err) {
    logger.warn({ err, prospectId }, "Venue-type re-classification after research failed");
  }
}
