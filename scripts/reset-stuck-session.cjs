const path = require("path");
const fs = require("fs");
const { Client } = require(path.join(__dirname, "..", "lib", "db", "node_modules", "pg"));

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const sessionId = Number(process.argv[2] || 0);
const mode = process.argv[3] || "reset";

if (!sessionId || !["reset", "ready"].includes(mode)) {
  console.error("Usage: node scripts/reset-stuck-session.cjs <sessionId> [reset|ready]");
  process.exit(1);
}

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  if (mode === "ready") {
    const result = await client.query(
      `WITH asset_bundle AS (
         SELECT
           session_id,
           COUNT(*) AS total_assets,
           COUNT(*) FILTER (
             WHERE asset_type = 'image' AND display_order IN (1, 2, 3, 4)
           ) AS required_stills,
           COUNT(*) FILTER (
             WHERE asset_type = 'video' AND display_order = 0
           ) AS required_reels
         FROM generated_assets
         WHERE session_id = $1
         GROUP BY session_id
       )
       UPDATE couple_sessions SET status = 'ready', error_message = NULL, completed_at = NOW()
       WHERE id = $1 AND status IN ('failed', 'processing')
       AND EXISTS (
         SELECT 1
         FROM asset_bundle
         WHERE asset_bundle.session_id = couple_sessions.id
           AND total_assets = 5
           AND required_stills = 4
           AND required_reels = 1
       )
       RETURNING id`,
      [sessionId],
    );
    if (result.rowCount === 0) {
      console.log("Marked ready rows: 0. Session must be failed/processing and have a complete V1 gallery bundle: four stills plus one motion reel.");
    } else {
      console.log("Marked ready rows:", result.rowCount);
    }
  } else {
    await client.query("DELETE FROM generated_assets WHERE session_id = $1", [sessionId]);
    const result = await client.query(
      "UPDATE couple_sessions SET status = 'pending', error_message = NULL, completed_at = NULL WHERE id = $1 AND status IN ('processing', 'failed') RETURNING id",
      [sessionId],
    );
    console.log("Reset rows:", result.rowCount);
  }

  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
