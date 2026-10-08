import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Tables the deployed build cannot run without. Owner sign-in is Clerk end to
 * end, so the retired owner-auth tables are no longer part of the contract
 * (see supabase/migrations/2026-10-08-drop-owner-auth.sql).
 */
export const REQUIRED_DATABASE_TABLES = [
  "organizations",
  "venues",
  "venue_media",
  "upload_intents",
  "couple_sessions",
  "couple_media",
  "generated_assets",
  "gallery_events",
  "render_attempts",
  "credit_transactions",
  "funnel_events",
  "control_agents",
  "agent_runs",
  "agent_actions",
  "control_prospects",
  "control_outreach_emails",
  "control_email_suppressions",
] as const;

export const REQUIRED_DATABASE_COLUMNS = {
  organizations: [
    "id",
    "clerk_org_id",
    "name",
    "plan",
    "credits_balance",
    "stripe_customer_id",
    "stripe_subscription_id",
    "billing_period_end",
    "created_at",
  ],
  venues: [
    "id",
    "organization_id",
    "name",
    "slug",
    "tagline",
    "description",
    "owner_email",
    "contact_email",
    "contact_phone",
    "website_url",
    "booking_url",
    "plan",
    "credits_balance",
    "stripe_customer_id",
    "stripe_subscription_id",
    "billing_period_end",
    "created_at",
  ],
  venue_media: ["id", "venue_id", "object_key", "coverage", "display_order", "created_at"],
  upload_intents: [
    "id",
    "object_key",
    "venue_id",
    "purpose",
    "original_name",
    "content_type",
    "size_bytes",
    "expires_at",
    "consumed_at",
    "created_at",
  ],
  couple_sessions: [
    "id",
    "venue_id",
    "status",
    "error_message",
    "style_id",
    "couple_name",
    "couple_email",
    "share_token",
    "credits_charged",
    "created_at",
    "completed_at",
  ],
  couple_media: ["id", "session_id", "object_key", "created_at"],
  generated_assets: [
    "id",
    "session_id",
    "object_key",
    "asset_type",
    "display_order",
    "generation_model",
    "generation_attempts",
    "venue_reference_indexes",
    "quality_report",
    "created_at",
  ],
  gallery_events: ["id", "session_id", "venue_id", "event_type", "source", "ip_hash", "meta", "created_at"],
  render_attempts: [
    "id",
    "session_id",
    "scene_id",
    "attempt",
    "model",
    "fallback_used",
    "outcome",
    "created_at",
  ],
  credit_transactions: [
    "id",
    "organization_id",
    "venue_id",
    "delta",
    "reason",
    "session_id",
    "stripe_event_id",
    "created_at",
  ],
  funnel_events: ["id", "organization_id", "venue_id", "event", "properties", "source", "created_at"],
  control_agents: ["id", "key", "name", "domain", "status", "interval_minutes", "created_at", "updated_at"],
  agent_runs: ["id", "agent_key", "trigger", "status", "started_at", "finished_at"],
  agent_actions: [
    "id",
    "agent_key",
    "action_type",
    "title",
    "params",
    "risk_level",
    "requires_approval",
    "status",
    "created_at",
  ],
  control_prospects: ["id", "name", "email", "website", "status", "score", "created_at", "updated_at"],
  control_outreach_emails: [
    "id",
    "prospect_id",
    "action_id",
    "status",
    "subject",
    "body",
    "unsubscribe_token",
    "created_at",
    "updated_at",
  ],
  control_email_suppressions: ["id", "email", "reason", "created_at"],
} as const satisfies Record<(typeof REQUIRED_DATABASE_TABLES)[number], readonly string[]>;

export const REQUIRED_DATABASE_NOT_NULL_COLUMNS = {
  organizations: ["id", "clerk_org_id", "name", "plan", "credits_balance", "created_at"],
  venues: ["id", "name", "slug", "owner_email", "plan", "credits_balance", "created_at"],
  venue_media: ["id", "venue_id", "object_key", "coverage", "display_order", "created_at"],
  upload_intents: [
    "id",
    "object_key",
    "venue_id",
    "purpose",
    "original_name",
    "content_type",
    "size_bytes",
    "expires_at",
    "created_at",
  ],
  couple_sessions: [
    "id",
    "venue_id",
    "status",
    "couple_email",
    "share_token",
    "credits_charged",
    "created_at",
  ],
  couple_media: ["id", "session_id", "object_key", "created_at"],
  generated_assets: ["id", "session_id", "object_key", "asset_type", "display_order", "created_at"],
  gallery_events: ["id", "session_id", "venue_id", "event_type", "created_at"],
  render_attempts: ["id", "session_id", "scene_id", "attempt", "model", "fallback_used", "outcome", "created_at"],
  // Ledger rows belong to the organization; venue_id is nullable provenance.
  credit_transactions: ["id", "delta", "reason", "created_at"],
  funnel_events: ["id", "event", "created_at"],
  control_agents: ["id", "key", "name", "domain", "status", "interval_minutes", "created_at", "updated_at"],
  agent_runs: ["id", "agent_key", "trigger", "status", "started_at"],
  agent_actions: [
    "id",
    "agent_key",
    "action_type",
    "title",
    "params",
    "risk_level",
    "requires_approval",
    "status",
    "created_at",
  ],
  control_prospects: ["id", "name", "email", "status", "score", "created_at", "updated_at"],
  control_outreach_emails: [
    "id",
    "prospect_id",
    "status",
    "subject",
    "body",
    "unsubscribe_token",
    "created_at",
    "updated_at",
  ],
  control_email_suppressions: ["id", "email", "reason", "created_at"],
} as const satisfies Partial<Record<(typeof REQUIRED_DATABASE_TABLES)[number], readonly string[]>>;

export const REQUIRED_DATABASE_INDEXES = [
  {
    table: "organizations",
    label: "organizations.clerk_org_id.unique",
    requiredFragments: ["unique", "clerk_org_id"],
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
