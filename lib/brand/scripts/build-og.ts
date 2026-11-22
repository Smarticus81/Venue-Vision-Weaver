/** Generate the product-led social card from the captured illustrative interface. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { lockupSvg } from "../src/logo.js";
import { semantic } from "../src/tokens.js";
const here=path.dirname(fileURLToPath(import.meta.url));
const assetDir=path.resolve(here,"../assets/logo");
const publicDir=path.resolve(here,"../../../artifacts/wedding-app/public");
mkdirSync(assetDir,{recursive:true});
const image=(await sharp(path.join(publicDir,"brand/product-sales.jpg")).png().toBuffer()).toString("base64");
const logo=lockupSvg("reversed").replace("<svg ",'<svg x="60" y="48" width="250" height="40" ');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630">
<rect width="1200" height="630" fill="${semantic.inkSurface}"/>${logo}
<g font-family="Arial, Helvetica, sans-serif"><text x="60" y="168" fill="#C5CCCC" font-size="18">VISUAL SALES SOFTWARE FOR VENUES</text>
<text x="60" y="258" fill="white" font-weight="bold" font-size="58">TURN INTEREST</text>
<text x="60" y="330" fill="${semantic.accent}" font-weight="bold" font-size="58">INTO INTENT.</text>
<text x="60" y="412" fill="#C5CCCC" font-size="21">Personalized galleries.</text><text x="60" y="448" fill="#C5CCCC" font-size="21">Engagement signals.</text><text x="60" y="484" fill="#C5CCCC" font-size="21">Your next booking conversation.</text>
<text x="60" y="574" fill="white" font-size="20">dreemer.co</text></g>
<image x="590" y="180" width="570" height="350" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${image}"/>
<text x="600" y="570" fill="#AAB6B6" font-family="Arial" font-size="14">Illustrative product interface · AI preview imagery</text>
</svg>`;
const png=await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(path.join(assetDir,"og-image.svg"),svg);
for(const dir of [assetDir,publicDir]) writeFileSync(path.join(dir,"og-image.png"),png);
console.log("Wrote product-led social card.");
