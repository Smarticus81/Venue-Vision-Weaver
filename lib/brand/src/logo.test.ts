import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { brandMarkSvg } from "./email.js";
import { iconSvg, lockupSvg, logoAssetUrl, logoColors, LOCKUP_HEIGHT, LOCKUP_WIDTH } from "./logo.js";
import { contrastRatio } from "./contrast.js";
import { semantic } from "./tokens.js";

test("logo renderers reference generated artwork, not replacement geometry", () => {
  assert.match(iconSvg(), /<image.*dreemer-mark-ink\.png/);
  assert.match(lockupSvg("reversed"), /<image.*dreemer-lockup-reversed\.png/);
  assert.match(brandMarkSvg(semantic.text), /<img.*dreemer-mark-ink\.png/);
  assert.equal(logoAssetUrl("wordmark", "color"), "/brand/dreemer-wordmark-ink.png");
  assert.doesNotMatch(lockupSvg(), /<path|<text|data:image/);
  assert.ok(contrastRatio(logoColors("color").mark, semantic.canvas) >= 4.5);
});

test("canonical ink crops preserve original OpenAI pixels exactly; reverse preserves alpha", async () => {
  const dir = new URL("../assets/logo/", import.meta.url);
  const source = fileURLToPath(new URL("dreemer-openai-source.png", dir));
  const crops = { lockup: { left: 56, top: 148, width: 2069, height: 450 }, mark: { left: 56, top: 148, width: 485, height: 450 }, wordmark: { left: 578, top: 226, width: 1547, height: 307 } };
  for (const [part, crop] of Object.entries(crops)) {
    const inkFile = fileURLToPath(new URL(`dreemer-${part}-ink.png`, dir));
    const reversedFile = fileURLToPath(new URL(`dreemer-${part}-reversed.png`, dir));
    assert.deepEqual(await sharp(inkFile).raw().toBuffer(), await sharp(source).extract(crop).raw().toBuffer());
    assert.deepEqual(await sharp(inkFile).extractChannel("alpha").raw().toBuffer(), await sharp(reversedFile).extractChannel("alpha").raw().toBuffer());
    const publicFile = fileURLToPath(new URL(`../../../artifacts/wedding-app/public/brand/dreemer-${part}-ink.png`, import.meta.url));
    const webWidth = part === "lockup" ? 960 : part === "wordmark" ? 768 : 384;
    assert.deepEqual(await sharp(publicFile).raw().toBuffer(), await sharp(inkFile).resize({ width: webWidth, withoutEnlargement: true }).raw().toBuffer());
  }
});

test("standalone SVG exports embed the artwork for offline/server rendering", async () => {
  for (const variant of ["ink", "reversed"]) {
    const svg = await readFile(new URL(`../assets/logo/dreemer-lockup-${variant}.svg`, import.meta.url), "utf8");
    assert.match(svg, /xlink:href="data:image\/png;base64,/);
    assert.doesNotMatch(svg, /<path|<text/);
    const { channels } = await sharp(Buffer.from(svg)).stats();
    assert.ok(channels[3]!.stdev > 40, "Logo alpha is empty or solid");
  }
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

test("social card contains visible artwork, not a blank export", async () => {
  const { fileURLToPath } = await import("node:url");
  const file = fileURLToPath(new URL("../assets/logo/og-image.png", import.meta.url));
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  const stats = await sharp(file).stats();
  assert.ok(stats.channels.slice(0, 3).every((channel) => channel.stdev > 20), "social card is blank or nearly uniform");
});

test("every walkthrough source panel has visible content", async () => {
  const { fileURLToPath } = await import("node:url");
  for (const name of ["library", "gallery", "sales"]) {
    const file = fileURLToPath(new URL(`../../../artifacts/wedding-app/public/brand/product-${name}.jpg`, import.meta.url));
    const stats = await sharp(file).stats();
    assert.ok(stats.channels.slice(0, 3).every(channel => channel.stdev > 20), `${name}: blank screenshot`);
  }
});
