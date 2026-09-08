import { and, eq } from "drizzle-orm";
import {
  db,
  controlPlaneExperimentsTable,
  controlPlaneExperimentAssignmentsTable,
  controlPlaneExperimentEventsTable,
} from "@workspace/db";
import { logger } from "../logger.js";
import { isControlPlaneReady } from "./schemaGuard.js";

/**
 * Experiment runtime. Assignment is a deterministic hash of the subject key
 * and the experiment key, so a couple entering the same surface twice sees
 * the same variant whether or not the assignment row was written.
 */

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickVariant(
  experimentKey: string,
  subjectKey: string,
  variants: { key: string; weight: number }[],
): string | null {
  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.weight), 0);
  if (total <= 0) return null;
  const bucket = hash32(`${experimentKey}:${subjectKey}`) % total;
  let cursor = 0;
  for (const variant of variants) {
    cursor += Math.max(0, variant.weight);
    if (bucket < cursor) return variant.key;
  }
  return variants[variants.length - 1]?.key ?? null;
}

export interface AssignmentResult {
  experimentKey: string;
  variant: string;
}

/**
 * Assign every running experiment on a surface and record the exposure.
 * Returns the variants so the caller can branch on them.
 */
export async function assignSurface(
  organizationId: number,
  surface: string,
  subjectKey: string,
): Promise<AssignmentResult[]> {
  try {
    if (!(await isControlPlaneReady())) return [];
    const experiments = await db
      .select()
      .from(controlPlaneExperimentsTable)
      .where(
        and(
          eq(controlPlaneExperimentsTable.organizationId, organizationId),
          eq(controlPlaneExperimentsTable.surface, surface),
          eq(controlPlaneExperimentsTable.status, "running"),
        ),
      );

    const assignments: AssignmentResult[] = [];
    for (const experiment of experiments) {
      const variant = pickVariant(experiment.key, subjectKey, experiment.variants);
      if (!variant) continue;

      const [inserted] = await db
        .insert(controlPlaneExperimentAssignmentsTable)
        .values({ experimentId: experiment.id, subjectKey, variant })
        .onConflictDoNothing({
          target: [
            controlPlaneExperimentAssignmentsTable.experimentId,
            controlPlaneExperimentAssignmentsTable.subjectKey,
          ],
        })
        .returning({ id: controlPlaneExperimentAssignmentsTable.id });

      // Exposure is counted once per subject, on first assignment only.
      if (inserted) {
        await db.insert(controlPlaneExperimentEventsTable).values({
          experimentId: experiment.id,
          subjectKey,
          variant,
          metric: "exposure",
        });
      }
      assignments.push({ experimentKey: experiment.key, variant });
    }
    return assignments;
  } catch (err) {
    logger.warn({ err, surface }, "Could not assign experiment variants");
    return [];
  }
}

/** Record a conversion for whatever variant this subject was assigned. */
export async function recordConversion(
  organizationId: number,
  metric: string,
  subjectKey: string,
  value = 1,
): Promise<void> {
  try {
    if (!(await isControlPlaneReady())) return;
    const rows = await db
      .select({
        experimentId: controlPlaneExperimentsTable.id,
        variant: controlPlaneExperimentAssignmentsTable.variant,
      })
      .from(controlPlaneExperimentAssignmentsTable)
      .innerJoin(
        controlPlaneExperimentsTable,
        eq(controlPlaneExperimentsTable.id, controlPlaneExperimentAssignmentsTable.experimentId),
      )
      .where(
        and(
          eq(controlPlaneExperimentAssignmentsTable.subjectKey, subjectKey),
          eq(controlPlaneExperimentsTable.organizationId, organizationId),
          eq(controlPlaneExperimentsTable.primaryMetric, metric),
          eq(controlPlaneExperimentsTable.status, "running"),
        ),
      );

    for (const row of rows) {
      await db.insert(controlPlaneExperimentEventsTable).values({
        experimentId: row.experimentId,
        subjectKey,
        variant: row.variant,
        metric,
        value,
      });
    }
  } catch (err) {
    logger.warn({ err, metric }, "Could not record experiment conversion");
  }
}
