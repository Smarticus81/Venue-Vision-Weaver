import {
  db,
  controlAuditEventsTable,
  controlProspectsTable,
  controlProspectVettingTable,
  type ControlProspect,
  type ControlProspectVetting,
} from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { startOfUtcDay } from "../actionCounts.js";
import { recordAuditEvent } from "../audit.js";
import { placesDailyCap, vettingTtlDays } from "../outreach/config.js";
import { getPolicy, getPolicyNumber } from "../policies.js";
import {
  checkBlockedRegion,
  checkContactNamePublished,
  checkDomainAge,
  checkEmailPublished,
  checkMailboxClass,
  checkMailboxRole,
  checkMarketplacePresence,
  checkMx,
  checkNap,
  checkNotParked,
  checkSiteHistory,
  checkSiteReachable,
  checkSocialHandles,
  checkSpfDmarc,
  checkTls,
  checkWeddingSignal,
  extractNap,
  type DnsInfo,
  type FetchedSite,
  type RdapInfo,
  type TlsInfo,
  type WaybackInfo,
} from "./checks.js";
import { defaultVettingDeps, type VettingDeps } from "./deps.js";
import { normalizeWebsiteUrl, registrableDomain, splitEmail, websiteDomain } from "./domain.js";
import { loadFacts, upsertFacts } from "./facts.js";
import { checkPlaces, placesFact, type PlacesSearchResult } from "./places.js";
import { computeLegitimacy } from "./score.js";
import type { DiscoveredFact, VettingCheck, VettingPolicy, VettingResult, VettingStatus } from "./types.js";

/**
 * Vetting orchestration and persistence (vetting.md 1.8).
 *
 * `runVetting` is pure over the injected deps: it runs every Tier A check in
 * parallel, optionally Tier B (Google Places), scores the result, and
 * collects sourced facts. It never throws for a venue's network problems; a
 * dependency that fails becomes an "error" outcome for its check.
 *
 * `ensureVetted` / `overrideVetting` write control_prospect_vetting, the
 * facts table, the denormalized prospect columns, the audit trail, and apply
 * the status enforcement (failed -> disqualified, review -> new). The gate
 * (`assertVettingAllowsOutreach`) is what the studio and the sender call.
 */

export const SYSTEM_VETTED_BY = "system:vetting";
export const PLACES_LOOKUP_EVENT = "places_lookup";

/* ————— Policy ————— */

export function parseBlockedCountries(codes: string | null | undefined): string[] {
  if (!codes) return [];
  return codes
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
}

export async function loadVettingPolicy(): Promise<VettingPolicy> {
  const [passScore, reviewScore, blocked] = await Promise.all([
    getPolicyNumber("vetting_pass_score", "score", 60),
    getPolicyNumber("vetting_review_score", "score", 40),
    getPolicy("vetting_blocked_countries"),
  ]);
  const codes = blocked && typeof blocked.codes === "string" ? blocked.codes : "CA";
  return { passScore, reviewScore, blockedCountries: parseBlockedCountries(codes), ttlDays: vettingTtlDays() };
}

/* ————— Pure run ————— */

export interface RunVettingOptions {
  /** Where the agent said the email is published (unverified until the site confirms it). */
  emailSourceUrl: string | null;
  /** Where the agent said the contact's name is published. */
  contactNameSourceUrl?: string | null;
  policy: VettingPolicy;
  deps: VettingDeps;
  /** Why Places is skipped when `deps.placesSearch` is undefined (cap vs disabled). */
  placesSkipDetail?: string;
}

type VettingProspect = Pick<ControlProspect, "id" | "name" | "email" | "phone" | "website" | "region" | "contactName">;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function settled<T>(result: PromiseSettledResult<T> | undefined): { value: T } | { error: string } | null {
  if (!result) return null;
  if (result.status === "fulfilled") return { value: result.value };
  return { error: errorMessage(result.reason) };
}

function errorCheck(key: VettingCheck["key"], detail: string): VettingCheck {
  return { key, outcome: "error", points: 0, hardFail: false, detail, evidence: [] };
}

function safeCheck(key: VettingCheck["key"], run: () => VettingCheck): VettingCheck {
  try {
    return run();
  } catch (err) {
    logger.warn({ err, key }, "Vetting check threw");
    return errorCheck(key, `check crashed: ${errorMessage(err)}`);
  }
}

function hostnameOfUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export async function runVetting(prospect: VettingProspect, options: RunVettingOptions): Promise<VettingResult> {
  const { deps, policy } = options;
  const now = deps.now();
  const email = prospect.email.trim().toLowerCase();
  const parts = splitEmail(email);
  const website = normalizeWebsiteUrl(prospect.website);
  const siteDomain = websiteDomain(website);

  if (!parts) {
    const check: VettingCheck = {
      key: "mx_present",
      outcome: "fail",
      points: 0,
      hardFail: true,
      detail: "malformed email",
      evidence: [],
    };
    const verdict = computeLegitimacy([check], policy);
    return {
      ...verdict,
      tier: "A",
      checks: [check],
      contactDomain: email.split("@")[1] ?? "",
      mxProvider: null,
      domainRegisteredAt: null,
      firstCaptureAt: null,
      placesPlaceId: null,
      facts: [],
    };
  }

  const contactDomain = parts.domain;
  const ageDomain = siteDomain ?? registrableDomain(contactDomain);
  const hostname = website ? hostnameOfUrl(website) : null;

  const [siteResult, dnsResult, rdapResult, waybackResult, tlsResult] = await Promise.allSettled([
    website ? deps.fetchSite(website) : Promise.resolve<FetchedSite | null>(null),
    deps.resolveDns(contactDomain),
    deps.rdap(ageDomain),
    deps.wayback(ageDomain),
    hostname ? deps.probeTls(hostname) : Promise.resolve<TlsInfo | null>(null),
  ]);

  const emptySite = (error: string | null): FetchedSite => ({
    requestedUrl: website ?? "",
    finalUrl: null,
    status: null,
    contentType: null,
    pages: [],
    error,
  });
  const siteSettled = settled(siteResult);
  const site: FetchedSite =
    siteSettled && "value" in siteSettled && siteSettled.value ? siteSettled.value : emptySite(null);
  const siteDepFailed = siteSettled && "error" in siteSettled ? siteSettled.error : null;

  const dnsSettled = settled(dnsResult);
  const dns: DnsInfo | null = dnsSettled ? ("value" in dnsSettled ? dnsSettled.value : { mx: [], spf: false, dmarc: false, error: dnsSettled.error }) : null;
  const rdapSettled = settled(rdapResult);
  const rdap: RdapInfo | null = rdapSettled
    ? "value" in rdapSettled
      ? rdapSettled.value
      : { registeredAt: null, registrar: null, sourceUrl: "", error: rdapSettled.error }
    : null;
  const waybackSettled = settled(waybackResult);
  const wayback: WaybackInfo | null = waybackSettled
    ? "value" in waybackSettled
      ? waybackSettled.value
      : { firstCaptureAt: null, sourceUrl: "", error: waybackSettled.error }
    : null;
  const tlsSettled = settled(tlsResult);
  const tls: TlsInfo | null = tlsSettled
    ? "value" in tlsSettled
      ? tlsSettled.value
      : { ok: false, issuer: null, validFrom: null, validTo: null, error: tlsSettled.error, servername: hostname ?? "" }
    : null;

  const nap = safeExtractNap(site);
  const checks: VettingCheck[] = [];
  checks.push(
    siteDepFailed
      ? errorCheck("site_reachable", `vetting could not fetch the site: ${siteDepFailed}. Re-run later.`)
      : safeCheck("site_reachable", () => checkSiteReachable(site, website, now)),
  );
  checks.push(safeCheck("site_not_parked", () => checkNotParked(site, now)));
  checks.push(safeCheck("tls_valid", () => checkTls(tls, site.finalUrl, now)));
  checks.push(safeCheck("domain_age", () => checkDomainAge(rdap, ageDomain, now)));
  checks.push(safeCheck("site_history", () => checkSiteHistory(wayback, now)));
  checks.push(safeCheck("mx_present", () => checkMx(dns, contactDomain, now)));
  checks.push(safeCheck("spf_dmarc", () => checkSpfDmarc(dns, contactDomain, now)));
  checks.push(safeCheck("mailbox_class", () => checkMailboxClass(email, website)));
  checks.push(safeCheck("mailbox_role", () => checkMailboxRole(email)));
  checks.push(safeCheck("email_published", () => checkEmailPublished(site, email, options.emailSourceUrl, now)));
  checks.push(safeCheck("nap", () => checkNap(nap, prospect.phone ?? null, now)));
  checks.push(safeCheck("marketplace_presence", () => checkMarketplacePresence(site, now)));
  checks.push(safeCheck("social_handles", () => checkSocialHandles(site, now)));
  checks.push(safeCheck("wedding_signal", () => checkWeddingSignal(site, now)));
  checks.push(safeCheck("contact_name_published", () => checkContactNamePublished(site, prospect.contactName ?? null, now)));
  checks.push(safeCheck("blocked_region", () => checkBlockedRegion(nap, prospect.region ?? null, policy.blockedCountries)));

  // Tier B: only when enabled/under cap and Tier A has not already failed (saves quota).
  let tier: VettingResult["tier"] = "A";
  let placesResult: PlacesSearchResult | null = null;
  const tierAHardFail = checks.some((check) => check.hardFail);
  if (deps.placesSearch && !tierAHardFail) {
    tier = "AB";
    try {
      placesResult = await deps.placesSearch({
        name: prospect.name,
        region: prospect.region ?? null,
        location: nap.locality,
        websiteDomain: siteDomain,
      });
    } catch (err) {
      placesResult = { match: null, candidates: 0, error: errorMessage(err) };
    }
    checks.push(safeCheck("places", () => checkPlaces(placesResult, siteDomain, now)));
  } else {
    const detail = !deps.placesSearch
      ? options.placesSkipDetail ?? "Google Places disabled (GOOGLE_PLACES_API_KEY unset)"
      : "skipped: Tier A already failed, saving Places quota";
    checks.push(checkPlaces(null, siteDomain, now, detail));
  }

  const verdict = computeLegitimacy(checks, policy);
  const byKey = new Map(checks.map((check) => [check.key, check]));
  const mx = byKey.get("mx_present");
  const mxProvider = typeof mx?.data?.mxProvider === "string" ? mx.data.mxProvider : null;

  return {
    ...verdict,
    tier,
    checks,
    contactDomain,
    mxProvider,
    domainRegisteredAt: rdap?.registeredAt ?? null,
    firstCaptureAt: wayback?.firstCaptureAt ?? null,
    placesPlaceId: placesResult?.match?.placeId ?? null,
    facts: collectFacts({ prospect, email, website, site, nap, byKey, placesResult, options }),
  };
}

function safeExtractNap(site: FetchedSite): ReturnType<typeof extractNap> {
  try {
    return extractNap(site);
  } catch (err) {
    logger.warn({ err }, "Vetting: NAP extraction threw");
    return { name: null, phone: null, address: null, locality: null, country: null, sourceUrl: null, sourceKind: "website" };
  }
}

function collectFacts(input: {
  prospect: VettingProspect;
  email: string;
  website: string | null;
  site: FetchedSite;
  nap: ReturnType<typeof extractNap>;
  byKey: Map<string, VettingCheck>;
  placesResult: PlacesSearchResult | null;
  options: RunVettingOptions;
}): DiscoveredFact[] {
  const { prospect, email, website, site, nap, byKey, placesResult, options } = input;
  const facts: DiscoveredFact[] = [];
  const homepage = site.pages[0]?.url ?? website ?? "";

  const published = byKey.get("email_published");
  if (published?.outcome === "pass" && published.evidence[0]) {
    facts.push({
      kind: "email",
      value: email,
      sourceUrl: published.evidence[0].url,
      sourceKind: "website",
      excerpt: published.evidence[0].excerpt ?? null,
      status: "verified",
    });
  } else {
    facts.push({
      kind: "email",
      value: email,
      sourceUrl: options.emailSourceUrl ?? website ?? "",
      sourceKind: "agent_research",
      excerpt: null,
      status: "unverified",
    });
  }

  if (nap.sourceUrl) {
    if (nap.phone) {
      facts.push({ kind: "phone", value: nap.phone, sourceUrl: nap.sourceUrl, sourceKind: nap.sourceKind, excerpt: null, status: "verified" });
    }
    if (nap.address) {
      facts.push({ kind: "address", value: nap.address, sourceUrl: nap.sourceUrl, sourceKind: nap.sourceKind, excerpt: null, status: "verified" });
    }
  }

  const contactName = prospect.contactName?.replace(/\s+/g, " ").trim();
  if (contactName) {
    const nameCheck = byKey.get("contact_name_published");
    if (nameCheck?.outcome === "pass" && nameCheck.evidence[0]) {
      facts.push({
        kind: "owner_name",
        value: contactName,
        sourceUrl: nameCheck.evidence[0].url,
        sourceKind: "website",
        excerpt: nameCheck.evidence[0].excerpt ?? null,
        status: "verified",
      });
    } else {
      facts.push({
        kind: "owner_name",
        value: contactName,
        sourceUrl: options.contactNameSourceUrl ?? "",
        sourceKind: "agent_research",
        excerpt: null,
        status: "unverified",
      });
    }
  }

  const marketplace = byKey.get("marketplace_presence");
  if (marketplace?.outcome === "pass") {
    for (const evidence of marketplace.evidence) {
      const label = evidence.excerpt?.split(" link on ")[0]?.trim();
      if (!label) continue;
      facts.push({ kind: "marketplace", value: label, sourceUrl: evidence.url, sourceKind: "website", excerpt: evidence.excerpt ?? null, status: "verified" });
    }
  }

  const social = byKey.get("social_handles");
  if (social?.outcome === "pass") {
    for (const evidence of social.evidence) {
      const handle = evidence.excerpt?.split(" linked from ")[0]?.trim();
      if (!handle) continue;
      facts.push({ kind: "social", value: handle, sourceUrl: evidence.url, sourceKind: "website", excerpt: evidence.excerpt ?? null, status: "verified" });
    }
  }

  if (placesResult?.match) {
    const rating = placesFact(placesResult.match);
    if (rating) facts.push(rating);
  }

  const wedding = byKey.get("wedding_signal");
  const mentions = typeof wedding?.data?.mentions === "number" ? wedding.data.mentions : 0;
  if (mentions > 0 && homepage) {
    facts.push({
      kind: "wedding_signal",
      value: `mentions weddings ${mentions} time${mentions === 1 ? "" : "s"}`,
      sourceUrl: wedding?.evidence[0]?.url ?? homepage,
      sourceKind: "website",
      excerpt: wedding?.evidence[0]?.excerpt ?? null,
      status: "verified",
    });
  }

  return facts.filter((fact) => fact.value.trim().length > 0);
}

/* ————— Persistence ————— */

export async function loadVetting(prospectId: number): Promise<ControlProspectVetting | null> {
  const [row] = await db
    .select()
    .from(controlProspectVettingTable)
    .where(eq(controlProspectVettingTable.prospectId, prospectId))
    .limit(1);
  return row ?? null;
}

/** A verdict is fresh when it is not an error and has not expired. */
export function vettingIsFresh(row: Pick<ControlProspectVetting, "status" | "expiresAt">, now: Date = new Date()): boolean {
  return row.status !== "error" && now.getTime() < row.expiresAt.getTime();
}

export function isOperatorOverride(row: Pick<ControlProspectVetting, "vettedBy">): boolean {
  return row.vettedBy.startsWith("override:");
}

/** Places text searches recorded today (UTC) as audit events. */
export async function placesCallsToday(now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(controlAuditEventsTable)
    .where(and(eq(controlAuditEventsTable.eventType, PLACES_LOOKUP_EVENT), gte(controlAuditEventsTable.createdAt, startOfUtcDay(now))));
  return row?.total ?? 0;
}

function expiresAfter(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + Math.max(1, ttlDays) * 24 * 60 * 60 * 1000);
}

async function writeVettingRow(
  prospectId: number,
  values: Omit<typeof controlProspectVettingTable.$inferInsert, "id" | "prospectId" | "createdAt" | "updatedAt">,
): Promise<ControlProspectVetting> {
  const now = new Date();
  const [row] = await db
    .insert(controlProspectVettingTable)
    .values({ prospectId, ...values })
    .onConflictDoUpdate({
      target: controlProspectVettingTable.prospectId,
      set: { ...values, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error(`Failed to persist vetting for prospect ${prospectId}.`);
  await db
    .update(controlProspectsTable)
    .set({ vettingStatus: row.status, legitimacyScore: row.score, vettedAt: row.vettedAt, updatedAt: now })
    .where(eq(controlProspectsTable.id, prospectId));
  return row;
}

/**
 * Status enforcement: failed demotes new/qualified to disqualified; review
 * demotes qualified to new; error and passed never change the status.
 */
async function enforceProspectStatus(
  prospectId: number,
  vettingStatus: VettingStatus,
  summary: string,
  actor: string,
): Promise<{ from: string; to: string } | null> {
  if (vettingStatus !== "failed" && vettingStatus !== "review") return null;
  const [prospect] = await db
    .select({ status: controlProspectsTable.status, qualification: controlProspectsTable.qualification })
    .from(controlProspectsTable)
    .where(eq(controlProspectsTable.id, prospectId));
  if (!prospect) return null;
  let next: string | null = null;
  if (vettingStatus === "failed" && (prospect.status === "new" || prospect.status === "qualified")) next = "disqualified";
  if (vettingStatus === "review" && prospect.status === "qualified") next = "new";
  if (!next) return null;
  const now = new Date();
  const note = `\n[vetting ${now.toISOString()}] ${vettingStatus}: ${vettingStatus === "review" ? "needs operator review. " : ""}${summary}`;
  await db
    .update(controlProspectsTable)
    .set({
      status: next,
      statusChangedBy: actor,
      qualification: `${prospect.qualification ?? ""}${note}`.trim(),
      updatedAt: now,
    })
    .where(eq(controlProspectsTable.id, prospectId));
  await recordAuditEvent({
    actorType: actor.startsWith("operator:") ? "operator" : "system",
    actor,
    eventType: "prospect_status_forced_by_vetting",
    subjectType: "prospect",
    subjectId: prospectId,
    detail: { from: prospect.status, to: next, vettingStatus, summary },
  });
  return { from: prospect.status, to: next };
}

export interface EnsureVettedOptions {
  /** Re-run the checks even when a fresh verdict exists (never replaces a fresh operator override). */
  force?: boolean;
  /** Agent key, operator:<email>, or system:<component>; goes into the audit event, never into vetted_by. */
  requestedBy: string;
  deps?: VettingDeps;
}

/**
 * Return the stored verdict when it is fresh (always for a fresh operator
 * override); otherwise run vetting, persist it, write facts, apply status
 * enforcement and audit the run.
 */
export async function ensureVetted(
  prospect: ControlProspect,
  options: EnsureVettedOptions,
): Promise<{ vetting: ControlProspectVetting; refreshed: boolean }> {
  const existing = await loadVetting(prospect.id);
  if (existing) {
    const now = new Date();
    if (isOperatorOverride(existing) && vettingIsFresh(existing, now)) return { vetting: existing, refreshed: false };
    if (!options.force && vettingIsFresh(existing, now)) return { vetting: existing, refreshed: false };
  }

  const policy = await loadVettingPolicy();
  const factRows = await loadFacts(prospect.id);
  const emailFact = factRows.find((row) => row.kind === "email" && row.sourceKind === "agent_research");
  const nameFact = factRows.find((row) => row.kind === "owner_name" && row.sourceKind === "agent_research");

  let deps = options.deps ?? defaultVettingDeps();
  let placesSkipDetail: string | undefined;
  if (deps.placesSearch) {
    const cap = placesDailyCap();
    const used = await placesCallsToday(deps.now());
    if (used >= cap) {
      deps = { ...deps, placesSearch: undefined };
      placesSkipDetail = `daily Places cap reached (${cap}); re-vet tomorrow or raise VETTING_PLACES_DAILY_CAP`;
    } else {
      const inner = deps.placesSearch;
      deps = {
        ...deps,
        placesSearch: async (input) => {
          await recordAuditEvent({
            actorType: "system",
            actor: "vetting",
            eventType: PLACES_LOOKUP_EVENT,
            subjectType: "prospect",
            subjectId: prospect.id,
            detail: { name: input.name, websiteDomain: input.websiteDomain },
          });
          return inner(input);
        },
      };
    }
  }

  const result = await runVetting(prospect, {
    emailSourceUrl: emailFact?.sourceUrl || null,
    contactNameSourceUrl: nameFact?.sourceUrl || null,
    policy,
    deps,
    placesSkipDetail,
  });
  const now = deps.now();
  const row = await writeVettingRow(prospect.id, {
    status: result.status,
    score: result.score,
    tier: result.tier,
    hardFails: result.hardFails,
    checks: result.checks as unknown as Array<Record<string, unknown>>,
    summary: result.summary,
    contactDomain: result.contactDomain,
    mxProvider: result.mxProvider,
    domainRegisteredAt: result.domainRegisteredAt,
    firstCaptureAt: result.firstCaptureAt,
    placesPlaceId: result.placesPlaceId,
    vettedAt: now,
    expiresAt: expiresAfter(now, policy.ttlDays),
    vettedBy: SYSTEM_VETTED_BY,
  });
  try {
    await upsertFacts(prospect.id, result.facts, SYSTEM_VETTED_BY);
  } catch (err) {
    logger.error({ err, prospectId: prospect.id }, "Vetting: failed to persist facts");
  }
  await recordAuditEvent({
    actorType: "system",
    actor: SYSTEM_VETTED_BY,
    eventType: "prospect_vetted",
    subjectType: "prospect",
    subjectId: prospect.id,
    detail: {
      status: result.status,
      score: result.score,
      hardFails: result.hardFails,
      tier: result.tier,
      requestedBy: options.requestedBy,
    },
  });
  await enforceProspectStatus(prospect.id, result.status, result.summary, SYSTEM_VETTED_BY);
  return { vetting: row, refreshed: true };
}

/** Operator decision: replaces the verdict, keeps the evidence, audits, enforces status on fail. */
export async function overrideVetting(
  prospectId: number,
  decision: "pass" | "fail",
  note: string,
  operatorEmail: string,
): Promise<ControlProspectVetting> {
  const [prospect] = await db.select().from(controlProspectsTable).where(eq(controlProspectsTable.id, prospectId));
  if (!prospect) throw new Error(`Prospect ${prospectId} not found.`);
  const existing = await loadVetting(prospectId);
  const now = new Date();
  const ttlDays = vettingTtlDays();
  const status: VettingStatus = decision === "pass" ? "passed" : "failed";
  const previousSummary = existing?.summary ?? "";
  const summary = `Operator override (${operatorEmail}): ${note.trim()}. ${previousSummary}`.trim();
  const row = await writeVettingRow(prospectId, {
    status,
    score: existing?.score ?? 0,
    tier: existing?.tier ?? "A",
    hardFails: decision === "fail" ? ["operator_override"] : [],
    checks: existing?.checks ?? [],
    summary,
    contactDomain: existing?.contactDomain ?? splitEmail(prospect.email)?.domain ?? "",
    mxProvider: existing?.mxProvider ?? null,
    domainRegisteredAt: existing?.domainRegisteredAt ?? null,
    firstCaptureAt: existing?.firstCaptureAt ?? null,
    placesPlaceId: existing?.placesPlaceId ?? null,
    vettedAt: now,
    expiresAt: expiresAfter(now, ttlDays),
    vettedBy: `override:${operatorEmail}`,
  });
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "prospect_vetting_overridden",
    subjectType: "prospect",
    subjectId: prospectId,
    detail: { decision, note, previousStatus: existing?.status ?? "unvetted" },
  });
  if (decision === "fail") {
    await enforceProspectStatus(prospectId, "failed", summary, `operator:${operatorEmail}`);
  }
  return row;
}

/* ————— The gate ————— */

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

/** Throws unless the stored verdict is a fresh "passed" (exact messages are matched by tests and operators). */
export function assertVettingAllowsOutreach(
  row: Pick<ControlProspectVetting, "status" | "score" | "summary" | "expiresAt"> | null,
  prospectId: number,
  now: Date = new Date(),
): void {
  if (!row) {
    throw new VettingGateError(
      "unvetted",
      `Prospect ${prospectId} has not been vetted; run vetting from Pipeline → Evidence or wait for the prospecting agent.`,
    );
  }
  if (row.status === "failed") {
    throw new VettingGateError("failed", `Prospect ${prospectId} failed legitimacy vetting and may not be emailed: ${row.summary}`);
  }
  if (row.status === "review") {
    throw new VettingGateError(
      "review",
      `Prospect ${prospectId} scored ${row.score}/100 on legitimacy and needs an operator decision (Pipeline → Evidence → Override).`,
    );
  }
  if (row.status === "error") {
    throw new VettingGateError("error", `Vetting for prospect ${prospectId} could not complete (${row.summary}); re-run it before drafting.`);
  }
  if (row.status !== "passed") {
    throw new VettingGateError(
      "unvetted",
      `Prospect ${prospectId} has not been vetted; run vetting from Pipeline → Evidence or wait for the prospecting agent.`,
    );
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    throw new VettingGateError("expired", `Vetting for prospect ${prospectId} expired on ${row.expiresAt.toISOString()}; re-run it.`);
  }
}

/* ————— Compatibility wrapper (step-0 seam) ————— */

export interface VetProspectOptions {
  force?: boolean;
  requestedBy: string;
  deps?: VettingDeps;
}

export interface VetProspectOutcome {
  status: VettingStatus;
  score: number | null;
  hardFails: string[];
  summary: string;
  /** True when the checks actually ran (false for cache hits). */
  refreshed: boolean;
}

/** Thin wrapper over ensureVetted returning the compact shape agents read. */
export async function vetProspect(prospect: ControlProspect, options: VetProspectOptions): Promise<VetProspectOutcome> {
  const { vetting, refreshed } = await ensureVetted(prospect, options);
  return {
    status: vetting.status as VettingStatus,
    score: vetting.score,
    hardFails: vetting.hardFails,
    summary: vetting.summary,
    refreshed,
  };
}
