/**
 * Build the 1200x630 social card locally, with no browser, network or font fetch.
 * The logo is shared vector geometry; the photo is the committed labelled demo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { lockupSvg } from "../src/logo.js";
import { brand, semantic } from "../src/tokens.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(here, "../assets/logo");
const publicDir = path.resolve(here, "../../../artifacts/wedding-app/public");
mkdirSync(assetDir, { recursive: true });
// SVG rasterizers do not consistently decode embedded WebP; PNG is portable.
const image = (await sharp(path.join(publicDir, "brand/compare-couple.webp")).png().toBuffer()).toString("base64");
const logo = lockupSvg("color").replace("<svg ", '<svg x="72" y="65" width="265" height="55" ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<defs><clipPath id="portrait"><path d="M 790 220 A 170 170 0 0 1 1130 220 V 555 Q 1130 575 1110 575 H 810 Q 790 575 790 555 Z"/></clipPath></defs>
<rect width="1200" height="630" fill="${semantic.canvas}"/>
${logo}
<g font-family="Arial, Helvetica, sans-serif" fill="${semantic.text}">
<text x="72" y="248" font-size="76" letter-spacing="-3">Let them see</text>
<text x="72" y="334" font-size="76" letter-spacing="-3">their day <tspan fill="${semantic.accentText}">here.</tspan></text>
<text x="76" y="410" font-size="28" fill="${semantic.textSecondary}">Personalized AI wedding galleries</text>
<text x="76" y="450" font-size="28" fill="${semantic.textSecondary}">for your venue.</text>
<text x="76" y="565" font-size="23" fill="${semantic.accentText}">${brand.domain}</text>
</g>
<image x="790" y="50" width="340" height="525" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${image}" clip-path="url(#portrait)"/>
<text x="960" y="604" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" fill="${semantic.textMuted}">Example venue and couple · AI preview</text>
</svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(assetDir, "og-image.svg"), svg);
for (const directory of [assetDir, publicDir]) writeFileSync(path.join(directory, "og-image.png"), png);
console.log("Wrote social card and public copy.");
