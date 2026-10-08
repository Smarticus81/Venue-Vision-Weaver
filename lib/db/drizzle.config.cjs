const path = require("path");
const fs = require("fs");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const root = __dirname;
loadEnvFile(path.resolve(root, "../../.env"));
loadEnvFile(path.resolve(root, "../../../.env"));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to the .env at the monorepo root.",
  );
}

// Same TLS policy as src/pgPool.ts (kept in sync by hand; drizzle-kit loads
// this file as CommonJS so it cannot import the TypeScript module):
// - DATABASE_SSL_CA (PEM text) or DATABASE_SSL_CA_PATH pins the CA and verifies.
// - Supabase / sslmode=require without a CA: encrypted, unverified, one warning.
// - sslmode=verify-ca|verify-full without a CA: verify against the system store.
// - Local Postgres without sslmode: no TLS.
function readConfiguredCa() {
  const inline = (process.env.DATABASE_SSL_CA || "").trim();
  if (inline) return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  const caPath = (process.env.DATABASE_SSL_CA_PATH || "").trim();
  if (caPath) return fs.readFileSync(caPath, "utf8");
  return undefined;
}

function resolveDatabase(raw) {
  let url = raw.trim();
  const isSupabase = url.includes("supabase.co") || url.includes("supabase.com");
  const sslmodeMatch = /[?&]sslmode=([^&]*)/i.exec(url);
  const sslmode = sslmodeMatch ? sslmodeMatch[1].toLowerCase() : "";
  const verifyRequested = sslmode === "verify-ca" || sslmode === "verify-full";
  const sslRequested = verifyRequested || sslmode === "require" || sslmode === "prefer";
  const needsSsl = sslmode !== "disable" && (isSupabase || sslRequested);

  url = url
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/([?&])sslrootcert=[^&]*/gi, "$1")
    .replace(/([?&])ssl(?:=[^&]*)?(?=&|$)/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&]$/, "");

  if (!needsSsl) return { url, ssl: undefined };
  const ca = readConfiguredCa();
  if (ca) return { url, ssl: { ca, rejectUnauthorized: true } };
  if (verifyRequested) return { url, ssl: { rejectUnauthorized: true } };
  console.warn(
    "[db] Database TLS is encrypted but NOT verified (no CA pinned). Set DATABASE_SSL_CA or DATABASE_SSL_CA_PATH to the provider's CA certificate (Supabase: Project Settings → Database → SSL configuration → Download certificate).",
  );
  return { url, ssl: { rejectUnauthorized: false } };
}

const { url, ssl } = resolveDatabase(process.env.DATABASE_URL);

/** @type {import("drizzle-kit").Config} */
module.exports = {
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
    ...(ssl ? { ssl } : {}),
  },
};
