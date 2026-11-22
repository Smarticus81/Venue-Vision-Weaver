/** Split-lens identity: open circular geometry and a wide custom wordmark. */
import { coral, ink, ivory } from "./tokens.js";
export type LogoVariant = "color" | "ink" | "reversed";
export const WORDMARK_STROKE = 0;
export const WORDMARK_HEIGHT = 100;
const glyphs = {
 D: "M0 8H36C67 8 84 24 84 50S67 92 36 92H0Z M14 21V79H35C57 79 69 69 69 50S57 21 35 21Z",
 R: "M0 8H43C68 8 81 18 81 36C81 51 72 60 56 63L84 92H65L37 64H14V92H0Z M14 21V51H42C59 51 67 46 67 36S59 21 42 21Z",
 E: "M0 8H73V21H14V43H64V56H14V79H73V92H0Z",
 M: "M0 92V8H16L51 64L86 8H102V92H88V32L51 89L14 32V92Z",
};
export const WORDMARK_OFFSETS = [0,101,202,292,382,501,591] as const;
export const WORDMARK_PATHS = (["D","R","E","E","M","E","R"] as const).map(l=>glyphs[l]);
export const WORDMARK_WIDTH = 675;
export const ICON_SIZE=100;
export const ICON_BODY_PATH="M47 5C22 5 3 24 3 50S22 95 47 95V81C30 81 17 68 17 50S30 19 47 19Z M53 5V19C70 19 83 32 83 50S70 81 53 81V95C78 95 97 76 97 50S78 5 53 5Z M44 28H56V72H44Z";
export const ICON_LINE_PATHS: readonly string[]=[];
export const ICON_SPARK_PATHS: readonly string[]=[];
export const ICON_LINE_STROKE=0;
export const ICON_SPARK_STROKE=0;
export const LOCKUP_GAP=30;
export const LOCKUP_ICON_SCALE=1;
export const LOCKUP_ICON_OFFSET_Y=0;
export const LOCKUP_ICON_WIDTH=100*LOCKUP_ICON_SCALE;
export const LOCKUP_WIDTH=LOCKUP_ICON_WIDTH+LOCKUP_GAP+WORDMARK_WIDTH;
export const LOCKUP_HEIGHT=100;
export function logoColors(variant:LogoVariant) {
 if(variant==="ink") return {mark:ink[900],line:ink[900],word:ink[900],background:null};
 if(variant==="reversed") return {mark:coral[400],line:coral[400],word:ivory[0],background:ink[900]};
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
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" aria-label="Dreemer"><rect width="'+size+'" height="'+size+'" rx="'+(options.rounded===false?0:size*.06)+'" fill="'+(dark?ink[900]:coral[500])+'"/><g transform="scale('+(size/100)+') translate('+inset+' '+inset+') scale('+((100-inset*2)/100)+')"><path d="'+ICON_BODY_PATH+'" fill="'+ivory[0]+'" fill-rule="evenodd"/></g></svg>\n';
}
