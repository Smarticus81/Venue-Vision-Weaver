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

const slug = process.argv[2];
const amount = Number(process.argv[3] || 0);
const reason = process.argv[4] || "manual_grant";

if (!slug || !amount || Number.isNaN(amount) || amount <= 0) {
  console.error("Usage: node scripts/grant-credits.cjs <venue-slug> <amount> [reason]");
  process.exit(1);
}

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const venueResult = await client.query(
    "SELECT id, name, credits_balance FROM venues WHERE slug = $1",
    [slug],
  );
  const venue = venueResult.rows[0];
  if (!venue) {
    console.error(`Venue not found for slug "${slug}"`);
    await client.end();
    process.exit(2);
  }

  const update = await client.query(
    "UPDATE venues SET credits_balance = credits_balance + $1 WHERE id = $2 RETURNING credits_balance",
    [amount, venue.id],
  );

  await client.query(
    "INSERT INTO credit_transactions (venue_id, delta, reason, stripe_event_id) VALUES ($1, $2, $3, NULL)",
    [venue.id, amount, reason],
  );

  console.log(
    `Granted ${amount} credits to "${venue.name}" (slug: ${slug}). Previous: ${venue.credits_balance}, new balance: ${update.rows[0].credits_balance}`,
  );

  await client.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
