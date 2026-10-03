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
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const entry of pages) {
      await page.goto(base + entry.path, { waitUntil: "networkidle" });
      if (entry.action) {
        await entry.action(page);
        await page.waitForTimeout(400);
      }
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
