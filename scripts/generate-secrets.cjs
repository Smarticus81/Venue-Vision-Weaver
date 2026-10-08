/**
 * Generate a cryptographically secure value for UPLOAD_TOKEN_SECRET.
 * Usage: node scripts/generate-secrets.cjs
 *        pnpm run generate:secrets
 */
const crypto = require("crypto");

function generateSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

const uploadTokenSecret = generateSecret();

console.log("");
console.log("Add this to .env and Railway (use a different value in each environment):");
console.log("");
console.log(`UPLOAD_TOKEN_SECRET=${uploadTokenSecret}`);
console.log("");
