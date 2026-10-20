const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright-core');
(async () => {
 const executablePath = ['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(fs.existsSync);
 const browser = await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page = await browser.newPage({viewport:{width:390,height:740},hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('https://st.max.ru/**',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({muted:true,runs:1})));
  await page.goto(process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
  const point=await page.evaluate(()=>{const t=window.__game.scene.getScene('Menu').children.list.find(o=>o.name==='ofeliya-menu-action');const b=t?.getBounds();return b&&{x:b.centerX,y:b.centerY};});
  assert.ok(point,'real Menu action present');await page.touchscreen.tap(point.x,point.y);
  await page.waitForFunction(()=>{const g=window.__game;return g.scene.isActive('UI')&&(g.scene.isActive('Game')||g.scene.isPaused('Game'));});
  await page.waitForFunction(()=>{const g=window.__game,gs=g.scene.getScene('Game'),ui=g.scene.getScene('UI');return gs.awaitingChoice===true&&ui.modalOpen===true&&g.scene.isPaused('Game');});
  const state=await page.evaluate(()=>{const gs=window.__game.scene.getScene('Game'),ui=window.__game.scene.getScene('UI');return {fixture:gs.__combatFixture??null,clock:gs.runState.run.timeMs,xpNext:gs.runState.stage.xpNext,choices:gs.pendingChoices.length,manualPaused:ui.manualPaused,modalOpen:ui.modalOpen};});
  assert.equal(state.fixture,null,'no mechanic fixture in natural startup');assert.ok(state.clock>0,'real game clock advanced');assert.ok(state.xpNext<1_000_000,'natural XP threshold unchanged');assert.ok(state.choices>0,'real mutation choices rolled');assert.equal(state.manualPaused,false);assert.deepEqual(errors,[]);
  const card = await page.evaluate(() => {
    const ui=window.__game.scene.getScene('UI');
    const card=ui.modal?.list.find(o=>Array.isArray(o.list)&&o.list.some(child=>child.input?.enabled));
    const bg=card?.list.find(o=>o.input?.enabled);const b=bg?.getBounds();return b&&{x:b.centerX,y:b.centerY};
  });
  assert.ok(card,'real mutation touch target');await page.touchscreen.tap(card.x,card.y);
  await page.waitForFunction(()=>{const g=window.__game,gs=g.scene.getScene('Game'),ui=g.scene.getScene('UI');return g.scene.isActive('Game')&&!g.scene.isPaused('Game')&&!gs.awaitingChoice&&!ui.modalOpen;});
  await page.waitForFunction(before=>window.__game.scene.getScene('Game').runState.run.timeMs>before+100,state.clock);
  assert.deepEqual(errors,[]);
  console.log('natural startup/progression: PASS '+JSON.stringify(state));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
