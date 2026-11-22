/** Build a silent, captioned product walkthrough from CUA-captured UI illustrations. Not AI-generated footage. */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { lockupSvg } from "../src/logo.js";
import { semantic } from "../src/tokens.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const publicDir=path.join(root,"artifacts/wedding-app/public/brand");
const temp=path.join(root,"qa-output/product-video");
await mkdir(temp,{recursive:true});
const scenes=[
 {file:"product-library.jpg",title:"YOUR SPACE. READY TO SELL.",copy:"Build a reference library from your venue photos."},
 {file:"product-gallery.jpg",title:"A FOLLOW-UP THEY CAN PICTURE.",copy:"Personalized AI galleries bring the venue back into the conversation."},
 {file:"product-sales.jpg",title:"KNOW WHO IS LEANING IN.",copy:"Follow views, shares and date-link clicks. Record confirmed bookings."},
];
const ffmpeg=process.env.FFMPEG_PATH || "ffmpeg";
for(const [i,scene] of scenes.entries()){
 const shot=await sharp(path.join(publicDir,scene.file)).resize(1152,500,{fit:"contain",background:semantic.inkSurface}).png().toBuffer();
 const logo=lockupSvg("reversed").replace('<svg ','<svg x="1000" y="38" width="210" height="40" ');
 const backdrop=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${semantic.inkSurface}"/><rect x="64" y="35" width="38" height="5" fill="${semantic.accent}"/>${logo}<text x="64" y="90" font-family="Arial" font-weight="bold" font-size="34" fill="white">${scene.title}</text><text x="64" y="130" font-family="Arial" font-size="20" fill="#C5CCCC">${scene.copy}</text><text x="64" y="696" font-family="Arial" font-size="15" fill="#AAB6B6">DREEMER PRODUCT WALKTHROUGH · ILLUSTRATIVE DATA · AI PREVIEW IMAGES</text></svg>`;
 const frame=await sharp(Buffer.from(backdrop)).composite([{input:shot,left:64,top:160}]).png().toBuffer();
 const input=path.join(temp,`scene-${i}.png`);
 await writeFile(input,frame);
 if(i===0) await sharp(frame).webp({quality:84}).toFile(path.join(publicDir,"product-tour-poster.webp"));
 const result=spawnSync(ffmpeg,["-hide_banner","-loglevel","error","-y","-loop","1","-i",input,"-vf","scale=2560:1440,zoompan=z='min(1.012,1+on*0.00008)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=150:s=1280x720:fps=30,fade=t=in:st=0:d=0.2,format=yuv420p","-t","5","-c:v","libx264","-preset","medium","-crf","22","-an","-movflags","+faststart",path.join(temp,`clip-${i}.mp4`)],{encoding:"utf8"});
 if(result.status!==0) throw Error(result.stderr||"Video encoding failed");
}
await writeFile(path.join(temp,"concat.txt"),scenes.map((_,i)=>"file 'clip-"+i+".mp4'").join("\n"));
const final=spawnSync(ffmpeg,["-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",path.join(temp,"concat.txt"),"-c","copy","-movflags","+faststart",path.join(publicDir,"product-tour.mp4")],{encoding:"utf8"});
if(final.status!==0) throw Error(final.stderr||"Video concatenation failed");
await writeFile(path.join(publicDir,"product-tour.vtt"),"WEBVTT\n\n00:00.000 --> 00:05.000\nBuild a reference library from your venue photos.\n\n00:05.000 --> 00:10.000\nCreate personalized AI galleries that bring the venue back into the conversation.\n\n00:10.000 --> 00:15.000\nFollow views, shares and date-link clicks. Record confirmed bookings.\n");
console.log("Built 15-second H.264 product walkthrough, poster and captions.");
