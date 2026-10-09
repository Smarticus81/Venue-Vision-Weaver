import { db, controlProspectFactsTable, type ControlProspectFact } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { recordAuditEvent } from "../audit.js";
import type { VenueFacts } from "../outreach/venueResearch.js";
import { excerptAround } from "./checks.js";
import { CITABLE_FACT_KINDS, FACT_KINDS, type CitableFact, type DiscoveredFact, type FactKind } from "./types.js";

/**
 * control_prospect_facts: every fact about a venue carries the URL it was
 * seen at. Research attribution, vetting, the prospecting agent and operators
 * all write here; the copywriter may cite only "verified" rows, and only the
 * kinds in CITABLE_FACT_KINDS (vetting.md 1.9).
 */

/** Direct observations may re-verify or downgrade a fact; agent claims never un-verify one. */
const DIRECT_SOURCE_KINDS = new Set(["website", "json_ld", "places"]);

/** Kinds an operator may add by hand (with a source URL). */
export const OPERATOR_FACT_KINDS: FactKind[] = [
  "space",
  "location",
  "capacity",
  "style",
  "owner_name",
  "phone",
  "address",
  "marketplace",
  "social",
];

const FACT_KIND_SET = new Set<string>(FACT_KINDS);

export function isFactKind(value: unknown): value is FactKind {
  return typeof value === "string" && FACT_KIND_SET.has(value);
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function factKey(kind: string, value: string): string {
  return `${kind}\u0000${value}`;
}

export async function loadFacts(prospectId: number): Promise<ControlProspectFact[]> {
  return db
    .select()
    .from(controlProspectFactsTable)
    .where(eq(controlProspectFactsTable.prospectId, prospectId))
    .orderBy(controlProspectFactsTable.kind, controlProspectFactsTable.id);
}

/**
 * Insert or refresh facts. Conflict key is (prospectId, kind, value). A
 * verified row is only downgraded by a fresh direct observation
 * (website/json_ld/places); agent_research can add rows but never un-verify
 * one. Operator rows are never touched by automatic writes.
 */
export async function upsertFacts(prospectId: number, facts: DiscoveredFact[], actor: string): Promise<void> {
  const clean = facts
    .map((fact) => ({ ...fact, value: fact.value.replace(/\s+/g, " ").trim() }))
    .filter((fact) => fact.value.length >= 1 && fact.value.length <= 400 && isFactKind(fact.kind));
  if (clean.length === 0) return;

  // Dedupe within the batch: a verified observation beats an unverified one for the same (kind, value).
  const batch = new Map<string, DiscoveredFact>();
  for (const fact of clean) {
    const key = factKey(fact.kind, fact.value);
    const current = batch.get(key);
    if (!current || (current.status !== "verified" && fact.status === "verified")) batch.set(key, fact);
  }

  const existing = await loadFacts(prospectId);
  const byKey = new Map(existing.map((row) => [factKey(row.kind, row.value), row]));
  const now = new Date();

  for (const fact of batch.values()) {
    const current = byKey.get(factKey(fact.kind, fact.value));
    if (!current) {
      await db
        .insert(controlProspectFactsTable)
        .values({
          prospectId,
          kind: fact.kind,
          value: fact.value,
          sourceUrl: fact.sourceUrl,
          sourceKind: fact.sourceKind,
          excerpt: fact.excerpt ?? null,
          status: fact.status,
          verifiedAt: fact.status === "verified" ? now : null,
          createdBy: actor,
        })
        .onConflictDoNothing();
      continue;
    }
    if (current.sourceKind === "operator") continue;
    const direct = DIRECT_SOURCE_KINDS.has(fact.sourceKind);
    const keepVerified = current.status === "verified" && fact.status !== "verified" && !direct;
    if (keepVerified) {
      // Only the agent's citation may be refreshed; the verified source stays.
      continue;
    }
    await db
      .update(controlProspectFactsTable)
      .set({
        sourceUrl: fact.sourceUrl || current.sourceUrl,
        sourceKind: fact.sourceKind,
        excerpt: fact.excerpt ?? current.excerpt ?? null,
        status: fact.status,
        verifiedAt: fact.status === "verified" ? now : null,
        updatedAt: now,
      })
      .where(eq(controlProspectFactsTable.id, current.id));
  }
}

/* ————— Pure attribution and citation rules ————— */

function cityToken(location: string): string | null {
  const city = location.split(",")[0]?.trim().toLowerCase() ?? "";
  return city.length >= 3 ? city : null;
}

function stripArticle(value: string): string {
  return value.replace(/^the\s+/i, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capacityNumber(value: string | number): string | null {
  const match = String(value).match(/\d{2,4}/);
  return match ? match[0] : null;
}

function capacityNeedle(text: string, capacity: string): RegExpMatchArray | null {
  return text.match(new RegExp(`\\b${capacity}\\b[\\s\\S]{0,12}?(guests|people|persons|seated|standing)`, "i"));
}

function styleGrounded(text: string, style: string): boolean {
  const words = style.toLowerCase().split(/[^a-z0-9'’]+/).filter((word) => word.length > 3);
  if (words.length === 0) return false;
  const hits = words.filter((word) => text.includes(word)).length;
  return hits / words.length >= 0.6;
}

/**
 * For each research fact, find the first page whose text contains it and
 * record page + excerpt (status verified). Facts no page states stay
 * unverified, attributed to the homepage. No pages -> nothing to attribute.
 */
export function attributeFacts(facts: VenueFacts, pages: Array<{ url: string; text: string }>): DiscoveredFact[] {
  if (pages.length === 0) return [];
  const lowered = pages.map((page) => ({ url: page.url, text: page.text, lower: page.text.toLowerCase() }));
  const homepage = pages[0]!.url;
  const out: DiscoveredFact[] = [];

  const locate = (
    kind: FactKind,
    value: string,
    find: (page: { url: string; text: string; lower: string }) => string | null,
  ): void => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) return;
    for (const page of lowered) {
      const needle = find(page);
      if (needle !== null) {
        out.push({
          kind,
          value: clean,
          sourceUrl: page.url,
          sourceKind: "website",
          excerpt: excerptAround(page.text, needle) || null,
          status: "verified",
        });
        return;
      }
    }
    out.push({ kind, value: clean, sourceUrl: homepage, sourceKind: "website", excerpt: null, status: "unverified" });
  };

  if (facts.name) {
    const name = facts.name;
    locate("venue_name", name, (page) => (page.lower.includes(name.toLowerCase()) ? name : null));
  }
  for (const space of facts.spaces) {
    const bare = stripArticle(space);
    if (bare.length < 3) continue;
    locate("space", space, (page) => (page.lower.includes(bare.toLowerCase()) ? bare : null));
  }
  if (facts.location) {
    const city = cityToken(facts.location);
    locate("location", facts.location, (page) => (city && page.lower.includes(city) ? city : null));
  }
  if (facts.capacity != null) {
    const capacity = capacityNumber(facts.capacity);
    if (capacity) {
      locate("capacity", String(facts.capacity), (page) => {
        const match = capacityNeedle(page.text, capacity);
        return match ? match[0] : null;
      });
    }
  }
  if (facts.style) {
    const style = facts.style;
    locate("style", style, (page) => {
      if (!styleGrounded(page.lower, style)) return null;
      const firstWord = style.toLowerCase().split(/[^a-z0-9'’]+/).find((word) => word.length > 3 && page.lower.includes(word));
      return firstWord ?? style;
    });
  }
  return out;
}

const CITABLE_ORDER: Record<string, number> = { owner_name: 0, space: 1, location: 2, capacity: 3 };

/** Verified rows of citable kinds; deduped by (kind, value); at most 6 spaces; stable order owner_name, spaces, location, capacity. */
export function citableFacts(rows: Array<Pick<ControlProspectFact, "kind" | "value" | "sourceUrl" | "status">>): CitableFact[] {
  const seen = new Set<string>();
  const out: CitableFact[] = [];
  let spaces = 0;
  const sorted = [...rows].sort((a, b) => (CITABLE_ORDER[a.kind] ?? 9) - (CITABLE_ORDER[b.kind] ?? 9));
  for (const row of sorted) {
    if (row.status !== "verified") continue;
    if (!CITABLE_FACT_KINDS.includes(row.kind as FactKind)) continue;
    const key = `${row.kind}\u0000${row.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (row.kind === "space") {
      if (spaces >= 6) continue;
      spaces += 1;
    }
    seen.add(key);
    out.push({ kind: row.kind as FactKind, value: row.value, sourceUrl: row.sourceUrl });
  }
  return out;
}

/**
 * Which verified facts does this copy actually use? space: body names it
 * (minus "the"); location: body names the city; capacity: the number as a
 * whole word; owner_name: greeting carries the first name.
 */
export function citedFactsIn(copy: { greeting: string; body: string }, facts: CitableFact[]): CitableFact[] {
  const body = copy.body.toLowerCase();
  const greeting = copy.greeting.toLowerCase();
  const seen = new Set<string>();
  const cited: CitableFact[] = [];
  for (const fact of facts) {
    const key = `${fact.kind}\u0000${fact.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    let hit = false;
    switch (fact.kind) {
      case "space": {
        const needle = stripArticle(fact.value).toLowerCase();
        hit = needle.length >= 3 && body.includes(needle);
        break;
      }
      case "location": {
        const city = cityToken(fact.value);
        hit = Boolean(city && new RegExp(`\\b${escapeRegExp(city)}\\b`, "i").test(body));
        break;
      }
      case "capacity": {
        const number = capacityNumber(fact.value);
        hit = Boolean(number && new RegExp(`\\b${number}\\b`).test(body));
        break;
      }
      case "owner_name": {
        const first = fact.value.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        hit = first.length >= 2 && new RegExp(`\\b${escapeRegExp(first)}\\b`, "i").test(greeting);
        break;
      }
      default:
        hit = false;
    }
    if (hit) {
      seen.add(key);
      cited.push(fact);
    }
  }
  return cited;
}

/* ————— Operator edits ————— */

export async function addOperatorFact(
  prospectId: number,
  input: { kind: string; value: string; sourceUrl: string },
  operatorEmail: string,
): Promise<ControlProspectFact> {
  if (!isFactKind(input.kind) || !OPERATOR_FACT_KINDS.includes(input.kind)) {
    throw new Error(`kind must be one of ${OPERATOR_FACT_KINDS.join(", ")}.`);
  }
  const value = input.value.replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > 160) throw new Error("value must be 2-160 characters.");
  if (!isHttpUrl(input.sourceUrl)) throw new Error("sourceUrl must be an http(s) URL where the fact can be seen.");
  const sourceUrl = input.sourceUrl.trim();
  const now = new Date();
  const actor = `operator:${operatorEmail}`;
  const [row] = await db
    .insert(controlProspectFactsTable)
    .values({
      prospectId,
      kind: input.kind,
      value,
      sourceUrl,
      sourceKind: "operator",
      excerpt: null,
      status: "verified",
      verifiedAt: now,
      createdBy: actor,
    })
    .onConflictDoUpdate({
      target: [controlProspectFactsTable.prospectId, controlProspectFactsTable.kind, controlProspectFactsTable.value],
      set: { sourceUrl, sourceKind: "operator", status: "verified", verifiedAt: now, updatedAt: now },
    })
    .returning();
  if (!row) throw new Error("Failed to save the fact.");
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "prospect_fact_added",
    subjectType: "prospect",
    subjectId: prospectId,
    detail: { factId: row.id, kind: input.kind, value, sourceUrl },
  });
  return row;
}

export async function removeFact(prospectId: number, factId: number, operatorEmail: string): Promise<boolean> {
  const deleted = await db
    .delete(controlProspectFactsTable)
    .where(and(eq(controlProspectFactsTable.id, factId), eq(controlProspectFactsTable.prospectId, prospectId)))
    .returning({ id: controlProspectFactsTable.id, kind: controlProspectFactsTable.kind, value: controlProspectFactsTable.value });
  if (deleted.length === 0) return false;
  await recordAuditEvent({
    actorType: "operator",
    actor: operatorEmail,
    eventType: "prospect_fact_removed",
    subjectType: "prospect",
    subjectId: prospectId,
    detail: { factId, kind: deleted[0]!.kind, value: deleted[0]!.value },
  });
  return true;
}
