import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Removing the Loader XHR timeout or procedural fallback must fail these real Boot cases.
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync), headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
  for (const scenario of ['available','missing','stalled','android-stalled']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(scenario === 'android-stalled' ? { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' } : {}) });
    const requested = []; context.on('request', r => { if (/\/art\/[^/]+\.webp/.test(r.url())) requested.push(r.url()); });
    await context.route('https://st.max.ru/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    if (scenario !== 'available') await context.route('**/art/*.webp', route => scenario === 'missing' ? route.abort() : new Promise(() => {}));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    const started = Date.now();
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
    const textures = await page.evaluate(() => {
      const t = window.__game.textures;
      return ['virus-player','immune-antibody','immune-tcell','immune-macrophage','immune-prime','cardiac-titan','host-cell-shadow'].map(key => ({ key, present: t.exists(key), width: t.exists(key) ? t.get(key).getSourceImage().width : 0, raw: t.exists('raw-art-' + key) }));
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    if (scenario.includes('stalled')) { assert.equal(requested.length, 10, 'optional stalled art must not retry'); assert.equal(new Set(requested).size, 10); }
    if (scenario === 'android-stalled') {
      const config = await page.evaluate(() => ({ initial: window.__game.config.loaderMaxParallelDownloads, actual: window.__game.scene.getScene('Boot').load.maxParallelDownloads }));
      assert.equal(config.initial, 6, 'Android must exercise six-download Phaser default'); assert.equal(config.actual, 10);
    }
    assert.ok(textures.every(t => t.present && t.width > 0 && !t.raw), JSON.stringify(textures));
    assert.ok(Date.now() - started < 6000, 'Menu startup must remain bounded');
    console.log(`art startup ${scenario}: Menu ready, seven canonical textures, ${Date.now() - started}ms`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
