/** Social card with the actual generated logo and licensed venue photography. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(here, "../assets/logo");
const publicDir = path.resolve(here, "../../../artifacts/wedding-app/public");
const photograph = (await sharp(path.join(publicDir, "brand/khp-dusk-1536.webp")).resize(1200,630,{fit:"cover"}).png().toBuffer()).toString("base64");
const logo = readFileSync(path.join(assetDir,"dreemer-lockup-reversed.png")).toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<image width="1200" height="630" href="data:image/png;base64,${photograph}"/>
<rect width="1200" height="630" fill="#241039" opacity=".48"/>
<image x="58" y="48" width="260" height="57" href="data:image/png;base64,${logo}"/>
<g fill="#fff" font-family="Arial,Helvetica,sans-serif">
<text x="58" y="197" font-size="16" letter-spacing="2">SALES TOOLS FOR VENUES</text>
<text x="50" y="307" font-size="102" letter-spacing="-5">Turn tours</text>
<text x="50" y="413" font-size="102" letter-spacing="-5" fill="#ffc786">into bookings.</text>
<text x="58" y="477" font-size="23">Personalized previews. Private galleries. Better follow-up.</text>
<text x="58" y="571" font-size="19">dreemer.co</text>
<text x="660" y="602" font-size="12">Knotting Hill Place · Dusk lighting visualization</text></g></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(assetDir, "og-image.svg"), svg);
for (const dir of [assetDir, publicDir]) writeFileSync(path.join(dir, "og-image.png"), png);
console.log("Wrote photo-led Dreemer social card.");
