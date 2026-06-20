/**
 * Creates Supabase Storage buckets for uploads (private) and public venue assets.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");

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

async function main() {
  loadEnvFile(envPath);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const privateBucket = process.env.SUPABASE_STORAGE_BUCKET || "glimpse";
  const publicBucket = process.env.SUPABASE_PUBLIC_BUCKET || "glimpse-public";

  if (!url || !key) {
    console.error("");
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    console.error("Find them in Supabase -> Project Settings -> API");
    console.error("Use the service_role key (server only - never expose in the browser).");
    console.error("");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function ensureBucket(name, isPublic) {
    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) throw listErr;
    if (buckets?.some((b) => b.name === name)) {
      console.log(`Bucket "${name}" already exists.`);
      return;
    }
    const { error } = await supabase.storage.createBucket(name, { public: isPublic });
    if (error) throw error;
    console.log(`Created bucket "${name}" (public=${isPublic}).`);
  }

  await ensureBucket(privateBucket, false);
  await ensureBucket(publicBucket, true);

  console.log("");
  console.log("Storage buckets ready.");
  console.log(`Private uploads: ${privateBucket}`);
  console.log(`Public assets: ${publicBucket}`);
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
