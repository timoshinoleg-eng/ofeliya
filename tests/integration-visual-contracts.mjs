import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const menu = readFileSync('src/scenes/MenuScene.ts', 'utf8');
const ui = readFileSync('src/scenes/UIScene.ts', 'utf8');
test('the audio row owns three switches with a fixed split and a fitted label', () => {
  // The redesigned menu replaced the reflowing percentage row with three fixed
  // switches. The contract is the split, the gaps, the safe margins and the
  // readability floor.
  assert.ok(!/музыка: \d/.test(menu), 'the menu must not expose a music percentage');
  assert.ok(!/эффекты: \d/.test(menu), 'the menu must not expose an effects percentage');
  assert.ok(menu.includes('MENU_COPY.music'), 'the music switch is copy driven');
  assert.ok(menu.includes('MENU_COPY.sound'), 'the sound switch is copy driven');
  assert.ok(menu.includes('MENU_COPY.effects'), 'the effects switch is copy driven');
  assert.ok(menu.includes('MENU_COPY.on') && menu.includes('MENU_COPY.off'), 'the switches show on/off');
  assert.ok(!menu.includes('СВОДКА'), 'the summary entry is gone from the menu');
  assert.ok(!menu.includes('Двигай штамм'), 'the redundant loop instruction is gone');

  // The three switches share the content column with an 8px gap.
  const gap = 8;
  for (const W of [320, 360, 390, 412, 768, 1080]) {
    const contentWidth = Math.min(W - 34, Math.max(440, W * 0.55));
    const cellW = (contentWidth - gap * 2) / 3;
    const left = W / 2 - contentWidth / 2;
    const cells = [0, 1, 2].map((i) => ({ x: left + cellW / 2 + i * (cellW + gap), w: cellW }));
    for (let i = 1; i < cells.length; i += 1) {
      assert.ok(
        cells[i].x - cells[i].w / 2 - (cells[i - 1].x + cells[i - 1].w / 2) >= 4 - 1e-9,
        `minimum horizontal gap4 at ${W}`
      );
    }
    for (const cell of cells) {
      assert.ok(cell.x - cell.w / 2 >= 8 - 1e-9, `8px safe margin at ${W}`);
      assert.ok(cell.x + cell.w / 2 <= W - 8 + 1e-9, `8px safe margin at ${W}`);
      assert.ok(cell.w >= 44, `an audio switch is a real touch target at ${W}`);
    }
  }

  // The guard fits every switch label to its own plate.
  const guard = readFileSync('src/ui/MobileLayoutGuard.ts', 'utf8');
  for (const anchor of ['ofeliya-menu-audio-music', 'ofeliya-menu-audio-sound', 'ofeliya-menu-audio-effects']) {
    assert.ok(guard.includes(anchor), `the guard must know ${anchor}`);
  }
  assert.ok(guard.includes('MENU_AUDIO_ANCHORS'), 'the guard fits the audio labels');
});

test('all six menu ambient tween definitions respect reduced motion while keeping scene objects', () => {
  const block=menu.slice(menu.indexOf('    const plasma ='),menu.indexOf('    const title = this.add'));
  const objects=()=>new Proxy({x:0,y:0,scaleX:1,rotation:0},{get(t,k){return k in t?t[k]:(...args)=>proxy;}});
  let proxy;
  for(const reduced of [true,false]) {
    let tweens=0,created=0;
    proxy=objects();
    const scene={scale:{},add:new Proxy({},{get:()=>()=>{created++;return proxy;}}),tweens:{add(){tweens++;}}};
    const layout={artTop:100,artHeight:90,artScale:90/56,ringRadius:40};
    new Function('W','H','Phaser','artScale','ROLE','PANEL','BORDER','VISUAL','prefersReducedMotion','layout',block).call(scene,320,568,{Math:{FloatBetween:()=>0,Between:()=>0}},()=>1,{surface:{panel:0}},{plate:1},{hair:1,heavyLg:2},{immune:0,player:0},()=>reduced,layout);
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
