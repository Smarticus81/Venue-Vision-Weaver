/**
 * Creates all app tables in the database named by DATABASE_URL in .env.
 * Use a fresh Supabase project: Dashboard -> Project Settings -> Database -> Connect -> URI.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const vars = {};
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
    vars[key] = value;
    if (!process.env[key]) process.env[key] = value;
  }
  return vars;
}

function setEnvValue(key, value) {
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  }
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  fs.writeFileSync(envPath, next.join("\n").replace(/\n*$/, "\n"), "utf8");
  process.env[key] = value;
}

function needsDatabaseUrl(url) {
  if (!url) return true;
  if (url.includes("[YOUR-PASSWORD]")) return true;
  if (url.includes("YOUR_PASSWORD")) return true;
  return false;
}

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const env = loadEnvFile(envPath);

  console.log("");
  console.log("glimpse - Supabase database setup");
  console.log("----------------------------------------");
  console.log("1. Open https://supabase.com/dashboard -> New project");
  console.log("2. Wait for the project to finish provisioning");
  console.log("3. Project Settings -> Database -> Connect -> URI");
  console.log("   Choose: Session pooler (recommended) or Direct connection");
  console.log("4. Copy the full connection string (replace [YOUR-PASSWORD] with your DB password)");
  console.log("");

  let databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (needsDatabaseUrl(databaseUrl)) {
    const pasted = await prompt("Paste your Supabase DATABASE_URI here: ");
    if (!pasted) {
      console.error("No connection string provided. Add DATABASE_URL to .env and run again.");
      process.exit(1);
    }
    databaseUrl = pasted;
    if (!databaseUrl.includes("sslmode=")) {
      databaseUrl += databaseUrl.includes("?") ? "&sslmode=require" : "?sslmode=require";
    }
    setEnvValue("DATABASE_URL", databaseUrl);
    console.log("Saved DATABASE_URL to .env");
  }

  console.log("");
  console.log("Applying schema to Supabase (drizzle push)...");
  const push = spawnSync(
    "pnpm",
    ["--filter", "@workspace/db", "run", "push"],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: true,
    },
  );

  if (push.status !== 0) {
    console.error("");
    console.error("Schema push failed. You can also run supabase/bootstrap.sql in");
    console.error("Supabase -> SQL Editor if needed.");
    process.exit(push.status ?? 1);
  }

  console.log("");
  console.log("Database ready. Tables are created in your Supabase project.");
  console.log("Next: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env for file uploads,");
  console.log("then run: pnpm run setup:storage");
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
