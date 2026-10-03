#!/usr/bin/env node
/** Re-encodes PNG screenshots in a folder as JPEG (quality 82) to keep the repo light. */
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(path.resolve("artifacts/api-server/package.json"));
const sharp = require("sharp");
const dir = process.argv[2];
for (const f of await readdir(dir)) {
  if (!f.endsWith(".png")) continue;
  const src = path.join(dir, f);
  await sharp(src).jpeg({ quality: 82, mozjpeg: true }).toFile(src.replace(/\.png$/, ".jpg"));
  await unlink(src);
}
console.log("compressed", dir);
