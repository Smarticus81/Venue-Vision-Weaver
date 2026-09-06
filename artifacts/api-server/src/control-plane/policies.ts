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
    key: "auto_execute_low_risk",
    value: { enabled: true },
    description: "Whether low-risk actions execute immediately without operator approval.",
  },
];

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
