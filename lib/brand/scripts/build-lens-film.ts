/** Original motion-design film. AI concept imagery, not filmed footage or Seedance. */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { lockupSvg } from "../src/logo.js";
import { semantic } from "../src/tokens.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const media = path.join(root, "artifacts/wedding-app/public/brand");
const temp = path.join(root, "qa-output/lens-film");
await mkdir(temp, { recursive: true });
const logo = lockupSvg().replace("<svg ", '<svg x="64" y="50" width="230" height="34" ');
const backdrop = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
<defs><radialGradient id="h"><stop stop-color="${semantic.lensGlow}"/><stop offset="1" stop-color="${semantic.canvas}"/></radialGradient></defs>
<rect width="1280" height="720" fill="${semantic.canvas}"/><circle cx="930" cy="350" r="355" fill="url(#h)"/>
<ellipse cx="930" cy="350" rx="318" ry="325" fill="none" stroke="${semantic.lensLine}"/>
${logo}<g font-family="Arial, Helvetica, sans-serif" fill="${semantic.text}">
<text x="64" y="178" font-size="14" letter-spacing="2">A NEW PERSPECTIVE ON VENUE SALES</text>
<text x="58" y="290" font-size="88" letter-spacing="-5">Beyond</text><text x="58" y="388" font-size="88" letter-spacing="-5">the tour.</text>
<text x="64" y="463" font-size="22">Your space. Their possibility.</text>
<text x="64" y="503" font-size="18">Personalized galleries. A more personal follow-up.</text>
<text x="64" y="610" font-size="20" fill="${semantic.accentText}">dreemer.co</text>
<text x="64" y="678" font-size="13" fill="${semantic.textMuted}">MOTION DESIGN · AI CONCEPT VENUE AND PREVIEW · NOT CUSTOMER FOOTAGE</text></g></svg>`;
await sharp(Buffer.from(backdrop)).png().toFile(path.join(temp, "backdrop.png"));
const lens = await sharp(path.join(media, "lens-venue-1536.webp")).resize(600,600,{fit:"cover"}).composite([{input:Buffer.from('<svg width="600" height="600"><circle cx="300" cy="300" r="286" fill="white"/></svg>'),blend:"dest-in"}]).png().toBuffer();
await sharp(path.join(temp,"backdrop.png")).composite([{input:lens,left:630,top:50}]).webp({quality:86}).toFile(path.join(media,"lens-film-poster.webp"));
const blend = "A*(1-min(1,max(0,(T-4)/3)))+B*min(1,max(0,(T-4)/3))";
const filters = `[0:v]scale=900:600,crop=600:600,setsar=1,format=rgba[a];[1:v]scale=900:600,crop=600:600,setsar=1,format=rgba[b];[a][b]blend=all_expr='${blend}',format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-300,2)+pow(Y-300,2),pow(286+7*sin(T*.45),2)),255,0)'[lens];[2:v][lens]overlay=x='630+5*sin(t*.35)':y='50+5*sin(t*.4)',format=yuv420p[out]`;
const encode = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner","-loglevel","error","-y","-loop","1","-framerate","30","-i",path.join(media,"lens-venue-1536.webp"),"-loop","1","-framerate","30","-i",path.join(media,"lens-vision-1536.webp"),"-loop","1","-framerate","30","-i",path.join(temp,"backdrop.png"),"-filter_complex",filters,"-map","[out]","-t","15","-c:v","libx264","-preset","medium","-crf","22","-an","-movflags","+faststart",path.join(media,"lens-film.mp4")], { encoding:"utf8" });
if (encode.status !== 0) throw Error(encode.stderr || "Lens film encode failed");
await writeFile(path.join(media,"lens-film.vtt"), "WEBVTT\n\n00:00.000 --> 00:04.500\nStart with photos of your venue.\n\n00:04.500 --> 00:09.500\nGive each couple a personalized AI preview.\n\n00:09.500 --> 00:15.000\nFollow engagement. Bring the conversation back to your business.\n");
console.log("Built 15-second original lens motion-design film, poster and captions.");
