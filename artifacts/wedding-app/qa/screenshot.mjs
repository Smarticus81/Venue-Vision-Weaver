#!/usr/bin/env node
/**
 * Renders the isolated UI fixture (qa/vite.config.ts, port 8082) into PNGs.
 * Needs the fixture server running and Playwright resolvable (global install
 * is fine: `npm i -g playwright`; Chromium from PLAYWRIGHT_BROWSERS_PATH).
 *
 *   node qa/screenshot.mjs <outDir> [baseUrl]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const outDir = process.argv[2] ?? "screenshots";
const base = process.argv[3] ?? "http://127.0.0.1:8082";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const pages = [
  { name: "landing", path: "/" },
  { name: "login", path: "/login" },
  { name: "couple-venue", path: "/preview/willow" },
  { name: "couple-photos", path: "/preview/willow", action: async (page) => page.getByTestId("visualize-cta").click() },
  { name: "gallery", path: "/v/demo" },
  { name: "dashboard", path: "/dashboard" },
  { name: "control", path: "/control" },
  { name: "control-outreach", path: "/control", action: async (page) => page.getByRole("button", { name: /^Outreach/ }).click() },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    // ignoreHTTPSErrors: sandboxed CI often sits behind a TLS-inspecting proxy; without it Google Fonts never load.
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    for (const entry of pages) {
      await page.goto(base + entry.path, { waitUntil: "networkidle" });
      if (entry.action) {
        await entry.action(page);
        await page.waitForTimeout(400);
      }
      // Wait for the brand faces; a shot with fallback fonts misrepresents the design.
      const waitForFonts = () =>
        page
          .waitForFunction(
            () => document.fonts.check('600 20px "Outfit"') && document.fonts.check('400 16px "Figtree"'),
            null,
            { timeout: 15000 },
          )
          .then(() => true)
          .catch(() => false);
      let fontsReady = await waitForFonts();
      if (!fontsReady) {
        // A cold font fetch through a slow proxy can miss the first load; one reload usually lands it.
        await page.reload({ waitUntil: "networkidle" });
        if (entry.action) {
          await entry.action(page);
          await page.waitForTimeout(400);
        }
        fontsReady = await waitForFonts();
      }
      if (!fontsReady) console.warn(`warning: web fonts did not load for ${entry.name} (${vp.name})`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const file = path.join(outDir, `${entry.name}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("saved", file);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
