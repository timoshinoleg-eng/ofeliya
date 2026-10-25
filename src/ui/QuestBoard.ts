import Phaser from 'phaser';
import { QuestRuntime } from '../quests/questRuntime';
import { SaveSystem } from '../systems/SaveSystem';
import { FONT, UI_FONT } from '../game/config';
import { VISUAL, VISUAL_TEXT } from './visualTokens';
import { PlatformBridge } from '../platform';

/** Static read-only board; the only refresh is a UTC day change while open. */
export class QuestBoard {
  private root: Phaser.GameObjects.Container;
  private timer: Phaser.Time.TimerEvent;
  private closed = false;
  constructor(private scene: Phaser.Scene, private dismissed: () => void) {
    this.root = scene.add.container(0,0).setDepth(70).setName('ofeliya-quests');
    const runtime = new QuestRuntime();
    runtime.mirrorLifetime(SaveSystem.get().runs);
    let day = '';
    const render = () => {
      // UI only mirrors the product lifetime; it cannot emit gameplay or claim rewards.
      const snapshot = runtime.snapshot();
      if (day === snapshot.dayKey) return;
      day = snapshot.dayKey;
      this.root.removeAll(true);
      const W=scene.scale.width,H=scene.scale.height,w=Math.min(W-24,420);
      const h=Math.min(H-32,540), left=(W-w)/2, top=(H-h)/2;
      this.root.add(scene.add.rectangle(W/2,H/2,W,H,VISUAL.ink,0.97).setInteractive());
      this.root.add(scene.add.rectangle(W/2,H/2,w,h,VISUAL.panel,1).setStrokeStyle(1,VISUAL.line));
      const text=(x:number,y:number,value:string,size:number,color: string=VISUAL_TEXT.ivory) => {
        const t=scene.add.text(x,y,value,{fontFamily:UI_FONT,fontSize:size,color,
          wordWrap:{width:w-32},lineSpacing:4}).setResolution(2);
        this.root.add(t); return t;
      };
      text(left+16,top+18,'КВЕСТЫ',20).setFontFamily(FONT);
      text(left+16,top+53,'Обновление в 00:00 UTC\nЛокальный прогресс · без наград',12,VISUAL_TEXT.host);
      const rowH=(h-174)/3;
      snapshot.progress.forEach((p,i)=>{
        const def=runtime.catalog().find(d=>d.id===p.questId)!;
        const y=top+105+i*rowH;
        text(left+16,y,def.title,15);
        text(left+16,y+25,def.desc,12,VISUAL_TEXT.muted);
        const value=p.progress;
        text(left+16,y+61,p.complete || value>=p.target ? 'Выполнено · локально' : `${Math.min(value,p.target)} / ${p.target}`,13,VISUAL_TEXT.host);
      });
      const close=scene.add.rectangle(W/2,top+h-28,w-32,44,VISUAL.ink,1)
        .setInteractive({useHandCursor:true}).setName('ofeliya-quests-close');
      close.on('pointerup',this.destroy,this);
      this.root.add(close);
      text(W/2,top+h-28,'ЗАКРЫТЬ',14).setOrigin(0.5);
    };
    render();
    this.timer=scene.time.addEvent({delay:1000,loop:true,callback:render});
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN,this.destroy,this);
    PlatformBridge.setBackHandler(()=>this.destroy());
  }
  destroy(): void {
    if (this.closed) return;
    this.closed=true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN,this.destroy,this);
    this.timer?.remove(false);
    this.root.destroy();
    PlatformBridge.setBackHandler(null);
    this.dismissed();
  }
}
