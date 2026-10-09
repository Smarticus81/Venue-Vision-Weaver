import { MX_PROVIDER_LABELS } from "./lists.js";
import type { VettingCheck, VettingPolicy, VettingResult } from "./types.js";

/**
 * Turn the check list into a verdict (vetting.md 1.5). Pure.
 *
 * - score = clamp(sum(points), 0, 100)
 * - hardFails = checks with hardFail, plus the composite "fresh domain" rule
 *   (registered < 90 days, a *confirmed* empty archive, no Google listing)
 * - failed when any hard fail; otherwise error when the site check errored
 *   or three or more checks errored (an outage, not a verdict, so it wins
 *   over a low score); otherwise failed when score < reviewScore, review
 *   when score < passScore, passed otherwise.
 */
export function computeLegitimacy(
  checks: VettingCheck[],
  policy: VettingPolicy,
): Pick<VettingResult, "status" | "score" | "hardFails" | "summary"> {
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const score = Math.max(0, Math.min(100, checks.reduce((sum, check) => sum + check.points, 0)));

  const hardFails = checks.filter((check) => check.hardFail).map((check) => check.key as string);
  const domainAge = byKey.get("domain_age");
  const history = byKey.get("site_history");
  const places = byKey.get("places");
  const placesMatched = places?.outcome === "pass";
  if (
    domainAge?.data?.freshDomain === true &&
    history?.outcome === "skip" &&
    history.data?.noCaptures === true &&
    !placesMatched &&
    !hardFails.includes("domain_age")
  ) {
    hardFails.push("domain_age");
    domainAge.detail = `${domainAge.detail}; registered < 90 days with no archive history and no Google listing`;
  }

  const errored = checks.filter((check) => check.outcome === "error");
  const siteErrored = byKey.get("site_reachable")?.outcome === "error";

  // An outage is checked before the score: when the site could not be read
  // (timeout, bot wall, 5xx) every site-derived check scores 0, so a low
  // score then says nothing about the venue. Only a real hard fail beats it.
  let status: VettingResult["status"];
  if (hardFails.length > 0) status = "failed";
  else if (siteErrored || errored.length >= 3) status = "error";
  else if (score < policy.reviewScore) status = "failed";
  else if (score < policy.passScore) status = "review";
  else status = "passed";

  const label = status.charAt(0).toUpperCase() + status.slice(1);
  let summary: string;
  if (status === "failed") {
    const reasons = hardFails.map((key) => byKey.get(key as VettingCheck["key"])?.detail ?? key);
    if (reasons.length === 0) reasons.push(`score below the review threshold (${policy.reviewScore})`);
    summary = `${label} ${score}/100: ${reasons.join("; ")}`;
  } else if (status === "error") {
    summary = `${label} ${score}/100: ${errored.map((check) => check.key).join(", ") || "upstream lookups failed"}`;
  } else {
    summary = `${label} ${score}/100: ${summaryClauses(byKey).join(", ") || "few signals"}.`;
  }
  return { status, score, hardFails, summary };
}

function summaryClauses(byKey: Map<string, VettingCheck>): string[] {
  const clauses: string[] = [];
  const age = byKey.get("domain_age");
  if (age?.outcome === "pass" && typeof age.data?.ageDays === "number") {
    const years = Math.floor(age.data.ageDays / 365);
    clauses.push(years >= 1 ? `${years}-year-old domain` : `${age.data.ageDays}-day-old domain`);
  } else if (age?.outcome === "warn" && typeof age.data?.ageDays === "number") {
    clauses.push(`${age.data.ageDays}-day-old domain`);
  }
  const mx = byKey.get("mx_present");
  if (mx?.outcome === "pass") {
    const provider = typeof mx.data?.mxProvider === "string" ? mx.data.mxProvider : "other";
    clauses.push(mx.data?.freeMail ? "free-mail address" : MX_PROVIDER_LABELS[provider] ?? MX_PROVIDER_LABELS.other!);
  }
  const role = byKey.get("mailbox_role");
  if (role?.outcome === "pass") clauses.push(role.data?.role ? "role mailbox" : "named mailbox");
  const nap = byKey.get("nap");
  if (nap && (nap.outcome === "pass" || nap.points > 0)) {
    if (nap.data?.phone && nap.data?.address) clauses.push("address and phone on site");
    else if (nap.data?.phone) clauses.push("phone on site");
    else if (nap.data?.address) clauses.push("address on site");
  }
  const marketplace = byKey.get("marketplace_presence");
  if (marketplace?.outcome === "pass" && typeof marketplace.data?.marketplaces === "string") {
    const labels = marketplace.data.marketplaces.split(",").filter(Boolean);
    clauses.push(`listed on ${labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}` : labels[0]}`);
  }
  const places = byKey.get("places");
  if (places?.outcome === "pass") {
    const reviews = typeof places.data?.userRatingCount === "number" ? places.data.userRatingCount : null;
    clauses.push(reviews != null ? `Google listing, ${reviews} reviews` : "Google listing");
  }
  return clauses.slice(0, 5);
}
