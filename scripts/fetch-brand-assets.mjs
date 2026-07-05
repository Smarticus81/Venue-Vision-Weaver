#!/usr/bin/env node
/**
 * Downloads the Higgsfield-generated brand imagery into
 * artifacts/wedding-app/public/brand so it can be self-hosted.
 * Run from the repo root on a machine with open network access, then
 * build the wedding-app with VITE_LOCAL_BRAND_ASSETS=1.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CDN_BASE = "https://d8j0ntlcm91z4.cloudfront.net/user_3FvUSDWlpMZmeo552NjYHGJ67RL";

const ASSETS = {
  "hero-atmosphere.webp": `${CDN_BASE}/hf_20260705_205658_eb2a1a7c-4ce0-444d-82d7-4aa96873ce73_min.webp`,
  "frame-ceremony.webp": `${CDN_BASE}/hf_20260705_205704_73ea4c99-08d9-435e-852a-5a4a1eabab32_min.webp`,
  "frame-first-dance.webp": `${CDN_BASE}/hf_20260705_205829_1a4cd4b3-bc16-4489-b1e9-1ec6893e1a5a_min.webp`,
  "frame-golden-hour.webp": `${CDN_BASE}/hf_20260705_205832_fd9973ea-4be7-4105-9076-2b4767cea833_min.webp`,
  "frame-reel-still.webp": `${CDN_BASE}/hf_20260705_205835_eee8b83b-0301-44a7-aca4-0a0bb7b50e70_min.webp`,
};

const outDir = join(process.cwd(), "artifacts/wedding-app/public/brand");
await mkdir(outDir, { recursive: true });

for (const [name, url] of Object.entries(ASSETS)) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`FAILED ${name}: ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    continue;
  }
  await writeFile(join(outDir, name), Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${name}`);
}
console.log("Done. Files land in artifacts/wedding-app/public/brand (the app serves them from /brand).");
