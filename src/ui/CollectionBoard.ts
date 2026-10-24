import Phaser from 'phaser';
import { SKIN_CATALOG } from '../game/collection/ClientCollection';
import { clientCollection, clientFlags, cosmeticColor } from '../systems/ClientExperience';
import { rewardReveal, squashAndStretch } from './ClientJuice';
import { PlatformBridge } from '../platform';
import { FONT, UI_FONT } from '../game/config';
import { VISUAL, VISUAL_TEXT } from './visualTokens';

type Page = 'achievements' | 'skins' | 'lab';

/** Cosmetic-only Muse collection. No inventory, currency, boosts or product save writes. */
export class CollectionBoard {
 private readonly collection=clientCollection();
 private readonly root:Phaser.GameObjects.Container;
 private page:Page='achievements';
 private offset=0;
 private closed=false;
 constructor(private scene:Phaser.Scene,private dismissed:()=>void) {
  this.root=scene.add.container(0,0).setDepth(72).setName('ofeliya-collection');
  this.collection.visit();this.render();
  rewardReveal(scene,this.root,{enabled:clientFlags().juice.enhanced});
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN,this.destroy,this);
  PlatformBridge.setBackHandler(()=>this.destroy());
 }
 private render():void {
  this.root.removeAll(true);
  const s=this.scene,W=s.scale.width,H=s.scale.height,w=Math.min(W-24,440),h=Math.min(H-24,610);
  const left=(W-w)/2,top=(H-h)/2,compact=H<650;
  const state=this.collection.snapshot();
  this.root.add(s.add.rectangle(W/2,H/2,W,H,VISUAL.ink,0.97).setInteractive());
  this.root.add(s.add.rectangle(W/2,H/2,w,h,VISUAL.panel,1).setStrokeStyle(1,VISUAL.line));
  const text=(x:number,y:number,value:string,size=12,color:string=VISUAL_TEXT.ivory,width=w-32)=>{
   const t=s.add.text(x,y,value,{fontFamily:UI_FONT,fontSize:size,color,wordWrap:{width},lineSpacing:3}).setResolution(2);
   this.root.add(t);return t;
  };
  const button=(name:string,x:number,y:number,bw:number,label:string,action:()=>void,enabled=true)=>{
   const hit=s.add.rectangle(x,y,bw,44,VISUAL.ink,1).setStrokeStyle(1,VISUAL.line).setName(name);
   if(enabled)hit.setInteractive({useHandCursor:true}).on('pointerup',action);
   this.root.add(hit);text(x,y,label,11,enabled?VISUAL_TEXT.ivory:VISUAL_TEXT.muted,bw-8).setOrigin(0.5);
   return hit;
  };
  text(left+16,top+15,'КОЛЛЕКЦИЯ ШТАММА',18).setFontFamily(FONT);
  text(left+16,top+44,`Посещений: ${state.visitDays} · серия: ${state.visitStreak} дн.`,11,VISUAL_TEXT.host);
  const tabW=(w-32)/3;
  for(const [i,tab] of (['achievements','skins','lab'] as const).entries()) {
   button('ofeliya-collection-'+tab,left+16+tabW*(i+0.5),top+88,tabW-3,
    tab==='achievements'?'ЦЕЛИ':tab==='skins'?'ШТАММЫ':'ЛАБОРАТОРИЯ',()=>{this.page=tab;this.offset=0;this.render();},tab!=='skins'||clientFlags().skins.gallery);
  }
  const y0=top+122,rowH=this.page==='skins'?90:compact?78:91;
  const pageSize=Math.max(1,Math.min(4,Math.floor((h-218)/rowH)));
  if(this.page==='achievements') {
   const rows=state.achievements.slice(this.offset,this.offset+pageSize);
   rows.forEach((a,i)=>{
    const y=y0+i*rowH;
    text(left+16,y,`${a.unlocked?'◆':'◇'} ${a.title}`,13,a.unlocked?VISUAL_TEXT.host:VISUAL_TEXT.ivory);
    text(left+16,y+22,a.description,11,VISUAL_TEXT.muted);
    text(left+16,y+51,`${a.progress.toLocaleString('ru-RU')} / ${a.threshold.toLocaleString('ru-RU')}`,11,VISUAL_TEXT.host);
   });
  } else if(this.page==='skins') {
   SKIN_CATALOG.slice(this.offset,this.offset+pageSize).forEach((skin,i)=>{
    const y=y0+i*rowH,owned=state.ownedSkinIds.includes(skin.id);
    const orb=s.add.circle(left+32,y+22,15,cosmeticColor(skin.id),owned?0.95:0.25).setStrokeStyle(2,VISUAL.line);
    this.root.add(orb);
    if(owned)orb.setInteractive().on('pointerdown',()=>squashAndStretch(s,orb,{enabled:clientFlags().juice.enhanced}));
    text(left+56,y,skin.title,12,owned?VISUAL_TEXT.ivory:VISUAL_TEXT.muted,w-76);
    const goal=state.achievements.find(a=>a.id===skin.earnedBy);
    text(left+56,y+20,owned?'Только внешний вид':`Открывает: ${goal?.title??'коллекция'}`,10,VISUAL_TEXT.muted,w-76);
    button('ofeliya-skin-'+skin.id,left+w-64,y+57,98,state.selectedSkinId===skin.id?'ВЫБРАН':'ВЫБРАТЬ',()=>{
     if(this.collection.selectSkin(skin.id))this.render();
    },owned&&!state.readOnly);
   });
  } else {
   text(left+16,y0,'ИССЛЕДОВАНИЯ · БЕЗ УСИЛЕНИЙ',13,VISUAL_TEXT.host);
   const today=new Date();today.setUTCHours(0,0,0,0);
   for(let i=0;i<7;i++) {
    const date=new Date(today.getTime()-(6-i)*86400000),day=date.toISOString().slice(0,10);
    const visited=state.recentVisitDays.includes(day),x=left+16+(w-32)/7*(i+.5);
    text(x,y0+29,`${visited?'◆':'◇'} ${date.getUTCDate()}`,10,visited?VISUAL_TEXT.host:VISUAL_TEXT.muted,40).setOrigin(.5,0);
   }
   const done=state.achievements.filter(a=>a.unlocked).length;
   const branches=[['МЕТАБОЛИЗМ','Записи собранной РНК и длительности циклов.'],
    ['ХИТИН','История серий без урона и завершённых циклов.'],
    ['ХЕМОТАКСИС','Исследование клеток хозяина и элитных противников.']];
   const branchStep=Math.min(68,Math.max(48,(h-280)/3));
   branches.forEach(([title,desc],i)=>{text(left+16,y0+57+i*branchStep,title,14);text(left+16,y0+80+i*branchStep,desc,12,VISUAL_TEXT.muted);});
   text(left+16,top+h-96,`Открыто записей: ${done} / ${state.achievements.length}\nУрон, здоровье, скорость и награды не меняются.`,11,VISUAL_TEXT.host);
  }
  if(this.page!=='lab') {
   const total=this.page==='skins'?SKIN_CATALOG.length:state.achievements.length,y=top+h-83;
   button('ofeliya-collection-prev',left+43,y,54,'‹',()=>{this.offset=Math.max(0,this.offset-pageSize);this.render();},this.offset>0);
   text(W/2,y,`${1+Math.floor(this.offset/pageSize)} / ${Math.ceil(total/pageSize)}`,11).setOrigin(0.5);
   button('ofeliya-collection-next',left+w-43,y,54,'›',()=>{this.offset+=pageSize;this.render();},this.offset+pageSize<total);
  }
  button('ofeliya-collection-close',W/2,top+h-29,w-32,'ЗАКРЫТЬ',()=>this.destroy());
 }
 destroy():void {
  if(this.closed)return;this.closed=true;
  this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN,this.destroy,this);
  this.scene.tweens.killTweensOf(this.root);this.root.destroy();PlatformBridge.setBackHandler(null);this.dismissed();
 }
}
