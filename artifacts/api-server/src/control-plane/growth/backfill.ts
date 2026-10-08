import { db, controlProspectsTable } from "@workspace/db";
import { eq, isNull, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { trialDays } from "./config.js";
import { classifyVenueType } from "./segments.js";
import { ensureVariantDefaults } from "./variants.js";

/*
 * Startup backfills (growth-loop.md 4.4). Every statement is idempotent and
 * failures are logged, never thrown, so a half-migrated database still boots.
 * Runs from scheduler.startControlPlaneWorker() right after the policy
 * defaults are seeded.
 */

type CountRow = { count: unknown };

function rowCount(result: unknown): number {
  const direct = (result as { rowCount?: unknown })?.rowCount;
  if (typeof direct === "number") return direct;
  const rows = (result as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}

async function step(name: string, fn: () => Promise<number>): Promise<void> {
  try {
    const affected = await fn();
    if (affected > 0) logger.info({ step: name, affected }, "Growth backfill applied");
  } catch (err) {
    logger.error({ err, step: name }, "Growth backfill step failed");
  }
}

export async function runGrowthBackfills(): Promise<void> {
  await step("first_paid_at from ledger", async () => {
    const result = await db.execute<CountRow>(sql`
      update organizations o set first_paid_at = s.first_paid
      from (
        select ct.organization_id, min(ct.created_at) as first_paid
        from credit_transactions ct
        where ct.reason in ('pack_purchase', 'subscription_grant') and ct.organization_id is not null
        group by ct.organization_id
      ) s
      where s.organization_id = o.id and o.first_paid_at is null
    `);
    return rowCount(result);
  });

  await step("pack buyers without a subscription -> payg", async () => {
    const result = await db.execute<CountRow>(sql`
      update organizations set plan = 'payg'
      where plan in ('trial', 'none') and first_paid_at is not null and stripe_subscription_id is null
    `);
    return rowCount(result);
  });

  await step("trial clock for existing trials", async () => {
    const days = trialDays();
    const result = await db.execute<CountRow>(sql`
      update organizations
      set trial_ends_at = greatest(created_at + (${days} * interval '1 day'), now() + interval '7 days')
      where plan = 'trial' and trial_ends_at is null
    `);
    return rowCount(result);
  });

  await step("prospect replied_at from status", async () => {
    const result = await db.execute<CountRow>(sql`
      update control_prospects set replied_at = updated_at where status = 'replied' and replied_at is null
    `);
    return rowCount(result);
  });

  await step("prospect converted_at from status", async () => {
    const result = await db.execute<CountRow>(sql`
      update control_prospects
      set converted_at = updated_at, attribution_method = coalesce(attribution_method, 'manual')
      where status = 'converted' and converted_at is null
    `);
    return rowCount(result);
  });

  await step("copy variant defaults", async () => {
    await ensureVariantDefaults();
    return 0;
  });

  await step("venue type classification", async () => {
    const rows = await db.execute<{ id: number; name: string; qualification: string | null; facts: Record<string, unknown> | null }>(sql`
      select p.id, p.name, p.qualification, r.facts
      from control_prospects p
      left join control_prospect_research r on r.prospect_id = p.id
      where p.venue_type is null
      order by p.id asc
      limit 500
    `);
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    let updated = 0;
    for (const raw of list as Array<{ id: number; name: string; qualification: string | null; facts: Record<string, unknown> | null }>) {
      const venueType = classifyVenueType({
        name: String(raw.name ?? ""),
        qualification: raw.qualification ?? null,
        facts: raw.facts && typeof raw.facts === "object" ? (raw.facts as { style?: unknown; spaces?: unknown; summary?: unknown }) : null,
      });
      await db
        .update(controlProspectsTable)
        .set({ venueType })
        .where(sql`${eq(controlProspectsTable.id, Number(raw.id))} and ${isNull(controlProspectsTable.venueType)}`);
      updated += 1;
    }
    return updated;
  });
}
