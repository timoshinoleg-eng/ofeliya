const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.platform === 'win32' ? 'playwright' : 'playwright-core');
const base = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
const api = 'http://127.0.0.1:18891/';
(async () => {
  const executablePath = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await chromium.launch({ headless: true, executablePath, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 740 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 1, muted: true }));
      if (!localStorage.getItem('ofeliya.payments.pending.v1')) localStorage.setItem('ofeliya.payments.pending.v1', JSON.stringify([{ nonce: 'test-only-nonce', productId: 'skin.gilded-prime', stars: 120, createdAt: Date.now(), attempts: 0 }]));
      window.Telegram = { WebApp: { initData: 'test-only-init-data', openInvoice() {}, ready() {}, expand() {} } };
    });
    let blockProvider = true; let verifyCount = 0; let providerBlocked = 0;
    await ctx.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(api)) {
        if (url.endsWith('/api/verify') && route.request().method() === 'POST') verifyCount++;
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, contentType: 'application/json', body: url.endsWith('/api/entitlements') ? '{"purchases":[]}' : '{"verified":false}' });
      }
      if (!url.startsWith(base)) return route.abort();
      if (blockProvider && /\/src\/game\/shop\/TelegramStarsPaymentProvider\.ts/.test(url)) { providerBlocked++; return route.fulfill({ status: 404, body: 'not found' }); }
      return route.continue();
    });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    assert.equal(providerBlocked, 1, 'the provider import must actually fail in this fixture');
    const failure = page.locator('#ofeliya-lazy-load-failure');
    await failure.waitFor({ state: 'visible', timeout: 15000 });
    const pendingBefore = await page.evaluate(() => localStorage.getItem('ofeliya.payments.pending.v1'));
    assert.match(pendingBefore, /test-only-nonce/);
    assert.equal(verifyCount, 0, 'no verification can run before the provider loads');
    blockProvider = false;
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), failure.getByRole('button', { name: /перезапустить/i }).click()]);
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 60000 });
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.includes('/api/verify')), null, { timeout: 30000 });
    assert.ok(verifyCount >= 1, 'pending purchase is rechecked after the user reloads');
    const pendingAfter = await page.evaluate(() => localStorage.getItem('ofeliya.payments.pending.v1'));
    assert.match(pendingAfter, /test-only-nonce/, 'unverified pending record must remain after an uncertain verification');
    console.log('lazy payment recovery: ok (local fixture, no purchase)');
    await ctx.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
