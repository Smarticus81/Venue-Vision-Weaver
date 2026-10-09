import { db, controlPoliciesTable, type ControlPolicy } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Governance policies bound the blast radius of autonomous actions. They are
 * stored as rows so the governance agent (with approval) and operators can
 * tune them at runtime without a deploy.
 */
export const POLICY_DEFAULTS: Array<{
  key: string;
  value: Record<string, unknown>;
  description: string;
}> = [
  {
    key: "max_credit_grant_per_action",
    value: { credits: 10 },
    description: "Maximum credits a single grant_promo_credits action may issue.",
  },
  {
    key: "max_credit_grants_per_day",
    value: { credits: 30 },
    description: "Maximum total promo credits the control plane may issue per UTC day.",
  },
  {
    key: "max_outbound_emails_per_day",
    value: { emails: 25 },
    description: "Maximum venue-facing emails the control plane may send per UTC day.",
  },
  {
    key: "max_prospect_emails_per_day",
    value: { emails: 15 },
    description: "Maximum prospect outreach emails the control plane may send per UTC day.",
  },
  {
    key: "min_hours_between_prospect_contacts",
    value: { hours: 72 },
    description: "Minimum gap between two emails to the same prospect.",
  },
  {
    key: "max_contacts_per_prospect",
    value: { contacts: 3 },
    description:
      "Lifetime cap of automated emails per prospect (first touch plus follow-ups); replies and opt-outs stop contact immediately.",
  },
  {
    key: "autonomous_mode",
    value: { enabled: true },
    description:
      "When true the control plane acts on its own: every action except policy changes executes without operator approval, inside the caps, kill switches, vetting and send-time checks. When false (supervised) medium/high-risk actions wait for an operator.",
  },
  {
    key: "auto_execute_low_risk",
    value: { enabled: true },
    description: "Supervised mode only: whether low-risk actions execute immediately without operator approval.",
  },
  // --- kill switches and spend (synthesis / step 0) ---
  {
    key: "agents_enabled",
    value: { enabled: true },
    description: "Master switch: when false the scheduler starts no agent runs (manual runs included).",
  },
  {
    key: "outreach_sends_enabled",
    value: { enabled: true },
    description: "Master switch for prospect outreach delivery; when false sendOutreachEmail refuses every send.",
  },
  {
    key: "max_daily_ai_usd",
    value: { usd: 25 },
    description: "Estimated Grok spend cap per UTC day across all agent runs; the scheduler stops starting runs once reached.",
  },
  // --- vetting (vetting.md 6.1) ---
  {
    key: "vetting_pass_score",
    value: { score: 60 },
    description:
      "Minimum legitimacy score (0-100) for a prospect to be eligible for outreach without an operator override.",
  },
  {
    key: "vetting_review_score",
    value: { score: 40 },
    description:
      "Prospects scoring between this and vetting_pass_score wait for an operator decision; below it they fail.",
  },
  {
    key: "vetting_blocked_countries",
    value: { codes: "CA" },
    description:
      "Comma-separated ISO-2 country codes excluded from outreach (CASL etc.) until legal review.",
  },
  {
    key: "outreach_require_reply_to",
    value: { enabled: true },
    description: "Refuse prospect sends unless OUTREACH_REPLY_TO is a monitored mailbox on the sending domain.",
  },
  {
    key: "max_prospect_emails_per_day_base",
    value: { emails: 15 },
    description:
      "Operator-set daily prospect cap; the deliverability guard restores max_prospect_emails_per_day to this value.",
  },
  {
    key: "deliverability_guard",
    value: { status: "ok", since: null, reason: null, okDays: 0 },
    description:
      "Automatic send-cap state driven by bounces and complaints. 'paused' needs an operator reset.",
  },
  // --- growth loop (growth-loop.md 9.1) ---
  {
    key: "segment_guidance",
    value: { prioritize: [], pause: [], updatedAt: null },
    description: "Deterministic segment ranking injected into prospecting/outreach/campaign briefings.",
  },
  {
    key: "max_campaign_steps",
    value: { steps: 3 },
    description:
      "Maximum touches per campaign (create_campaign truncates; drafts and sends above it are refused).",
  },
  {
    key: "lifecycle_email_auto_send",
    value: { enabled: false },
    description: "Supervised mode only: when true, trial lifecycle emails execute without approval.",
  },
  {
    key: "max_lifecycle_emails_per_day",
    value: { emails: 50 },
    description: "Daily cap for send_lifecycle_email.",
  },
];

/* ————— Operator / agent edits: per-key validation ————— */

type PolicyFieldRule =
  | { kind: "integer"; min: number; max: number }
  | { kind: "number"; min: number; max: number }
  | { kind: "boolean" }
  | { kind: "string"; pattern?: RegExp; maxLength: number; hint?: string }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "nullable_string"; maxLength: number }
  | { kind: "array" };

/**
 * The editable field(s) of every policy and their bounds. Keys absent here
 * are system-managed (deliverability_guard, segment_guidance) and refuse
 * direct edits; those move only through sendingHealth.ts / growth rules.
 */
const POLICY_FIELD_RULES: Record<string, Record<string, PolicyFieldRule>> = {
  max_credit_grant_per_action: { credits: { kind: "integer", min: 0, max: 100 } },
  max_credit_grants_per_day: { credits: { kind: "integer", min: 0, max: 500 } },
  max_outbound_emails_per_day: { emails: { kind: "integer", min: 0, max: 500 } },
  max_prospect_emails_per_day: { emails: { kind: "integer", min: 0, max: 200 } },
  max_prospect_emails_per_day_base: { emails: { kind: "integer", min: 1, max: 200 } },
  min_hours_between_prospect_contacts: { hours: { kind: "integer", min: 24, max: 24 * 60 } },
  max_contacts_per_prospect: { contacts: { kind: "integer", min: 1, max: 6 } },
  autonomous_mode: { enabled: { kind: "boolean" } },
  auto_execute_low_risk: { enabled: { kind: "boolean" } },
  agents_enabled: { enabled: { kind: "boolean" } },
  outreach_sends_enabled: { enabled: { kind: "boolean" } },
  outreach_require_reply_to: { enabled: { kind: "boolean" } },
  max_daily_ai_usd: { usd: { kind: "number", min: 0, max: 1000 } },
  vetting_pass_score: { score: { kind: "integer", min: 0, max: 100 } },
  vetting_review_score: { score: { kind: "integer", min: 0, max: 100 } },
  vetting_blocked_countries: {
    codes: {
      kind: "string",
      pattern: /^(\s*[A-Za-z]{2}\s*(,\s*[A-Za-z]{2}\s*)*)?$/,
      maxLength: 400,
      hint: "comma-separated ISO-2 country codes, e.g. \"CA, GB\"",
    },
  },
  max_campaign_steps: { steps: { kind: "integer", min: 1, max: 4 } },
  lifecycle_email_auto_send: { enabled: { kind: "boolean" } },
  max_lifecycle_emails_per_day: { emails: { kind: "integer", min: 0, max: 500 } },
};

/** Keys whose value is written only by code (guard transitions, adaptation rules). */
export const SYSTEM_MANAGED_POLICY_KEYS: readonly string[] = ["deliverability_guard", "segment_guidance"];

export const POLICY_KEYS: readonly string[] = POLICY_DEFAULTS.map((policy) => policy.key);

export type PolicyValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

function describeRule(field: string, rule: PolicyFieldRule): string {
  switch (rule.kind) {
    case "integer":
      return `${field}: integer between ${rule.min} and ${rule.max}`;
    case "number":
      return `${field}: number between ${rule.min} and ${rule.max}`;
    case "boolean":
      return `${field}: true or false`;
    case "string":
      return `${field}: ${rule.hint ?? `string up to ${rule.maxLength} characters`}`;
    case "enum":
      return `${field}: one of ${rule.values.join(", ")}`;
    case "nullable_string":
      return `${field}: string up to ${rule.maxLength} characters or null`;
    case "array":
      return `${field}: array`;
  }
}

/**
 * Validate an operator/agent edit of one policy. Pure: no database access.
 * Returns the normalized value to store (only the known fields, coerced) or
 * a one-sentence error naming the expected field and bounds. Policies with
 * no entry in POLICY_FIELD_RULES refuse edits.
 */
export function validatePolicyUpdate(key: string, value: unknown): PolicyValidation {
  if (!POLICY_KEYS.includes(key)) {
    return { ok: false, error: `Unknown policy "${key}". Known keys: ${POLICY_KEYS.join(", ")}.` };
  }
  if (SYSTEM_MANAGED_POLICY_KEYS.includes(key)) {
    return {
      ok: false,
      error: `Policy "${key}" is managed by the system (deliverability guard / adaptation rules) and cannot be edited directly.`,
    };
  }
  const rules = POLICY_FIELD_RULES[key];
  if (!rules) {
    return { ok: false, error: `Policy "${key}" has no editable fields.` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `Policy "${key}" value must be an object: { ${Object.keys(rules).join(", ")} }.` };
  }
  const input = value as Record<string, unknown>;
  const expected = Object.entries(rules).map(([field, rule]) => describeRule(field, rule));
  const unknownFields = Object.keys(input).filter((field) => !(field in rules));
  if (unknownFields.length > 0) {
    return {
      ok: false,
      error: `Policy "${key}" does not have field(s) ${unknownFields.join(", ")}. Expected ${expected.join("; ")}.`,
    };
  }
  const normalized: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(rules)) {
    if (!(field in input)) {
      return { ok: false, error: `Policy "${key}" requires ${describeRule(field, rule)}.` };
    }
    const raw = input[field];
    switch (rule.kind) {
      case "integer": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (typeof raw === "boolean" || !Number.isInteger(n) || n < rule.min || n > rule.max) {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = n;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (typeof raw === "boolean" || !Number.isFinite(n) || n < rule.min || n > rule.max) {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = n;
        break;
      }
      case "boolean": {
        if (typeof raw !== "boolean") {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = raw;
        break;
      }
      case "string": {
        if (typeof raw !== "string" || raw.length > rule.maxLength || (rule.pattern && !rule.pattern.test(raw))) {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = raw.trim();
        break;
      }
      case "enum": {
        if (typeof raw !== "string" || !rule.values.includes(raw)) {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = raw;
        break;
      }
      case "nullable_string": {
        if (raw !== null && (typeof raw !== "string" || raw.length > rule.maxLength)) {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = raw;
        break;
      }
      case "array": {
        if (!Array.isArray(raw)) {
          return { ok: false, error: `Policy "${key}": ${describeRule(field, rule)}.` };
        }
        normalized[field] = raw;
        break;
      }
    }
  }
  return { ok: true, value: normalized };
}

export async function ensurePolicyDefaults(): Promise<void> {
  for (const policy of POLICY_DEFAULTS) {
    await db
      .insert(controlPoliciesTable)
      .values({ key: policy.key, value: policy.value, description: policy.description })
      .onConflictDoNothing({ target: controlPoliciesTable.key });
  }
}

export async function getPolicy(key: string): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ value: controlPoliciesTable.value })
    .from(controlPoliciesTable)
    .where(eq(controlPoliciesTable.key, key));
  return row?.value ?? POLICY_DEFAULTS.find((p) => p.key === key)?.value ?? null;
}

export async function getPolicyNumber(key: string, field: string, fallback: number): Promise<number> {
  const value = await getPolicy(key);
  const n = Number((value as Record<string, unknown> | null)?.[field]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function getPolicyBoolean(key: string, field: string, fallback: boolean): Promise<boolean> {
  const value = await getPolicy(key);
  const raw = (value as Record<string, unknown> | null)?.[field];
  return typeof raw === "boolean" ? raw : fallback;
}

export async function listPolicies(): Promise<ControlPolicy[]> {
  return db.select().from(controlPoliciesTable).orderBy(controlPoliciesTable.key);
}

export async function setPolicy(
  key: string,
  value: Record<string, unknown>,
): Promise<ControlPolicy | null> {
  const [updated] = await db
    .insert(controlPoliciesTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: controlPoliciesTable.key,
      set: { value, updatedAt: new Date() },
    })
    .returning();
  if (!updated) {
    logger.warn({ key }, "Policy upsert returned no row");
    return null;
  }
  return updated;
}
