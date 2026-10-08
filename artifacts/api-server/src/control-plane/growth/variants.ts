import { db, controlCopyVariantsTable, type ControlCopyVariant } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { recordAuditEvent } from "../audit.js";

/*
 * Copy-variant registry (growth-loop.md 9.3). The outreach studio rotates
 * between these angles; stats come from control_outreach_emails.variant_key
 * and the adaptation rules move the weights. The control never drops below
 * 20% of the total weight and is never paused by a rule.
 */

export const CONTROL_MIN_WEIGHT_SHARE = 0.2;

export const VARIANT_DEFAULTS: Array<
  Pick<ControlCopyVariant, "key" | "name" | "angle" | "defaultAsk" | "isControl" | "weight">
> = [
  {
    key: "tours_to_bookings",
    name: "Tours to bookings (control)",
    isControl: true,
    defaultAsk: "preview",
    weight: 0.4,
    angle:
      "Lead with the moment after a tour: the couple sees themselves in the venue's real spaces within a day, so the venue stays top of mind while they decide.",
  },
  {
    key: "see_it_in_24h",
    name: "See your venue in 24 hours",
    isControl: false,
    defaultAsk: "preview",
    weight: 0.2,
    angle:
      "Make the ask concrete and fast: offer a free preview gallery of their own spaces within 24 hours, no setup on their side.",
  },
  {
    key: "couple_in_the_room",
    name: "The couple in the room",
    isControl: false,
    defaultAsk: "preview",
    weight: 0.2,
    angle:
      "Describe one named space from their site and what it would look like with the couple standing in it; keep it to one picture in words.",
  },
  {
    key: "open_dates",
    name: "Open dates this season",
    isControl: false,
    defaultAsk: "call",
    weight: 0.2,
    angle:
      "Tie it to the calendar: galleries help couples choose a date while the venue still has the dates they want; ask for a short call.",
  },
];

/** Seed the registry (idempotent; existing rows keep their operator/rule-set values). */
export async function ensureVariantDefaults(): Promise<void> {
  for (const variant of VARIANT_DEFAULTS) {
    await db
      .insert(controlCopyVariantsTable)
      .values({ ...variant, createdBy: "seed" })
      .onConflictDoNothing({ target: controlCopyVariantsTable.key });
  }
}

export async function listVariants(): Promise<ControlCopyVariant[]> {
  return db.select().from(controlCopyVariantsTable).orderBy(asc(controlCopyVariantsTable.id));
}

export async function getVariant(key: string): Promise<ControlCopyVariant | null> {
  const [row] = await db.select().from(controlCopyVariantsTable).where(eq(controlCopyVariantsTable.key, key)).limit(1);
  return row ?? null;
}

/**
 * Weighted pick over active rows. `random` is injectable so tests are
 * deterministic; the roll is scaled to the total weight so weights need not
 * sum to 1. Null when no active variant exists.
 */
export function chooseVariant(
  variants: ControlCopyVariant[],
  random: () => number = Math.random,
): ControlCopyVariant | null {
  const active = variants.filter((v) => v.active && Number.isFinite(v.weight) && v.weight > 0);
  if (active.length === 0) {
    const anyActive = variants.filter((v) => v.active);
    return anyActive[0] ?? null;
  }
  const total = active.reduce((acc, v) => acc + v.weight, 0);
  let roll = Math.min(Math.max(random(), 0), 0.999_999) * total;
  for (const variant of active) {
    roll -= variant.weight;
    if (roll < 0) return variant;
  }
  return active[active.length - 1]!;
}

/**
 * Pure: rescale weights so the control holds at least CONTROL_MIN_WEIGHT_SHARE
 * of the total active weight (others scaled down, never the control up past
 * what is needed). Returns the rows with adjusted weights, rounded to 4 dp.
 */
export function normalizeControlShare<T extends Pick<ControlCopyVariant, "key" | "isControl" | "active" | "weight">>(
  variants: T[],
  minShare = CONTROL_MIN_WEIGHT_SHARE,
): T[] {
  const active = variants.filter((v) => v.active);
  const control = active.find((v) => v.isControl);
  if (!control) return variants;
  const others = active.filter((v) => !v.isControl);
  const otherTotal = others.reduce((acc, v) => acc + Math.max(0, v.weight), 0);
  const controlWeight = Math.max(0, control.weight);
  const total = controlWeight + otherTotal;
  if (total <= 0) return variants;
  if (controlWeight / total >= minShare) return variants;
  // Scale the others so control / (control + others') == minShare.
  const targetOthers = controlWeight > 0 ? (controlWeight * (1 - minShare)) / minShare : 0;
  const factor = otherTotal > 0 ? targetOthers / otherTotal : 0;
  return variants.map((v) => {
    if (!v.active || v.isControl) return v;
    return { ...v, weight: Math.round(Math.max(0, v.weight) * factor * 10_000) / 10_000 };
  });
}

export async function updateVariant(
  key: string,
  patch: { active?: boolean; weight?: number; angle?: string; name?: string; pausedReason?: string | null },
  actor: string,
): Promise<ControlCopyVariant> {
  const existing = await getVariant(key);
  if (!existing) throw new Error(`Copy variant "${key}" not found.`);
  if (existing.isControl && patch.active === false) {
    throw new Error("The control variant cannot be deactivated.");
  }
  const set: Partial<typeof controlCopyVariantsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.active !== undefined) {
    set.active = patch.active;
    set.pausedReason = patch.active ? null : patch.pausedReason ?? existing.pausedReason ?? `paused by ${actor}`;
  } else if (patch.pausedReason !== undefined) {
    set.pausedReason = patch.pausedReason;
  }
  if (patch.weight !== undefined) {
    if (!Number.isFinite(patch.weight) || patch.weight < 0 || patch.weight > 1) {
      throw new Error("weight must be between 0 and 1.");
    }
    set.weight = Math.round(patch.weight * 10_000) / 10_000;
  }
  if (patch.angle !== undefined) {
    const angle = patch.angle.trim();
    if (angle.length < 20 || angle.length > 600) throw new Error("angle must be 20-600 characters.");
    set.angle = angle;
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 3 || name.length > 80) throw new Error("name must be 3-80 characters.");
    set.name = name;
  }
  const [updated] = await db
    .update(controlCopyVariantsTable)
    .set(set)
    .where(eq(controlCopyVariantsTable.key, key))
    .returning();
  if (!updated) throw new Error(`Copy variant "${key}" not found.`);
  await recordAuditEvent({
    actorType: actor.startsWith("system:") ? "system" : "operator",
    actor,
    eventType: "variant_updated",
    subjectType: "variant",
    subjectId: key,
    detail: {
      before: { active: existing.active, weight: existing.weight, name: existing.name, angle: existing.angle },
      after: { active: updated.active, weight: updated.weight, name: updated.name, angle: updated.angle },
    },
  });
  return updated;
}
