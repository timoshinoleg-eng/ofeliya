import { clearMeasurementCache, drawText } from '../vendor/canvas-txt/index.js';
import { RESULT_COPY, SHARE_BOT_HANDLE } from '../game/UiCopy';
import type { RunResult } from '../game/RunContracts';
import type { PlatformKind } from '../platform/PlatformBridge';
import type { PreparedFile } from '../platform/ResultFileShare';

const FONT = '"Chakra Petch", Arial, sans-serif';
const C = { bg: '#080f14', panel: '#111d22', bone: '#f0eadb', pink: '#d18a9e', mint: '#a4cbb5', cyan: '#91cbd2', coral: '#e37a78' };
export interface RunShareCardInput {
  run: Pick<RunResult, 'win' | 'timeMs' | 'kills' | 'hostCellsInfected' | 'stageOrder' | 'highestLevel' | 'records'>;
  platform: PlatformKind;
  name?: string | null;
  mutations?: readonly string[];
}
function handle(platform: PlatformKind): string {
  // A public MAX result card must identify OFELIYA, not arbitrary host configuration.
  if (platform === 'max') return '@id402806822924_5_bot';
  const env = import.meta.env;
  const raw = String(env.VITE_TG_BOT_USERNAME || env.VITE_TELEGRAM_BOT_NAME || '').trim().replace(/^@/, '');
  // Numeric MAX account handles are not Telegram project identities.
  if (!/^[A-Za-z0-9_]{1,64}$/.test(raw) || /^id\d+_\d+_bot$/i.test(raw)) return SHARE_BOT_HANDLE;
  return '@' + raw;
}
function round(ctx: CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number): void {
  const q=Math.max(0,Math.min(r,w/2,h/2));
  ctx.beginPath();ctx.moveTo(x+q,y);ctx.arcTo(x+w,y,x+w,y+h,q);ctx.arcTo(x+w,y+h,x,y+h,q);
  ctx.arcTo(x,y+h,x,y,q);ctx.arcTo(x,y,x+w,y,q);ctx.closePath();
}
function panel(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,accent:string):void {
  round(ctx,x,y,w,h,20);ctx.fillStyle=C.panel;ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.stroke();
}
function text(ctx:CanvasRenderingContext2D,value:string,x:number,y:number,w:number,h:number,size:number,color:string,weight=600,lines=1):void {
  ctx.fillStyle=color;
  drawText(ctx,value,{x,y,width:w,height:h,font:FONT,fontSize:size,fontWeight:weight,align:'left',vAlign:'middle',overflow:'ellipsis',maxLines:lines,cache:false});
}
function number(n:number):string {return Math.max(0,Math.round(Number.isFinite(n)?n:0)).toLocaleString('ru-RU');}
function time(ms:number):string {const s=Math.max(0,Math.floor((Number.isFinite(ms)?ms:0)/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
async function readyFonts():Promise<void>{
  if(!document.fonts)return;
  const ready=Promise.resolve(document.fonts.ready).then(()=>{clearMeasurementCache();},()=>{});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([ready,new Promise<void>(resolve=>{timer=setTimeout(resolve,200);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function renderRunShareCard(data:RunShareCardInput):Promise<PreparedFile>{
  await readyFonts();
  const canvas=document.createElement('canvas');canvas.width=780;canvas.height=1040;
  const dispose=():void=>{canvas.width=0;canvas.height=0;};
  try{
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Share canvas unavailable');
    const r=data.run,accent=r.win?C.mint:C.coral;
    const bg=ctx.createRadialGradient(390,270,30,390,420,700);bg.addColorStop(0,C.panel);bg.addColorStop(1,C.bg);ctx.fillStyle=bg;ctx.fillRect(0,0,780,1040);
    round(ctx,25,25,730,990,27);ctx.strokeStyle=C.cyan;ctx.globalAlpha=.4;ctx.lineWidth=2;ctx.stroke();ctx.globalAlpha=1;
    text(ctx,RESULT_COPY.header,54,55,672,28,20,C.cyan);
    text(ctx,'OFELIYA: STRAIN ZERO',54,92,672,65,42,C.bone,700);
    panel(ctx,54,180,672,204,accent);
    // A static microscope lens, not an extra live game sprite.
    const cx=156,cy=282;
    const lens=ctx.createRadialGradient(cx,cy,5,cx,cy,78);lens.addColorStop(0,accent);lens.addColorStop(1,C.bg);
    ctx.fillStyle=lens;ctx.beginPath();ctx.arc(cx,cy,72,0,Math.PI*2);ctx.fill();ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.stroke();
    ctx.strokeStyle=C.cyan;ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(cx-60,cy);ctx.lineTo(cx+60,cy);ctx.moveTo(cx,cy-60);ctx.lineTo(cx,cy+60);ctx.stroke();ctx.globalAlpha=1;
    text(ctx,r.win?RESULT_COPY.victory:RESULT_COPY.defeat,250,204,448,56,27,accent,700,2);
    text(ctx,r.stageOrder>=2?'СЕРДЦЕ':'КРОВОТОК',250,268,448,35,24,C.cyan);
    if(data.name)text(ctx,data.name,250,307,448,44,27,C.bone,600);
    const stats=[['ВРЕМЯ',time(r.timeMs)],['УНИЧТОЖЕНО',number(r.kills)],['ЗАРАЖЕНО',number(r.hostCellsInfected)]];
    stats.forEach(([label,value],i)=>{const x=54+i*228;panel(ctx,x,408,216,124,C.cyan);text(ctx,label,x+14,420,188,28,17,C.cyan);text(ctx,value,x+14,458,188,52,36,C.bone,700);});
    panel(ctx,54,558,672,95,C.mint);text(ctx,'МУТАЦИЯ',74,570,300,30,18,C.mint);text(ctx,number(r.highestLevel),74,600,620,40,30,C.bone,700);
    const names=(data.mutations??[]).slice(0,5);
    if(names.length){text(ctx,RESULT_COPY.legendary,54,671,672,34,22,C.pink,700);names.forEach((name,i)=>text(ctx,name,70,710+i*35,640,32,22,C.bone));}
    if(r.records.timeRecord||r.records.killsRecord||r.records.levelRecord)text(ctx,'НОВЫЙ РЕКОРД',54,897,672,32,23,C.pink,700);
    text(ctx,handle(data.platform),54,946,672,34,20,C.cyan,600);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG encoding failed')),'image/png'));
    const file=new File([blob],'ofeliya-result.png',{type:'image/png'});
    dispose(); // The File owns its PNG bytes; no backing canvas or GPU texture is retained.
    return {file,dispose};
  }catch(error){dispose();throw error;}
}
