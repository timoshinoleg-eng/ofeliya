const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright-core');
const chrome=process.env.CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
if(!chrome)throw Error('Chrome executable not found');
const url=process.env.P11_TEST_URL||'http://127.0.0.1:5173/';
const SDK=String.raw`
 const handlers=new Map();
 window.__p11SDK={initData:'qa-synthetic-only',platform:'android',version:'10.1',viewportHeight:600,
  isVerticalSwipesEnabled:false,ready(){},expand(){},disableVerticalSwipes(){},
  onEvent(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn)},
  offEvent(name,fn){handlers.get(name)?.delete(fn)},
  emit(name){for(const fn of [...(handlers.get(name)||[])])fn({isStateStable:true})},
  count(name){return handlers.get(name)?.size||0}
 };
 window.Telegram={WebApp:window.__p11SDK};
`;
(async()=>{const browser=await chromium.launch({executablePath:chrome,headless:true,args:process.platform==='win32'?[]:['--no-sandbox','--disable-dev-shm-usage']});const report={sha:'d25e4f615b06d2d0302759f7c19c0afefbe5358a',url,startedAt:new Date().toISOString(),checks:[]};
const mark=(name,value)=>{report.checks.push({name,ok:true,value});console.log('PASS',name,JSON.stringify(value).slice(0,400));};
let page;
try{
 page=await browser.newPage({viewport:{width:390,height:740},hasTouch:true,reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push('console:'+m.text())});
 await page.route('https://st.max.ru/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
 await page.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
 await page.addInitScript(()=>{localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:1,muted:true,tutorialDone:true}));localStorage.setItem('ofeliya_daily_score_outbox_v1','qa-no-server-reward-sentinel');window.__p11BridgeReady=0;window.addEventListener('ofeliya:telegram-bridge-ready',()=>window.__p11BridgeReady++)});
 let requests=0;let release;const blocker=new Promise(ok=>release=ok);
 await page.route('https://telegram.org/js/**',async r=>{requests++;await blocker;await r.fulfill({body:SDK,contentType:'application/javascript'})});
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
 const falseResults=await page.evaluate(async()=>{const {ensureTelegramBridge}=await import('/src/platform/TelegramBridgeLoader.ts');location.hash='tgWebAppData=qa-synth&tgWebAppVersion=10.1';return Promise.all([ensureTelegramBridge(8),ensureTelegramBridge(25)])});
 assert.deepEqual(falseResults,[false,false]);assert.equal(requests,1);
 release();
 await page.waitForFunction(()=>window.__p11BridgeReady===1&&window.__game?.scene.isActive('Menu'));
 await page.evaluate(async()=>{const {PlatformBridge}=await import('/src/platform/index.ts');window.__p11Platform=PlatformBridge;await window.__viewportManager.sync()});
 await page.waitForFunction(()=>document.getElementById('game')?.dataset.viewportSource==='telegram');
 mark('late SDK shared readiness & adapter',{requests,ready:await page.evaluate(()=>window.__p11BridgeReady),source:'telegram'});
 await page.evaluate(()=>{window.__p11SDK.emit('viewportChanged')});
 await page.waitForFunction(()=>window.__game?.scale.height===600);
 await page.waitForFunction(()=>window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-action').getBounds().bottom<=600);
 mark('Telegram viewport live resize',{height:600});
 const layout=await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');const action=m.children.getByName('ofeliya-menu-action').getBounds();return {x:action.x,y:action.y,bottom:action.bottom,height:m.scale.height,handlers:window.__p11SDK.count('viewportChanged')}});
 assert.ok(layout.bottom<=layout.height&&layout.y>=0);assert.equal(layout.handlers,1);
 mark('Action CTA bounded & one listener',layout);
 // Actual QuestBoard opened/closed while running under Telegram adapter.
 const p=await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');m.showCodex();const b=m.codexOverlay.list.find(o=>o.name==='ofeliya-menu-quests').getBounds();const c=window.__game.canvas.getBoundingClientRect();return {x:c.x+(b.x+b.width/2)*c.width/m.scale.width,y:c.y+(b.y+b.height/2)*c.height/m.scale.height}});
 await page.touchscreen.tap(p.x,p.y);
 await page.waitForFunction(()=>Boolean(window.__game.scene.getScene('Menu').questBoard));
 await page.evaluate(()=>window.__game.scene.getScene('Menu').questBoard.destroy());
 mark('QuestBoard opens/closes in live Telegram adapter',true);
 const summary=await page.evaluate(async()=>{
  const game=window.__game, menu=game.scene.getScene('Menu'),gs=game.scene.getScene('Game');
  menu.scene.start('Game');
  await new Promise(ok=>gs.events.once('create',ok));
  await new Promise(ok=>gs.events.once('postupdate',ok));
  gs.scene.pause();const read=()=>{gs.quests.flush();return JSON.parse(localStorage.getItem('ofeliya.quests.v1'));};
  const initial=read();
  const enemy=gs.spawnEnemy('swarm',gs.player.x+100,gs.player.y,true);enemy.takeDamage(1000000);enemy.takeDamage(1000000);
  const killed=read();
  const gem=gs.gems.get(gs.player.x,gs.player.y);gem.activate(gs,gs.player.x,gs.player.y,7);gem.collect();gem.collect();
  const picked=read();
  gs.pendingChoices=[{id:'qa-combined-choice',apply:()=>{},family:'weapon'}];gs.awaitingChoice=true;gs.chooseUpgrade('qa-combined-choice');gs.chooseUpgrade('qa-combined-choice');
  const mutated=read();
  gs.runState.run.timeMs=65950;gs.runState.stage.noDamageMs=65950;gs.quests.tick(65950,65950,true);
  const attacker=gs.spawnEnemy('swarm',gs.player.x+100,gs.player.y,false);gs.player.hurtUntil=0;gs.onPlayerHit(gs.player,attacker);
  const damaged=read();
  gs.quests.tick(125000,59050);gs.runState.run.timeMs=125950;gs.runState.stage.noDamageMs=60000;gs.quests.tick(125950,60000);
  const pending=read();gs.finish(false);const ended=read();gs.finish(false);const repeated=read();
  return {initial,killed,picked,mutated,damaged,pending,ended,repeated,handlers:window.__p11SDK.count('viewportChanged'),daily:localStorage.getItem('ofeliya_daily_score_outbox_v1')};
 });
 assert.equal(summary.killed.runMetrics.q_kills-summary.initial.runMetrics.q_kills,1);
 assert.equal(summary.picked.runMetrics.q_rna-summary.killed.runMetrics.q_rna,7);
 assert.equal(summary.mutated.runMetrics.q_mut-summary.picked.runMetrics.q_mut,1);
 assert.equal(summary.damaged.streakLast,0);
 assert.equal(summary.pending.lastTickTimeMs,125000);
 assert.equal(summary.ended.lastTickTimeMs,125950);
 assert.equal(summary.ended.streakLast,60);
 assert.deepEqual(summary.ended,summary.repeated);
 assert.equal(summary.daily,'qa-no-server-reward-sentinel');
 assert.equal(summary.handlers,1);
 mark('real Phaser enemy/gem/choice/hit/pending force/finish in Telegram host',{kill:1,rna:7,mutation:1,finalStreak:60,handlers:1,sentinel:'preserved'});
 const unexpectedErrors=errors.filter(e=>!e.includes('503 (Service Unavailable)'));
 assert.deepEqual(unexpectedErrors,[], 'unexpected browser errors beyond intentionally mocked unavailable API');
 mark('no unexpected page errors',{expectedMock503:errors.length-unexpectedErrors.length,unexpected:unexpectedErrors});
 report.result='PASS';
}catch(e){report.result='FAIL';report.error=String(e.stack||e);console.error('FAILED',e)}finally{try{fs.writeFileSync(process.env.P11_EVIDENCE||path.join(process.cwd(),'.tmp-p11-crossflow-report.json'),JSON.stringify(report,null,2))}catch(e){console.error('REPORT ERROR',String(e))}await page?.close();await browser.close();}
if(report.result!=='PASS')process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
