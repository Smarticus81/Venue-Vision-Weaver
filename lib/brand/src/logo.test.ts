import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { brandMarkSvg } from "./email.js";
import { iconSvg, lockupSvg, logoColors, LOCKUP_HEIGHT, LOCKUP_WIDTH } from "./logo.js";
import { contrastRatio } from "./contrast.js";
import { semantic } from "./tokens.js";

test("every logo renderer preserves the split-lens and wordmark counters", () => {
  for (const svg of [iconSvg(), lockupSvg(), brandMarkSvg(semantic.text)]) {
    assert.match(svg, /fill-rule="evenodd"/);
  }
  assert.ok(contrastRatio(logoColors("color").mark, semantic.canvas) >= 4.5);
});

test("exported lockups preserve their wide aspect ratio and app icons remain square", async () => {
  const dir = new URL("../assets/logo/", import.meta.url);
  for (const [file, width, padding] of [
    ["dreemer-lockup-color@2x.png", 2000, 40],
    ["dreemer-lockup-email.png", 560, 10],
  ] as const) {
    const { fileURLToPath } = await import("node:url");
    const meta = await sharp(fileURLToPath(new URL(file, dir))).metadata();
    assert.equal(meta.width, width);
    const expected = width * (LOCKUP_HEIGHT + 2 * padding) / (LOCKUP_WIDTH + 2 * padding);
    assert.ok(Math.abs(meta.height! - expected) <= 1, `${file}: incorrect export aspect ratio`);
  }
  const { fileURLToPath } = await import("node:url");
  const icon = await sharp(fileURLToPath(new URL("icon-192.png", dir))).metadata();
  assert.equal(icon.width, 192);
  assert.equal(icon.height, 192);
});

test("social card contains the possibility lens, not a missing embedded image", async () => {
  const { fileURLToPath } = await import("node:url");
  const file = fileURLToPath(new URL("../assets/logo/og-image.png", import.meta.url));
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  // Crop the photographic lens, including architectural and reflection detail.
  const stats = await sharp(file).extract({ left: 600, top: 240, width: 520, height: 240 }).stats();
  assert.ok(stats.channels.slice(0, 3).every((channel) => channel.stdev > 20), "lens area is blank or nearly uniform");
});

test("every walkthrough source panel has visible content", async () => {
  const { fileURLToPath } = await import("node:url");
  for (const name of ["library", "gallery", "sales"]) {
    const file = fileURLToPath(new URL(`../../../artifacts/wedding-app/public/brand/product-${name}.jpg`, import.meta.url));
    const stats = await sharp(file).stats();
    assert.ok(stats.channels.slice(0, 3).every(channel => channel.stdev > 20), `${name}: blank screenshot`);
  }
});
