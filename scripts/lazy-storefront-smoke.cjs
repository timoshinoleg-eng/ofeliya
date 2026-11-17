const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.platform === 'win32' ? 'playwright' : 'playwright-core');
const base = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';

(async () => {
  const executablePath = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const failFirst of [false, true]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 740 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
      await context.addInitScript(() => localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 1, muted: true })));
      let block = failFirst;
      await context.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(base)) return route.abort();
        if (block && /\/src\/scenes\/StorefrontScene\.ts/.test(url)) return route.fulfill({ status: 404, body: 'not found' });
        return route.continue();
      });
      const page = await context.newPage();
      await page.goto(`${base}?flag.storefront.variant=mock`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 60000 });
      const tapShop = async () => {
        const point = await page.evaluate(() => { const game = window.__game; const obj = game.scene.getScene('Menu').children.list.find(o => o.name === 'ofeliya-menu-shop'); if (!obj) throw new Error('shop entry missing'); const b = obj.getBounds(); const c = game.canvas.getBoundingClientRect(); return { x: c.left + b.centerX, y: c.top + b.centerY }; });
        await page.touchscreen.tap(point.x, point.y);
      };
      await tapShop();
      if (failFirst) {
        const failure = page.locator('#ofeliya-lazy-load-failure');
        await failure.waitFor({ state: 'visible', timeout: 15000 });
        block = false;
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), failure.getByRole('button', { name: /перезапустить/i }).click()]);
        await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 60000 });
        await tapShop();
      }
      await page.waitForFunction(() => window.__game.scene.isActive('Storefront'), null, { timeout: 30000 });
      const sceneKeys = await page.evaluate(() => window.__game.scene.scenes.filter(s => s.sys.settings.key === 'Storefront').length);
      assert.equal(sceneKeys, 1, 'the storefront is registered exactly once');
      console.log(`lazy storefront ${failFirst ? '404 recovery' : 'normal open'}: ok`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
