import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

type SslConfig = { ca?: string; rejectUnauthorized: boolean };

/**
 * TLS for the database connection.
 *
 * - `DATABASE_SSL_CA` (PEM text, `\n` escapes allowed) or `DATABASE_SSL_CA_PATH`
 *   (path to a PEM file) pins the server CA: the connection is encrypted AND
 *   verified (`rejectUnauthorized: true`). Supabase publishes its CA under
 *   Project Settings -> Database -> SSL configuration ("Download certificate").
 * - Without a pinned CA, a Supabase host or `sslmode=require` still connects
 *   over TLS but cannot verify the server (libpq `require` semantics). A single
 *   warning explains how to pin the CA.
 * - `sslmode=verify-ca` / `verify-full` without a pinned CA verify against the
 *   system trust store.
 * - Local Postgres without SSL (no sslmode, non-Supabase host) stays plain.
 */
export function readConfiguredCa(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const inline = env.DATABASE_SSL_CA?.trim();
  if (inline) return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  const caPath = env.DATABASE_SSL_CA_PATH?.trim();
  if (caPath) return fs.readFileSync(caPath, "utf8");
  return undefined;
}

let warnedUnverifiedTls = false;

export function normalizeDatabaseUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): { url: string; ssl: SslConfig | undefined } {
  let url = raw.trim();
  if (url.includes("db.") && url.includes(".supabase.co:5432")) {
    console.warn(
      "[db] DATABASE_URL uses Supabase direct host (db.*). On Windows, use Session pooler URI from Dashboard → Database → Connect instead.",
    );
  }

  const isSupabase = url.includes("supabase.co") || url.includes("supabase.com");
  const sslmode = /[?&]sslmode=([^&]*)/i.exec(url)?.[1]?.toLowerCase() ?? "";
  const verifyRequested = sslmode === "verify-ca" || sslmode === "verify-full";
  const sslRequested = verifyRequested || sslmode === "require" || sslmode === "prefer";
  const needsSsl = sslmode !== "disable" && (isSupabase || sslRequested);

  // Strip sslmode/sslrootcert/ssl from the connection string so the `ssl`
  // object below is the single source of truth. Newer pg versions otherwise
  // let the query string override it.
  url = url
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/([?&])sslrootcert=[^&]*/gi, "$1")
    .replace(/([?&])ssl(?:=[^&]*)?(?=&|$)/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "");

  if (!needsSsl) return { url, ssl: undefined };

  const ca = readConfiguredCa(env);
  if (ca) return { url, ssl: { ca, rejectUnauthorized: true } };
  if (verifyRequested) return { url, ssl: { rejectUnauthorized: true } };

  if (!warnedUnverifiedTls) {
    warnedUnverifiedTls = true;
    console.warn(
      "[db] Database TLS is encrypted but NOT verified (no CA pinned). Set DATABASE_SSL_CA to the provider's CA certificate PEM, or DATABASE_SSL_CA_PATH to a file holding it. Supabase: Project Settings → Database → SSL configuration → Download certificate.",
    );
  }
  return { url, ssl: { rejectUnauthorized: false } };
}

export function createDatabasePool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set. Add your Supabase connection string to .env at the monorepo root.",
    );
  }

  const { url, ssl } = normalizeDatabaseUrl(connectionString);

  return new Pool({
    connectionString: url,
    ssl,
    max: 10,
  });
}
