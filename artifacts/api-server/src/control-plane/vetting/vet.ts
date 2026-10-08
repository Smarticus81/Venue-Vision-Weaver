import type { ControlProspect } from "@workspace/db";
import type { VettingStatus } from "./types.js";

/**
 * Vetting orchestration seam (vetting.md 1.8). Step 0 ships a passthrough:
 * upsert_prospect calls `vetProspect` after every save, and until the
 * vetting workstream lands the verdict is always "unvetted" — nothing is
 * written to control_prospect_vetting and prospect statuses are never
 * forced. The gate (`assertVettingAllowsOutreach`) is likewise not enforced
 * yet; the studio keeps today's behaviour.
 */

export interface VetProspectOptions {
  /** Re-run the checks even when a fresh verdict exists. */
  force?: boolean;
  /** Agent key or operator:<email>; goes into the audit event, never into vetted_by. */
  requestedBy: string;
}

export interface VetProspectOutcome {
  status: VettingStatus;
  score: number | null;
  hardFails: string[];
  summary: string;
  /** True when the checks actually ran (false for the step-0 passthrough and for cache hits). */
  refreshed: boolean;
}

export type VettingGateReason = "unvetted" | "failed" | "review" | "error" | "expired";

export class VettingGateError extends Error {
  constructor(
    public readonly reason: VettingGateReason,
    message: string,
  ) {
    super(message);
    this.name = "VettingGateError";
  }
}

/**
 * Passthrough until the vetting workstream lands: returns "unvetted" with a
 * summary that says so. Never throws for a venue's network problems.
 */
export async function vetProspect(
  prospect: Pick<ControlProspect, "id" | "name" | "email" | "website" | "vettingStatus" | "legitimacyScore">,
  _options: VetProspectOptions,
): Promise<VetProspectOutcome> {
  return {
    status: (prospect.vettingStatus as VettingStatus) ?? "unvetted",
    score: prospect.legitimacyScore ?? null,
    hardFails: [],
    summary: "Vetting is not available yet; the prospect keeps its stored verdict.",
    refreshed: false,
  };
}
