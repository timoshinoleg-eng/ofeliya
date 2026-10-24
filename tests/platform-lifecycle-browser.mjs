import assert from 'node:assert/strict';

// Real DOM script load/error events and the shipped facade/manager in Chromium.
// All SDK/API traffic is intercepted; only synthetic browser storage is used.
const SDK = `
  const handlers = new Map();
  window.__p11Tg = {
    initData: 'p11-synthetic-init', platform: 'android', version: '10.1',
    viewportHeight: 640, isVerticalSwipesEnabled: false,
    ready() {}, expand() {}, disableVerticalSwipes() {},
    enableClosingConfirmation() { this.closingEnabled = true; },
    disableClosingConfirmation() { this.closingEnabled = false; },
    onEvent(type, cb) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(cb); },
    offEvent(type, cb) { handlers.get(type)?.delete(cb); },
    emit(type) { for (const cb of [...(handlers.get(type) || [])]) cb({isStateStable:true}); },
    count(type) { return handlers.get(type)?.size || 0; }
  };
  window.Telegram = { WebApp: window.__p11Tg };
`;

export async function checkPlatformLifecycle(browser, url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('https://st.max.ru/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 1, muted: true, tutorialDone: true }));
    window.__p11Ready = 0;
    window.addEventListener('ofeliya:telegram-bridge-ready', () => { window.__p11Ready++; });
  });
  let requests = 0, releaseLoad;
  const gate = new Promise(resolve => { releaseLoad = resolve; });
  await page.route('https://telegram.org/js/**', async route => {
    requests++;
    await gate;
    await route.fulfill({ body: SDK, contentType: 'application/javascript' });
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    assert.equal(requests, 0, 'browser launch must not request Telegram SDK');
    const expired = await page.evaluate(async () => {
      const { ensureTelegramBridge } = await import('/src/platform/TelegramBridgeLoader.ts');
      const { PlatformBridge } = await import('/src/platform/index.ts');
      window.__p11Bridge = PlatformBridge;
      window.__p11Counts = [0, 0];
      window.__p11DetachA = PlatformBridge.subscribeViewportChange(() => { window.__p11Counts[0]++; });
      window.__p11DetachB = PlatformBridge.subscribeViewportChange(() => { window.__p11Counts[1]++; });
      location.hash = 'tgWebAppData=p11&tgWebAppVersion=10.1';
      return Promise.all([ensureTelegramBridge(8), ensureTelegramBridge(25)]);
    });
    assert.deepEqual(expired, [false, false]);
    assert.equal(requests, 1);
    releaseLoad();
    await page.waitForFunction(() => window.__p11Ready === 1 && window.__p11Bridge.kind === 'telegram');
    const delivered = await page.evaluate(async () => {
      window.__p11Tg.emit('viewportChanged');
      await window.__viewportManager.sync();
      return { counts: window.__p11Counts, handlers: window.__p11Tg.count('viewportChanged') };
    });
    assert.deepEqual(delivered, { counts: [1, 1], handlers: 1 });
    const detached = await page.evaluate(() => {
      window.__p11DetachA();window.__p11DetachA();window.__p11Tg.emit('viewportChanged');
      return window.__p11Counts;
    });
    assert.deepEqual(detached, [1, 2]);

    // Virtual Telegram resize updates the real Phaser host, action and lower CTA bounds.
    await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      menu.events.on('create', () => { window.__p11MenuCreatedAt = [menu.scale.width, menu.scale.height]; });
    });
    await page.setViewportSize({ width: 390, height: 640 });
    await page.evaluate(() => { window.__p11Tg.viewportHeight = 600;window.__p11Tg.emit('viewportChanged'); });
    // Scene.restart() is queued by Menu.onResize. A shared ScaleManager changing
    // size is earlier than the next scene generation creating its new CTA objects.
    await page.waitForFunction(() => window.__game.scale.height === 600 && window.__p11MenuCreatedAt?.[1] === 600);
    const layout = await page.evaluate(() => {
      const game = window.__game, menu = game.scene.getScene('Menu');
      const action = menu.children.getByName('ofeliya-menu-action');
      const legal = menu.children.list.find(o => o.text === 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА');
      return { host: document.getElementById('game').getBoundingClientRect().toJSON(),
        scale: [game.scale.width, game.scale.height],
        action: action?.getBounds(), legal: legal?.getBounds() };
    });
    assert.deepEqual(layout.scale, [390, 600]);
    assert.equal(layout.host.height, 600);
    for (const name of ['action', 'legal']) {
      const b = layout[name];assert.ok(b, `${name} CTA must exist`);
      assert.ok(b.x >= 0 && b.y >= 0 && b.x+b.width <= 390 && b.y+b.height <= 600, `${name} CTA clipped after viewport resize`);
    }

    await page.evaluate(() => {
      window.WebApp = { initData: 'p11-max', getViewportSize: async () => ({width:'390',height:'580'}) };
      window.dispatchEvent(new Event('ofeliya:max-bridge-ready'));
    });
    await page.waitForFunction(() => document.getElementById('game').dataset.viewportSource === 'max' && window.__game.scale.height === 580);
    assert.equal(await page.evaluate(() => window.__p11Tg.count('viewportChanged')), 0);
    await page.evaluate(() => { delete window.WebApp;delete window.Telegram;window.dispatchEvent(new Event('resize')); });
    await page.waitForFunction(() => document.getElementById('game').dataset.viewportSource === 'browser' && window.__game.scale.height === 640);
    await page.evaluate(() => { window.Telegram = {WebApp:window.__p11Tg};window.dispatchEvent(new Event('resize')); });
    await page.waitForFunction(() => document.getElementById('game').dataset.viewportSource === 'telegram' && window.__game.scale.height === 600);
    assert.equal(await page.evaluate(() => window.__p11Tg.count('viewportChanged')), 1);
    const adapterActivationHandlers = await page.evaluate(() => window.__p11Tg.count('activated'));
    await page.evaluate(() => {
      window.__game.scene.getScene('Menu').scene.start('Game');
    });
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
    assert.equal(await page.evaluate(()=>window.__p11Tg.closingEnabled),true,'Muse Game enables Telegram close confirmation');
    await page.evaluate(()=>window.__p11Tg.emit('deactivated'));
    await page.waitForFunction(()=>window.__game.scene.isPaused('Game'));
    await page.evaluate(()=>window.__p11Tg.emit('activated'));
    await page.waitForFunction(()=>window.__game.scene.isActive('Game'));
    await page.evaluate(()=>window.__game.scene.getScene('UI').showPauseMenu());
    await page.waitForFunction(()=>window.__game.scene.isPaused('Game'));
    await page.evaluate(()=>{window.__p11Tg.emit('deactivated');window.__p11Tg.emit('activated');});
    assert.equal(await page.evaluate(()=>window.__game.scene.isPaused('Game')),true,'host activation preserves manual pause');
    await page.evaluate(()=>window.__game.scene.getScene('UI').closePauseMenu(true));
    await page.evaluate(()=>window.__game.scene.getScene('Game').finish(false));
    assert.equal(await page.evaluate(()=>window.__p11Tg.closingEnabled),false,'ending run disables close confirmation');
    assert.equal(await page.evaluate(()=>window.__p11Tg.count('activated')),adapterActivationHandlers,'ending run removes only game activation callback');
    const final = await page.evaluate(async () => {
      const { ViewportManager } = await import('/src/platform/ViewportManager.ts');
      for (let i=0;i<3;i++) {
        const manager = new ViewportManager(document.createElement('div'));
        manager.start();manager.start();await manager.sync();manager.destroy();manager.destroy();
      }
      window.__p11DetachB();window.__viewportManager.destroy();
      return { ready:window.__p11Ready, handlers:window.__p11Tg.count('viewportChanged'),
        scale:[window.__game.scale.width,window.__game.scale.height],canvas:document.querySelector('#game canvas').getBoundingClientRect().toJSON() };
    });
    assert.equal(final.ready, 1);assert.equal(final.handlers, 0);
    assert.deepEqual(final.scale, [390, 600]);assert.equal(final.canvas.height, 600);
    assert.deepEqual(errors, []);
    console.log('Browser: P11 late concurrent SDK + multicast + Telegram/MAX/browser + resize/CTA + reopen cleanup PASS');
  } catch (error) {
    console.error('P11 browser state', await page.evaluate(() => ({
      ready:window.__p11Ready, counts:window.__p11Counts,
      handlers:window.__p11Tg?.count('viewportChanged'),
      host:document.getElementById('game')?.style.cssText,
      scale:[window.__game?.scale.width,window.__game?.scale.height],
      menuScale:[window.__game?.scene.getScene('Menu').scale.width,window.__game?.scene.getScene('Menu').scale.height],
      source:document.getElementById('game')?.dataset.viewportSource,
    })), errors);
    throw error;
  } finally { releaseLoad();await page.close(); }

  const retryPage = await browser.newPage();
  let retries = 0;
  await retryPage.route('**/p11-fixture', route => route.fulfill({body:'<!doctype html>',contentType:'text/html'}));
  await retryPage.route('https://telegram.org/js/**', route => {
    retries++;
    return retries === 1 ? route.abort('failed') : route.fulfill({body:SDK,contentType:'application/javascript'});
  });
  try {
    await retryPage.goto(new URL('p11-fixture#tgWebAppData=p11', url).href);
    const result = await retryPage.evaluate(async () => {
      const { ensureTelegramBridge } = await import('/src/platform/TelegramBridgeLoader.ts');
      let ready=0;window.addEventListener('ofeliya:telegram-bridge-ready',()=>ready++);
      const failed=await Promise.all([ensureTelegramBridge(1000),ensureTelegramBridge(1500)]);
      const success=await Promise.all([ensureTelegramBridge(1000),ensureTelegramBridge(1500)]);
      return {failed,success,ready,scripts:document.querySelectorAll('#ofeliya-telegram-web-app').length};
    });
    assert.deepEqual(result,{failed:[false,false],success:[true,true],ready:1,scripts:1});
    assert.equal(retries,2);
    console.log('Browser: P11 real script network error + concurrent retry PASS');
  } finally { await retryPage.close(); }

  const lateGame = await browser.newPage({viewport:{width:390,height:740}});
  const lateErrors=[];lateGame.on('pageerror',e=>lateErrors.push(String(e)));
  let releaseGameLoad;
  const gameGate=new Promise(resolve=>{releaseGameLoad=resolve;});
  await lateGame.route('https://st.max.ru/**',r=>r.fulfill({body:'',contentType:'application/javascript'}));
  await lateGame.route('**/api/**',r=>r.fulfill({status:503,body:'{}'}));
  await lateGame.route('https://telegram.org/js/**',async r=>{await gameGate;await r.fulfill({body:SDK,contentType:'application/javascript'});});
  await lateGame.addInitScript(()=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:1,muted:true,tutorialDone:true})));
  try {
    await lateGame.goto(url,{waitUntil:'domcontentloaded'});
    await lateGame.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
    await lateGame.evaluate(()=>{window.__game.scene.getScene('Menu').scene.start('Game');});
    await lateGame.waitForFunction(()=>window.__game.scene.isActive('Game')&&window.__game.scene.isActive('UI'));
    assert.equal(await lateGame.evaluate(async()=>{
      location.hash='tgWebAppData=p11';
      return (await import('/src/platform/TelegramBridgeLoader.ts')).ensureTelegramBridge(8);
    }),false);
    releaseGameLoad();
    await lateGame.waitForFunction(()=>window.__p11Tg?.closingEnabled===true);
    await lateGame.evaluate(()=>window.__p11Tg.emit('deactivated'));
    await lateGame.waitForFunction(()=>window.__game.scene.isPaused('Game'));
    await lateGame.evaluate(()=>window.__p11Tg.emit('activated'));
    await lateGame.waitForFunction(()=>window.__game.scene.isActive('Game'));
    await lateGame.evaluate(()=>window.__game.scene.getScene('Game').finish(false));
    assert.equal(await lateGame.evaluate(()=>window.__p11Tg.closingEnabled),false);
    console.log('Browser: Telegram SDK arriving after timeout during active Game binds pause/close and cleans up PASS');
  } catch(error) {
    console.error('late Game diagnostic',lateErrors,await lateGame.evaluate(()=>({scenes:window.__game.scene.scenes.map(s=>({key:s.scene.key,status:s.sys.settings.status})),splash:document.getElementById('splash')?.textContent})));
    throw error;
  } finally {releaseGameLoad();await lateGame.close();}
}
