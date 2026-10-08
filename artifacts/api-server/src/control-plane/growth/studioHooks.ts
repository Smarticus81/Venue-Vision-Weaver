import type { ControlProspect } from "@workspace/db";
import type { VenueFacts } from "../outreach/venueResearch.js";

/**
 * Growth's hooks into the outreach studio (shared-contract D12). studio.ts
 * calls these at fixed points and never needs to change when growth fills
 * the bodies: variant choice (weighted; follow-ups reuse the thread's
 * variant), the max_campaign_steps refusal, and venue-type re-classification
 * from research facts.
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

/** Growth fills this: variant choice (weighted; follow-ups reuse the thread's variant) and the max_campaign_steps refusal. */
export async function beforeDraft(input: DraftHookInput): Promise<DraftHookResult> {
  return { variantKey: input.requestedVariantKey, variantAngle: null };
}

/** Growth fills this: re-classify control_prospects.venue_type from research facts. */
export async function afterResearch(_prospectId: number, _facts: VenueFacts): Promise<void> {}
