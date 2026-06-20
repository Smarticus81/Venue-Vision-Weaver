import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const REQUIRED_DATABASE_TABLES = [
  "venues",
  "venue_media",
  "upload_intents",
  "couple_sessions",
  "couple_media",
  "generated_assets",
  "credit_transactions",
  "owner_login_tokens",
  "owner_sessions",
] as const;

export const REQUIRED_DATABASE_COLUMNS = {
  venues: [
    "id",
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
  credit_transactions: [
    "id",
    "venue_id",
    "delta",
    "reason",
    "session_id",
    "stripe_event_id",
    "created_at",
  ],
  owner_login_tokens: [
    "id",
    "token_hash",
    "owner_email",
    "expires_at",
    "used_at",
    "created_at",
  ],
  owner_sessions: [
    "id",
    "session_hash",
    "owner_email",
    "expires_at",
    "revoked",
    "created_at",
  ],
} as const satisfies Record<(typeof REQUIRED_DATABASE_TABLES)[number], readonly string[]>;

export const REQUIRED_DATABASE_NOT_NULL_COLUMNS = {
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
  credit_transactions: ["id", "venue_id", "delta", "reason", "created_at"],
  owner_login_tokens: ["id", "token_hash", "owner_email", "expires_at", "created_at"],
  owner_sessions: ["id", "session_hash", "owner_email", "expires_at", "revoked", "created_at"],
} as const satisfies Partial<Record<(typeof REQUIRED_DATABASE_TABLES)[number], readonly string[]>>;

export const REQUIRED_DATABASE_INDEXES = [
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
    table: "owner_login_tokens",
    label: "owner_login_tokens.token_hash.unique",
    requiredFragments: ["unique", "token_hash"],
  },
  {
    table: "owner_sessions",
    label: "owner_sessions.session_hash.unique",
    requiredFragments: ["unique", "session_hash"],
  },
] as const;

type TableRow = { table_name: string };
type ColumnRow = { table_name: string; column_name: string; is_nullable: "YES" | "NO" };
type IndexRow = { tablename: string; indexname: string; indexdef: string };

function rowsFromExecuteResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybeRows = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybeRows) ? (maybeRows as T[]) : [];
}

export async function missingRequiredDatabaseTables(): Promise<string[]> {
  const tableNames = sql.join(
    REQUIRED_DATABASE_TABLES.map((table) => sql`${table}`),
    sql`, `,
  );
  const result = await db.execute<TableRow>(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in (${tableNames})`,
  );
  const found = new Set(rowsFromExecuteResult<TableRow>(result).map((row) => row.table_name));
  return REQUIRED_DATABASE_TABLES.filter((table) => !found.has(table));
}

export async function missingRequiredDatabaseColumns(): Promise<string[]> {
  const tableNames = sql.join(
    REQUIRED_DATABASE_TABLES.map((table) => sql`${table}`),
    sql`, `,
  );
  const result = await db.execute<ColumnRow>(
    sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name in (${tableNames})`,
  );
  const found = new Set(
    rowsFromExecuteResult<ColumnRow>(result).map((row) => `${row.table_name}.${row.column_name}`),
  );
  return Object.entries(REQUIRED_DATABASE_COLUMNS).flatMap(([table, columns]) =>
    columns
      .filter((column) => !found.has(`${table}.${column}`))
      .map((column) => `${table}.${column}`),
  );
}

export async function nullableRequiredDatabaseColumns(): Promise<string[]> {
  const tableNames = sql.join(
    REQUIRED_DATABASE_TABLES.map((table) => sql`${table}`),
    sql`, `,
  );
  const result = await db.execute<ColumnRow>(
    sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name in (${tableNames})`,
  );
  const columns = new Map(
    rowsFromExecuteResult<ColumnRow>(result).map((row) => [
      `${row.table_name}.${row.column_name}`,
      row.is_nullable,
    ]),
  );

  return Object.entries(REQUIRED_DATABASE_NOT_NULL_COLUMNS).flatMap(([table, requiredColumns]) =>
    requiredColumns
      .filter((column) => columns.get(`${table}.${column}`) === "YES")
      .map((column) => `${table}.${column}`),
  );
}

export async function missingRequiredDatabaseIndexes(): Promise<string[]> {
  const result = await db.execute<IndexRow>(
    sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`,
  );
  const indexes = rowsFromExecuteResult<IndexRow>(result);

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
