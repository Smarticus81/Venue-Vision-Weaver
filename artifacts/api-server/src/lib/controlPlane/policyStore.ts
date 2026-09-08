import { and, eq } from "drizzle-orm";
import { db, controlPlanePoliciesTable } from "@workspace/db";
import {
  DEFAULT_POLICY,
  POLICY_KEYS,
  coercePolicyValue,
  type ControlPlanePolicy,
} from "@workspace/control-plane";
import { logger } from "../logger.js";

/**
 * Policy is stored one row per key so a single guardrail can be changed (and
 * audited) without rewriting the whole document, and so a key added in a
 * later release falls back to its default instead of reading as `undefined`.
 */
export async function loadPolicy(organizationId: number): Promise<ControlPlanePolicy> {
  const rows = await db
    .select()
    .from(controlPlanePoliciesTable)
    .where(eq(controlPlanePoliciesTable.organizationId, organizationId));

  const policy: ControlPlanePolicy = { ...DEFAULT_POLICY };
  for (const row of rows) {
    if (!(POLICY_KEYS as string[]).includes(row.key)) continue;
    const key = row.key as keyof ControlPlanePolicy;
    const value = coercePolicyValue(key, row.value);
    if (value === undefined) {
      logger.warn({ organizationId, key, stored: row.value }, "Ignoring malformed control plane policy value");
      continue;
    }
    // Each branch is a single key so the union stays sound.
    Object.assign(policy, { [key]: value });
  }
  return policy;
}

export async function setPolicyValue(
  organizationId: number,
  key: keyof ControlPlanePolicy,
  value: unknown,
  updatedBy: string,
): Promise<ControlPlanePolicy> {
  const coerced = coercePolicyValue(key, value);
  if (coerced === undefined) {
    throw new Error(`Invalid value for control plane policy "${String(key)}"`);
  }
  await db
    .insert(controlPlanePoliciesTable)
    .values({ organizationId, key: String(key), value: coerced as unknown, updatedBy })
    .onConflictDoUpdate({
      target: [controlPlanePoliciesTable.organizationId, controlPlanePoliciesTable.key],
      set: { value: coerced as unknown, updatedBy, updatedAt: new Date() },
    });
  return loadPolicy(organizationId);
}

export async function policyUpdatedAt(organizationId: number, key: string): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: controlPlanePoliciesTable.updatedAt })
    .from(controlPlanePoliciesTable)
    .where(
      and(
        eq(controlPlanePoliciesTable.organizationId, organizationId),
        eq(controlPlanePoliciesTable.key, key),
      ),
    );
  return row?.updatedAt ?? null;
}
