/**
 * Generates every logo file from src/logo.ts:
 *   lib/brand/assets/logo/            canonical SVGs + PNG exports (all logo files in one folder)
 *   artifacts/wedding-app/public/     the deploy copies index.html / the manifest reference
 *
 * Run: pnpm --filter @workspace/brand run build:logo
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { iconSvg, lockupSvg, tileSvg, wordmarkSvg, type LogoVariant } from "../src/logo.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(here, "../assets/logo");
const publicDir = path.resolve(here, "../../../artifacts/wedding-app/public");
mkdirSync(assetDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

function write(dir: string, name: string, data: string | Buffer): void {
  writeFileSync(path.join(dir, name), data);
  console.log("wrote", path.relative(process.cwd(), path.join(dir, name)));
}

async function png(svg: string, width: number, height?: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(width, height ?? width, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** ICO container holding PNG-encoded images (supported since Windows Vista and by every browser). */
function ico(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const variants: LogoVariant[] = ["color", "ink", "reversed"];
const pad = { color: 0, ink: 0, reversed: 24 } as const;

for (const variant of variants) {
  write(assetDir, `dreemer-icon-${variant}.svg`, iconSvg(variant, { padding: pad[variant] }));
  write(assetDir, `dreemer-wordmark-${variant}.svg`, wordmarkSvg(variant, { padding: pad[variant] }));
  write(assetDir, `dreemer-lockup-${variant}.svg`, lockupSvg(variant, { padding: pad[variant] }));
}
write(assetDir, "dreemer-tile-light.svg", tileSvg({ variant: "light" }));
write(assetDir, "dreemer-tile-dark.svg", tileSvg({ variant: "dark" }));
write(assetDir, "dreemer-favicon.svg", tileSvg({ size: 64, simplified: true }));

// PNG exports for decks, docs, and email.
write(assetDir, "dreemer-lockup-color@2x.png", await png(lockupSvg("color", { padding: 40 }), 2000));
write(assetDir, "dreemer-lockup-reversed@2x.png", await png(lockupSvg("reversed", { padding: 40 }), 2000));
write(assetDir, "dreemer-icon-color-512.png", await png(iconSvg("color", { padding: 6 }), 512));
write(assetDir, "dreemer-icon-ink-512.png", await png(iconSvg("ink", { padding: 6 }), 512));

// App icons.
const icon192 = await png(tileSvg({ size: 192 }), 192);
const icon512 = await png(tileSvg({ size: 512 }), 512);
const maskable512 = await png(tileSvg({ size: 512, rounded: false, inset: 20 }), 512);
const apple180 = await png(tileSvg({ size: 180, rounded: false }), 180);
const fav16 = await png(tileSvg({ size: 16, simplified: true, inset: 8 }), 16);
const fav32 = await png(tileSvg({ size: 32, simplified: true, inset: 8 }), 32);
const fav48 = await png(tileSvg({ size: 48, simplified: true, inset: 8 }), 48);
const favicon = ico([
  { size: 16, data: fav16 },
  { size: 32, data: fav32 },
  { size: 48, data: fav48 },
]);
const emailLockup = await png(lockupSvg("color", { padding: 10 }), 560);

for (const dir of [assetDir, publicDir]) {
  write(dir, "icon-192.png", icon192);
  write(dir, "icon-512.png", icon512);
  write(dir, "icon-maskable-512.png", maskable512);
  write(dir, "apple-touch-icon.png", apple180);
  write(dir, "favicon.ico", favicon);
  write(dir, "favicon.svg", tileSvg({ size: 64, simplified: true }));
  write(dir, "dreemer-lockup-email.png", emailLockup);
}
