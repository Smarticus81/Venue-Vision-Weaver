/** Writes tokens.css from src/tokens.ts. Run: pnpm --filter @workspace/brand run build */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssText } from "../src/tokens.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "tokens.css");
writeFileSync(out, cssText());
console.log(`wrote ${path.relative(process.cwd(), out)}`);
