/**
 * Generate cryptographically secure values for UPLOAD_TOKEN_SECRET and SESSION_SECRET.
 * Usage: node scripts/generate-secrets.cjs
 *        pnpm run generate:secrets
 */
const crypto = require("crypto");

function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

const uploadTokenSecret = generateSecret();
const sessionSecret = generateSecret();

console.log("");
console.log("Add these to .env and Railway (use different values in each environment):");
console.log("");
console.log(`UPLOAD_TOKEN_SECRET=${uploadTokenSecret}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
console.log("");
