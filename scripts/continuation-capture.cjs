// Controlled retained scene captures and actual text bounds, not device acceptance.
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const OUT = process.env.OFELIYA_CAPTURE_DIR || path.resolve('artifacts/continuation');
const BASE = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5188/';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-angle=swiftshader']});
 const evidence=[];
 try {
 for(const renderer of ['webgl','canvas']) for(const width of [320,390]) {
  const ctx=await browser.newContext({viewport:{width,height:width===320?568:844},deviceScaleFactor:2});
  await ctx.route('https://st.max.ru/**',r=>r.fulfill({body:''}));
  await ctx.addInitScript(()=>{let seed=7193;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};localStorage.setItem('ofeliya_save_v1',JSON.stringify({muted:true,runs:1,tutorialDone:true}));sessionStorage.clear();});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(BASE+'?renderer='+renderer);
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
  // Stable Menu pose: tween updates paused, not production behavior.
  await page.evaluate(()=>{const g=window.__game,m=g.scene.getScene('Menu');m.tweens.pauseAll();m.children.list.forEach(o=>{if(o.texture?.key==='virus-player')o.setRotation(0).setScale((g.scale.height<650?1.8:2.15)/4);if(o.texture?.key==='host-cell-shadow')o.setScale((g.scale.height<650?1.1:1.4)/4);});});
  await page.locator('canvas').screenshot({path:path.join(OUT,`${renderer}-${width}-menu.png`),animations:'disabled'});
  await page.evaluate(()=>{const g=window.__game;g.events.once('step',()=>g.scene.getScene('Game').scene.pause());g.scene.getScene('Menu').scene.start('Game');});
  await page.waitForFunction(()=>window.__game?.scene.isPaused('Game')&&window.__game.scene.isActive('UI'));
  const rows=await page.evaluate(()=>{
   const g=window.__game,gs=g.scene.getScene('Game'),ui=g.scene.getScene('UI');
   const result=[]; const bounds=o=>{const b=o.getBounds();return {x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};
   for(const combo of [999,1000,9999]){
    const run={...g.registry.get('run'),combo,kills:99999,bossName:'CARDIAC TITAN',bossHp:500,bossMax:1000};
    g.registry.set('run',run);ui.update();ui.tweens.pauseAll();
    result.push({combo,comboBounds:bounds(ui.comboText),hpBounds:bounds(ui.hpText),hpX:ui.hudMetrics(g.scale.width).hpX,bossBounds:bounds(ui.bossLabel),killsBounds:bounds(ui.killsText),timerBounds:bounds(ui.timerText)});
   }
   // Paused scene plus fixed atmosphere time and zero dt make pairs reproducible.
   gs.atmosphere.update(600,0,600,300000);
   gs.player.preUpdate(600,0);
   const e=gs.enemies.getChildren()[0];e.activate(gs,'swarm',gs.player.x+70,gs.player.y+70,{hpScale:1,dmgScale:1});e.preUpdate(600,0);
   return result;
  });
  if(process.env.OFELIYA_ASSERT_HUD==='1') for(const row of rows){
   if(row.comboBounds.right>row.hpX-8+.01) throw Error(`combo peak overlaps HP ${renderer}/${width}/${row.combo}`);
   if(row.bossBounds.bottom>87) throw Error(`boss label overlaps bar ${renderer}/${width}`);
   if(row.hpBounds.bottom>row.bossBounds.y) throw Error(`HP overlaps boss label ${renderer}/${width}`);
  }
  await page.locator('canvas').screenshot({path:path.join(OUT,`${renderer}-${width}-hud.png`),animations:'disabled'});
  if(errors.length)throw Error(errors.join('\n'));
  evidence.push({renderer,width,rows}); await ctx.close();
 }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(OUT,'bounds.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({captures:8,evidence:OUT}));
})().catch(e=>{console.error(e);process.exitCode=1});
