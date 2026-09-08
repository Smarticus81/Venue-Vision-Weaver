/**
 * @workspace/control-plane — the autonomous business control plane kernel.
 *
 * Deliberately pure: no database, no network, no clock of its own. The
 * api-server assembles a BusinessSnapshot, runs the fleet over it, applies
 * policy to each proposal, and executes what clears. Everything here can be
 * exercised in a test with a hand-written snapshot.
 */
export * from "./types.js";
export * from "./policy.js";
export * from "./orchestrator.js";
export * from "./agents/index.js";
export {
  changeRatio,
  classifyFailure,
  clamp,
  dayBucket,
  formatPercent,
  formatUsd,
  FAILURE_FAMILY_LABELS,
  normalCdf,
  observation,
  pct,
  pluralize,
  round,
  severityRank,
  topEntries,
  twoProportionTest,
  weekBucket,
} from "./util.js";
