import pg from "pg";

const { Pool } = pg;

function normalizeDatabaseUrl(raw: string): { url: string; needsSsl: boolean } {
  let url = raw.trim();
  if (url.includes("db.") && url.includes(".supabase.co:5432")) {
    console.warn(
      "[db] DATABASE_URL uses Supabase direct host (db.*). On Windows, use Session pooler URI from Dashboard → Database → Connect instead.",
    );
  }

  const needsSsl =
    url.includes("supabase.co") ||
    url.includes("supabase.com") ||
    /[?&]sslmode=/i.test(url);

  // Strip sslmode/sslrootcert from the connection string. Newer pg versions
  // treat sslmode=require as verify-full and override our `ssl` object, which
  // breaks managed providers (Supabase, Railway) that use self-signed chains.
  url = url
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/([?&])sslrootcert=[^&]*/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "");

  return { url, needsSsl };
}

export function createDatabasePool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL must be set. Add your Supabase connection string to .env at the monorepo root.",
    );
  }

  const { url, needsSsl } = normalizeDatabaseUrl(connectionString);

  return new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}
