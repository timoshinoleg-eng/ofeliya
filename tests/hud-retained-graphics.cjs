const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { chromium } = require('playwright');
const { startCombatFixture } = require('../scripts/lib/combat-fixture.cjs');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    const executablePath = process.platform === 'win32' ? undefined
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
    browser = await chromium.launch({ executablePath, headless: true,
      args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 390, height: 740 }, hasTouch: true, isMobile: true });
    await page.route('https://st.max.ru/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
    await page.route('**/api/**', r => r.fulfill({ status: 503, body: '{}' }));
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas&video=0');
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await startCombatFixture(page);
    await page.waitForFunction(() => window.__game.scene.isActive('UI'));
    const result = await page.evaluate(() => {
      const game = window.__game, ui = game.scene.getScene('UI'), gs = game.scene.getScene('Game');
      gs.physics.world.pause(); game.scene.pause('Game'); game.scene.pause('UI');
      const run = { ...game.registry.get('run'), xp: 1, xpNext: 10, hp: 90, maxHp: 100, bossHp: 0, bossMax: 0 };
      game.registry.set('run', run);
      const counters = {};
      for (const key of ['xpBack', 'xpFill', 'hpBack', 'hpFill', 'bossBack', 'bossFill']) {
        const graphics = ui[key], old = graphics.clear.bind(graphics);
        counters[key] = 0;
        graphics.clear = (...args) => { counters[key]++; return old(...args); };
      }
      ui.update(); const first = { ...counters };
      ui.update(); const same = { ...counters };
      run.hp = 50; game.registry.set('run', run); ui.update(); const changed = { ...counters };
      run.xp = 2; game.registry.set('run', run); ui.update(); const xpChanged = { ...counters };
      ui.layout(); ui.update(); const layout = { ...counters };
      run.bossMax = 100; run.bossHp = 100; game.registry.set('run', run); ui.update(); const bossStart = { ...counters };
      ui.update(); const bossSame = { ...counters };
      run.bossHp = 50; game.registry.set('run', run); ui.update(); const bossHit = { ...counters };
      run.bossMax = 0; game.registry.set('run', run); ui.update();
      run.bossMax = 100; run.bossHp = 100; game.registry.set('run', run); ui.update(); const bossReturn = { ...counters };
      return { first, same, changed, xpChanged, layout, bossStart, bossSame, bossHit, bossReturn };
    });
    assert.deepEqual(result.same, result.first, 'unchanged HUD must retain graphics instead of clearing every frame');
    assert.equal(result.changed.hpFill, result.same.hpFill + 1, 'HP change must redraw the bar');
    assert.equal(result.changed.xpFill, result.same.xpFill, 'HP change must not redraw RNA');
    assert.equal(result.xpChanged.xpFill, result.changed.xpFill + 1, 'RNA change must redraw the bar');
    assert.equal(result.xpChanged.hpFill, result.changed.hpFill, 'RNA change must not redraw HP');
    assert.ok(result.layout.xpBack > result.changed.xpBack && result.layout.hpBack > result.changed.hpBack,
      'layout invalidation must redraw both backgrounds');
    assert.equal(result.bossStart.bossBack, result.layout.bossBack + 1, 'boss appearance must draw its background');
    assert.equal(result.bossSame.bossFill, result.bossStart.bossFill, 'unchanged boss fill must be retained');
    assert.equal(result.bossHit.bossFill, result.bossSame.bossFill + 1, 'boss damage must redraw the fill');
    assert.equal(result.bossReturn.bossBack, result.bossHit.bossBack + 1, 'a new boss must redraw its background');
    console.log('PASS retained HUD graphics, HP change and layout invalidation', result);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
