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
    "DATABASE_URL is not set. Add it to glimpse/.env at the monorepo root.",
  );
}

const databaseUrl = process.env.DATABASE_URL;
const useSsl =
  databaseUrl.includes("supabase.co") || databaseUrl.includes("sslmode=require");

/** @type {import("drizzle-kit").Config} */
module.exports = {
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  },
};
