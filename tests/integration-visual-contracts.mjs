import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const menu = readFileSync('src/scenes/MenuScene.ts', 'utf8');
const ui = readFileSync('src/scenes/UIScene.ts', 'utf8');
// Footer geometry and 44px hit bounds are exercised against actual Phaser text in
// scripts/verified-ux-smoke.cjs and scripts/footer-actions-smoke.cjs (real touch/label changes).

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
