/** Reproducible social artwork for the possibility-lens identity. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { lockupSvg } from "../src/logo.js";
import { semantic } from "../src/tokens.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(here, "../assets/logo");
const publicDir = path.resolve(here, "../../../artifacts/wedding-app/public");
mkdirSync(assetDir, { recursive: true });
const image = (await sharp(path.join(publicDir, "brand/lens-vision-800.webp")).png().toBuffer()).toString("base64");
const logo = lockupSvg().replace("<svg ", '<svg x="58" y="46" width="260" height="34" ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630">
<defs><clipPath id="lens"><circle cx="900" cy="318" r="240"/></clipPath><radialGradient id="glow"><stop stop-color="${semantic.lensGlow}"/><stop offset="1" stop-color="${semantic.canvas}"/></radialGradient></defs>
<rect width="1200" height="630" fill="${semantic.canvas}"/><circle cx="900" cy="318" r="390" fill="url(#glow)"/>${logo}
<g font-family="Arial, Helvetica, sans-serif" fill="${semantic.text}"><text x="58" y="157" font-size="15" letter-spacing="1">VISUAL SALES SOFTWARE FOR VENUES</text>
<text x="52" y="277" font-size="100" letter-spacing="-7">Beyond</text><text x="52" y="377" font-size="100" letter-spacing="-7">the tour<tspan fill="${semantic.accent}">.</tspan></text>
<text x="58" y="451" font-size="21">Personal AI previews. Meaningful sales signals.</text>
<text x="58" y="560" font-size="19">dreemer.co</text></g>
<circle cx="900" cy="318" r="271" fill="none" stroke="${semantic.borderStrong}"/><circle cx="900" cy="318" r="257" fill="none" stroke="white" stroke-width="8"/>
<image x="540" y="78" width="720" height="480" clip-path="url(#lens)" xlink:href="data:image/png;base64,${image}"/>
<text x="720" y="608" fill="${semantic.textMuted}" font-family="Arial" font-size="12">AI concept venue and preview · illustrative</text></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(assetDir, "og-image.svg"), svg);
for (const dir of [assetDir, publicDir]) writeFileSync(path.join(dir, "og-image.png"), png);
console.log("Wrote possibility-lens social card.");
