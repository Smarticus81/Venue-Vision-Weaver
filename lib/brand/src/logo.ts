/** Forward-frame identity: solid uppercase geometry; no font dependency. */
import { coral, ink, ivory } from "./tokens.js";
export type LogoVariant = "color" | "ink" | "reversed";
export const WORDMARK_STROKE = 0;
export const WORDMARK_HEIGHT = 100;
const glyphs = {
 D: "M0 0H37Q76 0 76 40V60Q76 100 37 100H0Z M21 20V80H35Q54 80 54 59V41Q54 20 35 20Z",
 R: "M0 0H40Q73 0 73 31Q73 53 54 61L78 100H53L30 65H21V100H0Z M21 19V46H38Q52 46 52 32Q52 19 38 19Z",
 E: "M0 0H64V20H21V39H57V59H21V80H64V100H0Z",
 M: "M0 100V0H22L47 45L72 0H94V100H73V38L47 79L21 38V100Z",
};
export const WORDMARK_OFFSETS = [0,88,176,252,328,434,510] as const;
export const WORDMARK_PATHS = (["D","R","E","E","M","E","R"] as const).map(l=>glyphs[l]);
export const WORDMARK_WIDTH = 588;
export const ICON_SIZE=100;
export const ICON_BODY_PATH="M8 12H48L86 50L48 88H8L46 50Z M30 24L56 50L30 76H43L69 50L43 24Z";
export const ICON_LINE_PATHS: readonly string[]=[];
export const ICON_SPARK_PATHS: readonly string[]=[];
export const ICON_LINE_STROKE=0;
export const ICON_SPARK_STROKE=0;
export const LOCKUP_GAP=22;
export const LOCKUP_ICON_SCALE=100/76;
export const LOCKUP_ICON_OFFSET_Y=-12*LOCKUP_ICON_SCALE;
export const LOCKUP_ICON_WIDTH=100*LOCKUP_ICON_SCALE;
export const LOCKUP_WIDTH=LOCKUP_ICON_WIDTH+LOCKUP_GAP+WORDMARK_WIDTH;
export const LOCKUP_HEIGHT=100;
export function logoColors(variant:LogoVariant) {
 if(variant==="ink") return {mark:ink[900],line:ink[900],word:ink[900],background:null};
 if(variant==="reversed") return {mark:coral[500],line:coral[500],word:ivory[0],background:ink[900]};
 return {mark:coral[700],line:coral[700],word:ink[900],background:null};
}
export function wordmarkGroup(fill:string) {
 return '<g fill="'+fill+'" fill-rule="evenodd">'+WORDMARK_PATHS.map((d,i)=>'<path transform="translate('+WORDMARK_OFFSETS[i]+' 0)" d="'+d+'"/>').join("")+'</g>';
}
function svg(content:string,w:number,h:number,variant:LogoVariant,pad=0) {
 const c=logoColors(variant);
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+[-pad,-pad,w+pad*2,h+pad*2].join(" ")+'" role="img" aria-label="Dreemer">'+(c.background?'<rect x="'+(-pad)+'" y="'+(-pad)+'" width="'+(w+pad*2)+'" height="'+(h+pad*2)+'" fill="'+c.background+'"/>':"")+content+"</svg>\n";
}
export function iconSvg(variant:LogoVariant="color",options:{padding?:number}={}) {
 return svg('<path d="'+ICON_BODY_PATH+'" fill="'+logoColors(variant).mark+'" fill-rule="evenodd"/>',100,100,variant,options.padding);
}
export function wordmarkSvg(variant:LogoVariant="color",options:{padding?:number}={}) {
 return svg(wordmarkGroup(logoColors(variant).word),WORDMARK_WIDTH,100,variant,options.padding);
}
export function lockupSvg(variant:LogoVariant="color",options:{padding?:number}={}) {
 const c=logoColors(variant);
 return svg('<g transform="translate(0 '+LOCKUP_ICON_OFFSET_Y+') scale('+LOCKUP_ICON_SCALE+')"><path d="'+ICON_BODY_PATH+'" fill="'+c.mark+'" fill-rule="evenodd"/></g><g transform="translate('+(LOCKUP_ICON_WIDTH+LOCKUP_GAP)+' 0)">'+wordmarkGroup(c.word)+'</g>',LOCKUP_WIDTH,100,variant,options.padding);
}
export function tileSvg(options:{size?:number;variant?:"light"|"dark";simplified?:boolean;rounded?:boolean;inset?:number}={}) {
 const size=options.size??512;const dark=options.variant==="dark";const inset=options.inset??10;
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" aria-label="Dreemer"><rect width="'+size+'" height="'+size+'" rx="'+(options.rounded===false?0:size*.06)+'" fill="'+(dark?ink[900]:coral[500])+'"/><g transform="scale('+(size/100)+') translate('+inset+' '+inset+') scale('+((100-inset*2)/100)+')"><path d="'+ICON_BODY_PATH+'" fill="'+(dark?ivory[0]:ink[900])+'" fill-rule="evenodd"/></g></svg>\n';
}
