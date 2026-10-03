/**
 * Renders the Open Graph / Twitter card (1200×630) with the lockup and the
 * brand line, using the real web fonts. Needs Playwright + Chromium.
 *
 * Run: pnpm --filter @workspace/brand run build:og
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockupSvg } from "../src/logo.js";
import { brand, font, fontImportUrl, semantic } from "../src/tokens.js";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(here, "../assets/logo");
const publicDir = path.resolve(here, "../../../artifacts/wedding-app/public");
mkdirSync(assetDir, { recursive: true });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="${fontImportUrl}">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; background: ${semantic.canvas}; color: ${semantic.text}; font-family: ${font.body}; }
  .card { position: relative; width: 1200px; height: 630px; padding: 72px 80px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between; }
  .lockup svg { height: 64px; width: auto; display: block; }
  h1 { font-family: ${font.display}; font-weight: 600; font-size: 92px; line-height: 1.02; letter-spacing: -0.03em; margin: 0; max-width: 880px; }
  h1 span { color: ${semantic.accentText}; }
  p { font-size: 30px; line-height: 1.35; margin: 24px 0 0; color: ${semantic.textSecondary}; max-width: 820px; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; font-size: 24px; color: ${semantic.textMuted}; }
  .rule { position: absolute; left: 80px; right: 80px; bottom: 150px; height: 2px; background: ${semantic.border}; }
</style></head>
<body><div class="card">
  <div class="lockup">${lockupSvg("color")}</div>
  <div>
    <h1>Turn tours into <span>bookings.</span></h1>
    <p>Couples see themselves married at your venue, during or right after the tour.</p>
  </div>
  <div class="rule"></div>
  <div class="foot"><span>${brand.domain}</span><span>For wedding venues</span></div>
</div></body></html>`;

const htmlPath = path.join(assetDir, "og-image.html");
writeFileSync(htmlPath, html);

const browser = await chromium.launch();
try {
  // ignoreHTTPSErrors: lets the Google Fonts stylesheet load behind TLS-inspecting proxies.
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
  await page.evaluate(() => Promise.all([document.fonts.load("600 92px Outfit"), document.fonts.load("400 30px Figtree"), document.fonts.ready]));
  const out = path.join(assetDir, "og-image.png");
  await page.screenshot({ path: out, type: "png" });
  copyFileSync(out, path.join(publicDir, "og-image.png"));
  console.log("wrote", path.relative(process.cwd(), out), "and the public copy");
} finally {
  await browser.close();
}
