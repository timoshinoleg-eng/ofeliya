const assert=require('node:assert/strict'),fs=require('fs');
const {chromium}=require('playwright-core');
const chrome=process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
if(!chrome)throw Error('Chrome not found (harness)');
(async()=>{let browser;
try {
for(const viewport of [{width:320,height:568},{width:390,height:844},{width:768,height:1024},{width:1080,height:1920}].filter(v=>!process.env.QUEST_WIDTH || v.width===Number(process.env.QUEST_WIDTH))) {
 browser=await chromium.launch({executablePath:chrome,headless:true});
 const page=await browser.newPage({viewport,hasTouch:true,reducedMotion:process.env.QUEST_MOTION||'reduce'}); const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('https://st.max.ru/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await page.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
 await page.addInitScript(()=>{
  localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:1,muted:true}));
  localStorage.setItem('ofeliya_daily_score_outbox_v1','quest-isolation-sentinel');
  const tracked=[];
  for(const [target,type] of [[window,'pagehide'],[document,'visibilitychange']]) {
   const handlers=new Set(),add=target.addEventListener,remove=target.removeEventListener;
   target.addEventListener=function(t,fn,...args){if(t===type)handlers.add(fn);return add.call(this,t,fn,...args)};
   target.removeEventListener=function(t,fn,...args){if(t===type)handlers.delete(fn);return remove.call(this,t,fn,...args)};
   tracked.push(handlers);
  }
  window.__questListenerCounts=()=>tracked.map(s=>s.size);
 });
 await page.goto(process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/');
 await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
 const show=async()=>{
  const point=await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');m.showCodex();const find=(node,name)=>{for(const child of node.list??[]){if(child.name===name)return child;const hit=find(child,name);if(hit)return hit;}return null;};const b=find(m.codexOverlay,'ofeliya-meta-dock-tasks').getBounds();const c=window.__game.canvas.getBoundingClientRect();return {x:c.x+(b.x+b.width/2)*c.width/m.scale.width,y:c.y+(b.y+b.height/2)*c.height/m.scale.height};});
  await page.touchscreen.tap(point.x,point.y);
  await page.waitForFunction(()=>!!window.__game.scene.getScene('Menu').questBoard);
 };
 const before=await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');return m.events.listenerCount('shutdown')});
 for(let i=0;i<10;i++) {
  await show();
  const layout=await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu'),root=m.children.getByName('ofeliya-quests');
   const texts=root.list.filter(o=>o.type==='Text').map(o=>({text:o.text,b:o.getBounds()}));
   const close=root.list.find(o=>o.name==='ofeliya-modal-close-hit');return {texts,close:close.getBounds(),W:m.scale.width,H:m.scale.height};});
  assert.equal(layout.close.height,44);
  for(const t of layout.texts)assert.ok(t.b.x>=0&&t.b.y>=0&&t.b.x+t.b.width<=layout.W&&t.b.y+t.b.height<=layout.H,JSON.stringify(t));
  const countdowns=layout.texts.filter(t=>/Обновление через (?:(?:\d+) ч )?(?:\d+) мин/.test(t.text));
  assert.equal(countdowns.length,1,'the daily board shows exactly one live countdown');
  assert.ok(!/00:00|UTC/.test(countdowns[0].text),'the countdown is player-facing remaining time, not a static/technical reset');
  if(i===0){fs.mkdirSync('docs/qa/quest-evidence',{recursive:true});await page.screenshot({path:`docs/qa/quest-evidence/quests-${viewport.width}.png`});}
  await page.evaluate(()=>window.__game.scene.getScene('Menu').questBoard.destroy());
 }
 assert.equal(await page.evaluate(()=>window.__game.scene.getScene('Menu').events.listenerCount('shutdown')),before,'board shutdown listeners bounded');
 const result=await page.evaluate(async()=>{
  const game=window.__game,gs=game.scene.getScene('Game');
  game.scene.getScene('Menu').scene.start('Game');
  await new Promise(resolve=>gs.events.once('create',resolve));
  await new Promise(resolve=>gs.events.once('postupdate',resolve));
  gs.scene.pause();
  const state=()=>{gs.quests.flush();return JSON.parse(localStorage.getItem('ofeliya.quests.v1'));};
  const baseline=state(); const liveTicks=gs.quests.snapshot().processedEvents;
  const enemy=gs.spawnEnemy('swarm',gs.player.x+100,gs.player.y,true);
  enemy.takeDamage(1000000); enemy.takeDamage(1000000);
  const killed=state();
  const gem=gs.gems.get(gs.player.x,gs.player.y); gem.activate(gs,gs.player.x,gs.player.y,7);gem.collect();gem.collect();
  const pickup=state();
  const ui=game.scene.getScene('UI');ui.notifyRnaPickup(999);const presentation=state();
  gs.pendingChoices=[{id:'qa-choice',apply:()=>{},family:'weapon'}];gs.awaitingChoice=true;
  gs.chooseUpgrade('qa-choice');gs.chooseUpgrade('qa-choice');const mutation=state();
  gs.runState.run.timeMs=65950;gs.runState.stage.noDamageMs=65950;gs.quests.tick(65950,65950,true);
  const attacker=gs.spawnEnemy('swarm',gs.player.x+100,gs.player.y,false);gs.player.hurtUntil=0;
  gs.onPlayerHit(gs.player,attacker);const damage=state();
  const cp=gs.quests.checkpoint();
  gs.quests.tick(125000,59050);
  gs.runState.run.timeMs=125950;gs.runState.stage.noDamageMs=60000;
  gs.quests.tick(125950,60000);const pendingTerminal=state();
  gs.finish(false);const end=state();const runs=JSON.parse(localStorage.getItem('ofeliya_save_v1')).runs;
  gs.finish(false);const duplicate=state();
  return {liveTicks,baseline,killed,pickup,presentation,mutation,damage,pendingTerminal,end,duplicate,runs,cp};
 });
 assert.ok(result.liveTicks>=2,'actual Game.update must emit a tick after run_started');
 assert.equal(result.killed.runMetrics.q_kills-result.baseline.runMetrics.q_kills,1);
 assert.equal(result.killed.runMetrics.q_elites-result.baseline.runMetrics.q_elites,1);
 assert.equal(result.pickup.runMetrics.q_rna-result.killed.runMetrics.q_rna,7);
 assert.equal(result.presentation.runMetrics.q_rna,result.pickup.runMetrics.q_rna);
 assert.equal(result.mutation.runMetrics.q_mut-result.pickup.runMetrics.q_mut,1);
 assert.equal(result.damage.streakLast,0);assert.equal(result.end.runtime.ended,true);
 assert.equal(result.pendingTerminal.lastTickTimeMs,125000,'scene final sample is suppressed before finish');
 assert.equal(result.end.lastTickTimeMs,125950,'actual finish delivers pending tick');
 assert.equal(result.end.streakLast,60,'actual damage then 60 real seconds survives finish');
 assert.deepEqual(result.end,result.duplicate);assert.equal(result.runs,2);
 const cycles=await page.evaluate(async()=>{
  const game=window.__game,gs=game.scene.getScene('Game'),menu=game.scene.getScene('Menu');
  const toMenu=()=>new Promise(resolve=>{menu.events.once('create',resolve);gs.exitToMenu();});
  const start=(cp)=>new Promise(resolve=>{if(cp)menu.registry.set('runCheckpointResume',cp);gs.events.once('create',()=>{gs.scene.pause();resolve();});menu.scene.start('Game');});
  await toMenu();const baseline=window.__questListenerCounts();const rows=[];
  for(let i=0;i<3;i++){
   await start();const fresh=gs.quests.checkpoint();gs.saveCheckpointNow();
   const cp=JSON.parse(localStorage.getItem('ofeliya_run_checkpoint_v1'));
   await toMenu();await start(cp);
   rows.push({id:gs.quests.checkpoint().id,fresh:fresh.id,events:gs.quests.snapshot().processedEvents,resumed:gs.resumed});
   await toMenu();
   if(JSON.stringify(window.__questListenerCounts())!==JSON.stringify(baseline))throw Error('Game lifecycle listener growth');
  }
  await start();gs.saveCheckpointNow();const bad=JSON.parse(localStorage.getItem('ofeliya_run_checkpoint_v1'));
  bad.quest.rna='invalid';await toMenu();await start(bad);
  const malformed={resumed:gs.resumed,events:gs.quests.snapshot().processedEvents};await toMenu();
  return {rows,malformed,daily:localStorage.getItem('ofeliya_daily_score_outbox_v1')};
 });
 assert.equal(cycles.malformed.resumed,true,'malformed optional quest payload preserves gameplay checkpoint');
 assert.equal(cycles.malformed.events,1);
 for(const c of cycles.rows){assert.equal(c.id,c.fresh);assert.equal(c.resumed,true);assert.equal(c.events,1,'resume must not emit run_started');}
 assert.equal(cycles.daily,'quest-isolation-sentinel');
 await show();
 const boardDay=await page.evaluate(()=>{window.__questFirst=window.__game.scene.getScene('Menu').children.getByName('ofeliya-quests').list[0];return JSON.parse(localStorage.getItem('ofeliya.quests.v1')).dayKey;});
 await page.waitForTimeout(1100);
 assert.equal(await page.evaluate(()=>window.__questFirst===window.__game.scene.getScene('Menu').children.getByName('ofeliya-quests').list[0]),true,'no text/display rebuild within same day');
 // The countdown line moves in place. The board is not rebuilt for it: the
 // objects under the player's finger stay the same objects, and only the line
 // that shows the time left is updated where it stands.
 //
 // The clock is pinned to synthetic instants inside the board's own UTC day,
 // far from the midnight. Shifting the real clock back had a false-red window
 // of one shift length around every midnight: there the shifted clock fell
 // into the previous day, and the day key moved with it. The two synthetic
 // instants also differ from each other, so the countdown certainly changes.
 const dayKey=await page.evaluate(()=>JSON.parse(localStorage.getItem('ofeliya.quests.v1')).dayKey);
 const dayStart=Date.parse(`${dayKey}T00:00:00.000Z`);
 const noon=dayStart+12*3600000;
 const morning=dayStart+6*3600000;
 await page.evaluate((noon)=>{
  const board=()=>window.__game.scene.getScene('Menu').children.getByName('ofeliya-quests');
  window.__questText=()=>board().list.filter(o=>o&&typeof o.text==='string').map(o=>o.text).join('|');
  window.__questRealNow=Date.now;
  Date.now=()=>noon;
 },noon);
 await page.waitForFunction(()=>window.__questText().includes('12 ч 0 мин'),null,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.__questFirst===window.__game.scene.getScene('Menu').children.getByName('ofeliya-quests').list[0]),true,'the countdown moves without rebuilding the board');
 await page.evaluate((morning)=>{Date.now=()=>morning;},morning);
 // At 06:00 UTC the time left until the midnight is eighteen hours.
 await page.waitForFunction(()=>window.__questText().includes('18 ч 0 мин'),null,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.__questFirst===window.__game.scene.getScene('Menu').children.getByName('ofeliya-quests').list[0]),true,'the countdown keeps moving inside the same day');
 await page.evaluate(()=>{Date.now=window.__questRealNow;});
 await page.evaluate((next)=>{Date.now=()=>next;},dayStart+86400000+300);
 await page.waitForFunction(day=>JSON.parse(localStorage.getItem('ofeliya.quests.v1')).dayKey!==day,boardDay);
 assert.equal(await page.evaluate(()=>window.__questFirst===window.__game.scene.getScene('Menu').children.getByName('ofeliya-quests').list[0]),false,'UTC rollover refreshes open board');
 assert.deepEqual(errors,[]);console.log('PASS actual GameScene/Enemy/Gem/choice/damage/end + board x10 '+viewport.width);
 await page.close(); await browser.close(); browser=null;
}
}finally{await browser?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
