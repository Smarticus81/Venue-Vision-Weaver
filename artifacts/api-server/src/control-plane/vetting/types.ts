import {
  VETTING_STATUSES,
  type VettingStatus,
  VETTING_CHECK_KEYS,
  type VettingCheckKey,
  FACT_KINDS,
  type FactKind,
  FACT_SOURCE_KINDS,
  type FactSourceKind,
  FACT_STATUSES,
  type FactStatus,
} from "@workspace/db";

/**
 * Runtime shapes for prospect legitimacy vetting (vetting.md 1.1). The
 * string-union constants live in lib/db (one definition); this module
 * re-exports them and adds the check/result/fact shapes the module layout
 * in vetting.md builds on.
 */
export { VETTING_STATUSES, VETTING_CHECK_KEYS, FACT_KINDS, FACT_SOURCE_KINDS, FACT_STATUSES };
export type { VettingStatus, VettingCheckKey, FactKind, FactSourceKind, FactStatus };

export type CheckOutcome = "pass" | "warn" | "fail" | "skip" | "error";

export interface VettingEvidence {
  /** Where the observation came from (page URL, RDAP URL, CDX URL, "dns:MX example.com", "tls://host", Google Maps place URL). */
  url: string;
  /** Short quoted value or excerpt (max 240 chars). */
  excerpt?: string;
  observedAt: string; // ISO
}

export interface VettingCheck {
  key: VettingCheckKey;
  outcome: CheckOutcome;
  /** Points contributed to the 0-100 score (0 on warn/fail/skip/error unless the check says otherwise). */
  points: number;
  /** True when this outcome alone fails the prospect. */
  hardFail: boolean;
  /** One operator-readable sentence. */
  detail: string;
  evidence: VettingEvidence[];
  /** Structured values other code reads (mxProvider, registeredAt, firstCaptureAt, placeId, freshDomain, verified, ...). */
  data?: Record<string, string | number | boolean | null>;
}

export interface VettingResult {
  status: Exclude<VettingStatus, "unvetted">;
  score: number; // 0-100
  tier: "A" | "AB"; // AB when Places ran
  hardFails: string[]; // check keys
  checks: VettingCheck[];
  summary: string; // e.g. "Passed 78/100: 9-year-old domain, Workspace mail, named mailbox, address and phone on site, listed on The Knot."
  contactDomain: string;
  mxProvider: string | null;
  domainRegisteredAt: Date | null;
  firstCaptureAt: Date | null;
  placesPlaceId: string | null;
  /** Facts discovered during vetting (phone, address, owner_name verification, email, marketplace, social, google_rating, wedding_signal). */
  facts: DiscoveredFact[];
}

/** Kinds the copywriter may cite to satisfy the two-fact rule. */
export const CITABLE_FACT_KINDS: FactKind[] = ["space", "location", "capacity", "owner_name"];

export interface DiscoveredFact {
  kind: FactKind;
  value: string;
  sourceUrl: string;
  sourceKind: FactSourceKind;
  excerpt?: string | null;
  status: FactStatus;
}

export interface CitableFact {
  kind: FactKind;
  value: string;
  sourceUrl: string;
}

export interface VettingPolicy {
  passScore: number; // default 60
  reviewScore: number; // default 40
  blockedCountries: string[]; // default ["CA"]
  ttlDays: number; // default 30 (env VETTING_TTL_DAYS)
}
