import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import * as applicationSchema from "@workspace/db/schema";

/**
 * Derive table, column and nullability requirements from the actual ORM schema.
 * A hand-maintained subset previously missed billing/growth tables and dozens
 * of columns that SELECT queries depend on. Retired owner-auth tables are not
 * exported by the schema and remain optional during a safe rollout.
 */
const applicationTables = Object.values(applicationSchema)
  .flatMap((value: unknown) => is(value, PgTable) ? [getTableConfig(value)] : []);

export const REQUIRED_DATABASE_TABLES = applicationTables.map((table) => table.name);
export const REQUIRED_DATABASE_COLUMNS: Record<string, readonly string[]> = Object.fromEntries(
  applicationTables.map((table) => [table.name, table.columns.map((column) => column.name)]),
);
export const REQUIRED_DATABASE_NOT_NULL_COLUMNS: Record<string, readonly string[]> = Object.fromEntries(
  applicationTables.map((table) => [
    table.name,
    table.columns.filter((column) => column.notNull).map((column) => column.name),
  ]),
);

export const REQUIRED_DATABASE_INDEXES = [
  {
    table: "organizations",
    label: "organizations.clerk_org_id.unique",
    requiredFragments: ["unique", "clerk_org_id"],
  },
  {
    table: "organizations",
    name: "organizations_trial_grantee_unique",
    label: "organizations.trial_granted_by_clerk_user_id.partial_unique",
    requiredFragments: ["unique", "trial_granted_by_clerk_user_id", "where", "is not null"],
  },
  {
    table: "venues",
    label: "venues.slug.unique",
    requiredFragments: ["unique", "slug"],
  },
  {
    table: "venue_media",
    name: "venue_media_venue_object_key_unique",
    label: "venue_media.venue_id_object_key.unique",
    requiredFragments: ["unique", "venue_id", "object_key"],
  },
  {
    table: "upload_intents",
    name: "upload_intents_object_key_unique",
    label: "upload_intents.object_key.unique",
    requiredFragments: ["unique", "object_key"],
  },
  {
    table: "couple_sessions",
    label: "couple_sessions.share_token.unique",
    requiredFragments: ["unique", "share_token"],
  },
  {
    table: "generated_assets",
    name: "generated_assets_object_key_unique",
    label: "generated_assets.object_key.unique",
    requiredFragments: ["unique", "object_key"],
  },
  {
    table: "generated_assets",
    name: "generated_assets_session_slot_unique",
    label: "generated_assets.session_id_asset_type_display_order.unique",
    requiredFragments: ["unique", "session_id", "asset_type", "display_order"],
  },
  {
    table: "credit_transactions",
    name: "credit_transactions_stripe_event_id_unique",
    label: "credit_transactions.stripe_event_id.partial_unique",
    requiredFragments: ["unique", "stripe_event_id", "where", "is not null"],
  },
  {
    table: "control_prospects",
    name: "control_prospects_email_unique",
    label: "control_prospects.email.unique",
    requiredFragments: ["unique", "email"],
  },
  {
    table: "control_outreach_emails",
    name: "control_outreach_emails_token_unique",
    label: "control_outreach_emails.unsubscribe_token.unique",
    requiredFragments: ["unique", "unsubscribe_token"],
  },
  {
    table: "control_email_suppressions",
    name: "control_email_suppressions_email_unique",
    label: "control_email_suppressions.email.unique",
    requiredFragments: ["unique", "email"],
  },
] as const;

type TableRow = { table_name: string };
type ColumnRow = { table_name: string; column_name: string; is_nullable: "YES" | "NO" };
type IndexRow = { tablename: string; indexname: string; indexdef: string };
type RlsRow = { tablename: string; rowsecurity: boolean | "t" | "f" | "true" | "false" };

export type { TableRow, ColumnRow, IndexRow, RlsRow };

/**
 * Raw introspection rows the pure evaluators below consume. The async
 * `missingRequired*` functions load them from Postgres; tests hand in fixtures.
 */
export interface SchemaIntrospection {
  tables: TableRow[];
  columns: ColumnRow[];
  indexes: IndexRow[];
}

function rowsFromExecuteResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybeRows = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybeRows) ? (maybeRows as T[]) : [];
}

/* ————— Pure evaluators (no database) ————— */

export function evaluateMissingTables(rows: TableRow[]): string[] {
  const found = new Set(rows.map((row) => row.table_name));
  return REQUIRED_DATABASE_TABLES.filter((table) => !found.has(table));
}

export function evaluateMissingColumns(rows: ColumnRow[]): string[] {
  const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return Object.entries(REQUIRED_DATABASE_COLUMNS).flatMap(([table, columns]) =>
    columns
      .filter((column) => !found.has(`${table}.${column}`))
      .map((column) => `${table}.${column}`),
  );
}

export function evaluateNullableColumns(rows: ColumnRow[]): string[] {
  const columns = new Map(
    rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]),
  );
  return Object.entries(REQUIRED_DATABASE_NOT_NULL_COLUMNS).flatMap(([table, requiredColumns]) =>
    requiredColumns
      .filter((column) => columns.get(`${table}.${column}`) === "YES")
      .map((column) => `${table}.${column}`),
  );
}

export function evaluateMissingIndexes(indexes: IndexRow[]): string[] {
  return REQUIRED_DATABASE_INDEXES.flatMap((required) => {
    const candidateIndexes = indexes.filter((index) => index.tablename === required.table);
    const actual =
      "name" in required
        ? candidateIndexes.find((index) => index.indexname === required.name)
        : candidateIndexes.find((index) => {
            const normalizedDefinition = index.indexdef.toLowerCase().replace(/\s+/g, " ");
            return required.requiredFragments.every((fragment) =>
              normalizedDefinition.includes(fragment),
            );
          });
    if (!actual) return [required.label];

    const normalizedDefinition = actual.indexdef.toLowerCase().replace(/\s+/g, " ");
    const hasAllFragments = required.requiredFragments.every((fragment) =>
      normalizedDefinition.includes(fragment),
    );
    return hasAllFragments ? [] : [required.label];
  });
}

/** Every contract violation for an introspection snapshot, prefixed by kind. */
export function evaluateRequiredDatabaseSchema(introspection: SchemaIntrospection): string[] {
  return [
    ...evaluateMissingTables(introspection.tables).map((table) => `table:${table}`),
    ...evaluateMissingColumns(introspection.columns).map((column) => `column:${column}`),
    ...evaluateNullableColumns(introspection.columns).map((column) => `not-null:${column}`),
    ...evaluateMissingIndexes(introspection.indexes).map((index) => `index:${index}`),
  ];
}

function rlsEnabled(value: RlsRow["rowsecurity"]): boolean {
  return value === true || value === "t" || value === "true";
}

/**
 * Public tables whose row-level security is off. The server connects as the
 * table owner and bypasses RLS, so the only thing RLS protects is the
 * PostgREST anon/authenticated surface; every public table must have it on.
 */
export function evaluateRowLevelSecurity(rows: RlsRow[]): string[] {
  return rows
    .filter((row) => !rlsEnabled(row.rowsecurity))
    .map((row) => row.tablename)
    .sort();
}

/* ————— Database-backed loaders ————— */

function requiredTableNameList() {
  return sql.join(
    REQUIRED_DATABASE_TABLES.map((table) => sql`${table}`),
    sql`, `,
  );
}

async function loadColumnRows(): Promise<ColumnRow[]> {
  const result = await db.execute<ColumnRow>(
    sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name in (${requiredTableNameList()})`,
  );
  return rowsFromExecuteResult<ColumnRow>(result);
}

export async function missingRequiredDatabaseTables(): Promise<string[]> {
  const result = await db.execute<TableRow>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${requiredTableNameList()})`,
  );
  return evaluateMissingTables(rowsFromExecuteResult<TableRow>(result));
}

export async function missingRequiredDatabaseColumns(): Promise<string[]> {
  return evaluateMissingColumns(await loadColumnRows());
}

export async function nullableRequiredDatabaseColumns(): Promise<string[]> {
  return evaluateNullableColumns(await loadColumnRows());
}

export async function missingRequiredDatabaseIndexes(): Promise<string[]> {
  const result = await db.execute<IndexRow>(
    sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`,
  );
  return evaluateMissingIndexes(rowsFromExecuteResult<IndexRow>(result));
}

export async function missingRequiredDatabaseSchema(): Promise<string[]> {
  const [missingTables, missingColumns, nullableColumns, missingIndexes] = await Promise.all([
    missingRequiredDatabaseTables(),
    missingRequiredDatabaseColumns(),
    nullableRequiredDatabaseColumns(),
    missingRequiredDatabaseIndexes(),
  ]);

  return [
    ...missingTables.map((table) => `table:${table}`),
    ...missingColumns.map((column) => `column:${column}`),
    ...nullableColumns.map((column) => `not-null:${column}`),
    ...missingIndexes.map((index) => `index:${index}`),
  ];
}

export type RowLevelSecurityReadiness =
  | { status: "ok" | "degraded"; tablesWithoutRls: string[] }
  | { status: "unknown"; reason: string };

/**
 * RLS state of every table in the public schema. Reading pg_tables needs no
 * special privilege on Supabase, but a locked-down role may still be refused;
 * that is reported as "unknown" (warn-level) rather than as a failed deploy.
 */
export async function rowLevelSecurityReadiness(): Promise<RowLevelSecurityReadiness> {
  try {
    const result = await db.execute<RlsRow>(
      sql`select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    const tablesWithoutRls = evaluateRowLevelSecurity(rowsFromExecuteResult<RlsRow>(result));
    return { status: tablesWithoutRls.length === 0 ? "ok" : "degraded", tablesWithoutRls };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: "unknown", reason: `pg_tables introspection unavailable: ${reason}` };
  }
}
