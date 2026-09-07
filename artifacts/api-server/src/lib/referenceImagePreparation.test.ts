import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  prepareReferenceImage,
  referenceTargetDimensions,
} from "./referenceImagePreparation.js";

test("raises a small reference to a 1024px minimum edge", () => {
  assert.deepEqual(referenceTargetDimensions(256, 384), {
    width: 1024,
    height: 1536,
    upscaled: true,
  });
});

test("bounds a large reference without dropping below the minimum edge", () => {
  assert.deepEqual(referenceTargetDimensions(4000, 3000), {
    width: 2048,
    height: 1536,
    upscaled: false,
  });
  assert.deepEqual(referenceTargetDimensions(6000, 1500), {
    width: 4096,
    height: 1024,
    upscaled: false,
  });
});

test("creates an identity-safe upscaled JPEG while leaving the source buffer unchanged", async () => {
  const source = await sharp({
    create: {
      width: 320,
      height: 480,
      channels: 3,
      background: { r: 118, g: 92, b: 74 },
    },
  })
    .jpeg()
    .toBuffer();
  const original = Buffer.from(source);

  const prepared = await prepareReferenceImage({ buffer: source, mimeType: "image/jpeg" });
  const metadata = await sharp(prepared.buffer).metadata();

  assert.equal(prepared.sourceWidth, 320);
  assert.equal(prepared.sourceHeight, 480);
  assert.equal(prepared.width, 1024);
  assert.equal(prepared.height, 1536);
  assert.equal(prepared.upscaled, true);
  assert.equal(metadata.format, "jpeg");
  assert.deepEqual(source, original);
});
