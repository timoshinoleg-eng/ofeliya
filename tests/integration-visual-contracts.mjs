import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const menu = readFileSync('src/scenes/MenuScene.ts', 'utf8');
const ui = readFileSync('src/scenes/UIScene.ts', 'utf8');
test('utility measured layout preserves four pixel gaps, font floors and refreshed hit areas', () => {
  const body = menu.match(/function layoutUtilityRow\(\): void \{([\s\S]*?)\n    }/)[1];
  for (const [W,H,widths] of [[320,568,[56,60,57,43,78]],[360,640,[63,66,63,48,88]],[360,760,[64,68,64,48,88]],[390,844,[68,72,68,52,92]],[412,915,[68,72,68,52,92]]]) {
    for (const resumeCheckpoint of [false,true]) {
      const floor=H<650?11:12, utilityY=H-(resumeCheckpoint?59:64);
      const slots=widths.map((width,i)=>({
        width,height:14,size:i===4?floor+1:floor,x:0,y:utilityY,
        input:{hitArea:{setSize(w,h){this.width=w;this.height=h;}}},
        setX(x){this.x=x;},setY(y){this.y=y;},
        setFontSize(size){this.width*=size/this.size;this.size=size;}
      }));
      new Function('utilitySlots','W','H','utilityY','resumeCheckpoint',body)(slots,W,H,utilityY,resumeCheckpoint);
      const required=slots.reduce((sum,s)=>sum+s.width,0)+16+4*(slots.length-1);
      const rows=[...new Set(slots.map(s=>s.y))].sort((a,b)=>a-b);
      assert.equal(rows.length,required>W+1e-6?2:1,'reflow only when a single row cannot fit');
      if(rows.length===2) {
        assert.deepEqual(rows.map(y=>slots.filter(s=>s.y===y).length),[3,2],'narrow reflow stays 3+2');
        const upperBottom=Math.max(...slots.filter(s=>s.y===rows[0]).map(s=>s.y+s.height/2));
        const lowerTop=Math.min(...slots.filter(s=>s.y===rows[1]).map(s=>s.y-s.height/2));
        assert.ok(lowerTop-upperBottom>=4-1e-9,'minimum vertical row gap4');
        const shift=W<344&&H<650?24:0;
        const buttonY=H*(resumeCheckpoint?.785:.805)-(shift?20:0);
        const buttonBottom=buttonY+(resumeCheckpoint||shift?58:66)/2;
        const newRunBottom=resumeCheckpoint?buttonY+42+11:buttonBottom;
        assert.ok(rows[0]-7-Math.max(buttonBottom,newRunBottom)>=4-1e-9,'footer clear of action/new-run buttons');
      }
      for(const s of slots) {
        assert.ok(s.size>=floor,'readability floor');
        assert.ok(s.x-s.width/2>=8-1e-9 && s.x+s.width/2<=W-8+1e-9,'8px safe margins');
        assert.equal(s.input.hitArea.width,s.width,'tap width follows label');
        assert.equal(s.input.hitArea.height,s.height,'tap height follows label');
      }
      for(const y of rows) {
        const row=slots.filter(s=>s.y===y).sort((a,b)=>a.x-b.x);
        for(let i=1;i<row.length;i++)
          assert.ok(row[i].x-row[i].width/2-(row[i-1].x+row[i-1].width/2)>=4-1e-9,'minimum horizontal gap4');
      }
    }
  }
});
test('all six menu ambient tween definitions respect reduced motion while keeping scene objects', () => {
  const block=menu.slice(menu.indexOf('    const plasma ='),menu.indexOf('    const titleY ='));
  const objects=()=>new Proxy({x:0,y:0,scaleX:1,rotation:0},{get(t,k){return k in t?t[k]:(...args)=>proxy;}});
  let proxy;
  for(const reduced of [true,false]) {
    let tweens=0,created=0;
    proxy=objects();
    const scene={scale:{},add:new Proxy({},{get:()=>()=>{created++;return proxy;}}),tweens:{add(){tweens++;}}};
    new Function('W','H','Phaser','artScale','ROLE','PANEL','BORDER','VISUAL','prefersReducedMotion',block).call(scene,320,568,{Math:{FloatBetween:()=>0,Between:()=>0}},()=>1,{surface:{panel:0}},{plate:1},{hair:1,heavyLg:2},{immune:0,player:0},()=>reduced);
    assert.equal(tweens,reduced?0:10,'five cells plus five ambient tween instances');
    assert.equal(created,10,'static ambient composition stays present');
  }
});
test('low HP warning stays visible and static for reduce, animated otherwise', () => {
  const expression=ui.match(/const a = ([^;]+);\s*this.hpWarn.lineStyle/)[1];
  const alpha=(reduced,now)=>new Function('prefersReducedMotion',`return ${expression}`).call({time:{now}},()=>reduced);
  const reduced=[0,100,300,700].map(t=>alpha(true,t));
  assert.ok(reduced[0]>0);
  assert.ok(reduced.every(a=>a===reduced[0]),'reduced warning alpha must be static');
  assert.notEqual(alpha(false,0),alpha(false,100));
});
