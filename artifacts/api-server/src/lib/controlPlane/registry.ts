import { and, eq, sql } from "drizzle-orm";
import { db, controlPlaneAgentsTable, controlPlaneAuditTable } from "@workspace/db";
import { AGENT_REGISTRY, getAgent } from "@workspace/control-plane";
import { logger } from "../logger.js";

/**
 * Every organisation gets the full fleet the first time the control plane
 * touches it. Agents are provisioned at their charter's default autonomy —
 * never higher — and the daily action budget starts conservative.
 */
export async function ensureFleet(organizationId: number): Promise<void> {
  const existing = await db
    .select({ agentKey: controlPlaneAgentsTable.agentKey })
    .from(controlPlaneAgentsTable)
    .where(eq(controlPlaneAgentsTable.organizationId, organizationId));
  const have = new Set(existing.map((row) => row.agentKey));

  const missing = AGENT_REGISTRY.filter((agent) => !have.has(agent.key));
  if (!missing.length) return;

  const now = new Date();
  await db
    .insert(controlPlaneAgentsTable)
    .values(
      missing.map((agent) => ({
        organizationId,
        agentKey: agent.key,
        domain: agent.domain,
        displayName: agent.displayName,
        autonomy: agent.defaultAutonomy,
        intervalMinutes: agent.defaultIntervalMinutes,
        // Stagger first runs so a fresh org does not fire the whole fleet at once.
        nextRunAt: new Date(now.getTime() + AGENT_REGISTRY.indexOf(agent) * 15_000),
      })),
    )
    .onConflictDoNothing({
      target: [controlPlaneAgentsTable.organizationId, controlPlaneAgentsTable.agentKey],
    });

  await db.insert(controlPlaneAuditTable).values({
    organizationId,
    actorType: "system",
    actor: "control-plane",
    action: "fleet.provisioned",
    subjectType: "organization",
    subjectId: String(organizationId),
    detail: { agents: missing.map((agent) => agent.key) },
  });

  logger.info(
    { organizationId, agents: missing.map((agent) => agent.key) },
    "Provisioned control plane agents",
  );
}

/** Roll the per-agent daily action budget over at the start of a new UTC day. */
export async function resetExpiredBudgets(organizationId: number): Promise<void> {
  await db
    .update(controlPlaneAgentsTable)
    .set({ actionsToday: 0, budgetResetAt: new Date() })
    .where(
      and(
        eq(controlPlaneAgentsTable.organizationId, organizationId),
        sql`${controlPlaneAgentsTable.budgetResetAt} < date_trunc('day', now())`,
      ),
    );
}

/**
 * Agent metadata drifts when a release renames an agent or changes its
 * charter. Keep the stored display name and domain in step with the build so
 * the console never shows a stale label.
 */
export async function syncFleetMetadata(organizationId: number): Promise<void> {
  const rows = await db
    .select()
    .from(controlPlaneAgentsTable)
    .where(eq(controlPlaneAgentsTable.organizationId, organizationId));

  for (const row of rows) {
    const definition = getAgent(row.agentKey);
    if (!definition) continue;
    if (definition.displayName === row.displayName && definition.domain === row.domain) continue;
    await db
      .update(controlPlaneAgentsTable)
      .set({ displayName: definition.displayName, domain: definition.domain, updatedAt: new Date() })
      .where(eq(controlPlaneAgentsTable.id, row.id));
  }
}
