import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const executablePath = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const scenarios = process.env.STARTUP_SCENARIO ? [process.env.STARTUP_SCENARIO] : ['boot-error', 'boot-rejection', 'boot-stall', 'menu-error', 'menu-stall', 'healthy'];
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
    const errors = [];
    let stalledRequest;
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('https://st.max.ru/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
    await page.route('**/__scene-stall', route => { stalledRequest = route; });
    if (scenario !== 'healthy') {
      const scene = scenario.startsWith('boot') ? 'Boot' : 'Menu';
      await page.route(`**/src/scenes/${scene}Scene.ts`, async route => {
        const response = await route.fetch();
        let body = await response.text();
        if (scenario.endsWith('rejection')) {
          body = body.replace(/create\(\) \{/, 'create() { Promise.reject(new Error("fixture asynchronous scene failure")); return;');
        } else if (scenario.endsWith('error')) {
          assert.match(body, /create\(\) \{/);
          body = body.replace(/create\(\) \{/, 'create() { throw new Error("fixture scene create failure");');
        } else {
          // A stalled loader prevents CREATE. No Phaser methods are manually called.
          body = body.replace(/create\(\) \{/, 'preload() { this.load.json("scene-stall", "/__scene-stall", {timeout:60000}); } create() {');
          if (scene === 'Boot') body = body.replace('preload() {', 'optionalArtPreload() {');
        }
        await route.fulfill({ response, body });
      });
      if (scenario.endsWith('stall')) await page.addInitScript(() => {
        const original = window.setTimeout.bind(window);
        window.setTimeout = (callback, delay, ...args) => original(callback, delay === 15000 ? 2500 : delay, ...args);
      });
    }
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    if (scenario === 'healthy') {
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
      await page.waitForTimeout(200);
      assert.equal(await page.locator('#ofeliya-boot-failure').count(), 0);
      assert.equal(await page.locator('#splash').count(), 0);
      assert.equal(await page.evaluate(() => {
        const lateError = new ErrorEvent('error', { message: 'post-startup fixture', cancelable: true });
        window.dispatchEvent(lateError);
        return lateError.defaultPrevented;
      }), false, 'startup listeners must detach after the first usable menu');
    } else {
      await page.locator('#ofeliya-boot-failure').waitFor({ state: 'visible', timeout: 6000 });
      assert.equal(await page.locator('#splash').count(), 0);
      assert.equal(await page.locator('#ofeliya-boot-failure button').textContent(), 'ПОВТОРИТЬ');
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#game canvas').count(), 0, 'failed startup must dispose the canvas');
      if (stalledRequest) {
        await stalledRequest.fulfill({ contentType: 'application/json', body: '{}' }).catch(() => {});
        await page.waitForTimeout(150);
        assert.equal(await page.locator('#ofeliya-boot-failure').count(), 1, 'late loader completion must not restart the game');
        assert.equal(await page.locator('#game canvas').count(), 0);
      }
      assert.equal(await page.evaluate(() => {
        const lateError = new ErrorEvent('error', { message: 'post-failure fixture', cancelable: true });
        window.dispatchEvent(lateError);
        return lateError.defaultPrevented;
      }), false, 'startup listeners must detach after failure too');
    }
    assert.deepEqual(errors, [], 'startup scene errors must be handled');
    await page.close();
    console.log(`Startup scene ${scenario}: PASS`);
  }
} finally { await browser?.close(); await server.close(); }
