const fs = require("node:fs");
const path = require("node:path");

for (const file of ["package-lock.json", "yarn.lock"]) {
  const target = path.join(__dirname, "..", file);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
