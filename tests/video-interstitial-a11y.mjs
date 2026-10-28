import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Same self-hosted Vite/Chromium pattern as review-regressions.mjs. Only the
// production interstitial is imported; no game scene or autoplay is required.
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const executablePath = process.platform === 'win32' ? undefined
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 740 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/a11y-fixture**', route => route.fulfill({ contentType: 'text/html', body: `
    <style>#game { position:fixed; inset:0; overflow:hidden; } #before { position:fixed; z-index:10001; }</style>
    <div id="game"></div><button id="before">Return focus</button><button id="other">Other focus</button>` }));
  await page.goto(server.resolvedUrls.local[0] + 'a11y-fixture?video=1');
  await page.evaluate(async () => {
    // Suppress actual media fetching/decoding while keeping native DOM controls.
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      configurable: true, get() { return this.dataset.fixtureSource ?? ''; },
      set(value) { this.dataset.fixtureSource = value; },
    });
    HTMLMediaElement.prototype.load = function () { this.fixtureLoads = (this.fixtureLoads ?? 0) + 1; };
    HTMLMediaElement.prototype.pause = function () { this.fixturePauses = (this.fixturePauses ?? 0) + 1; };
    HTMLMediaElement.prototype.play = function () {
      if (window.mediaMode === 'reject') return Promise.reject(new Error('autoplay blocked'));
      return new Promise(() => {});
    };
    window.Interstitial = (await import('/src/systems/VideoInterstitial.ts')).VideoInterstitial;
  });
  await page.clock.install();

  const start = async (options = {}) => {
    await page.evaluate(options => {
      window.Interstitial.cancelActive();
      document.getElementById('before').focus();
      window.mediaMode = options.mediaMode ?? 'pending';
      window.result = { complete: 0, fail: 0, visible: 0 };
      window.started = window.Interstitial.play('startIntro', {
        ...options, ariaLabel: 'Skip interstitial',
        onComplete: () => window.result.complete++, onFail: () => window.result.fail++,
        onVisible: () => window.result.visible++,
      });
      window.overlay = document.querySelector('[data-ofeliya-video]');
      window.media = window.overlay?.querySelector('video');
    }, options);
  };
  const progress = () => page.evaluate(() => {
    Object.defineProperty(window.media, 'currentTime', { configurable: true, writable: true, value: 0.1 });
    window.media.dispatchEvent(new Event('timeupdate'));
  });
  const outcome = async (complete, fail, focus = 'before') => {
    const state = await page.evaluate(() => ({
      ...window.result, focus: document.activeElement.id,
      overlays: document.querySelectorAll('[data-ofeliya-video]').length,
      pauses: window.media.fixturePauses ?? 0, loads: window.media.fixtureLoads ?? 0,
    }));
    assert.equal(state.complete, complete);
    assert.equal(state.fail, fail);
    assert.equal(state.focus, focus);
    assert.equal(state.overlays, 0);
    assert.equal(state.pauses, 1);
    assert.equal(state.loads, 1);
    // Detached events and old watchdogs must not complete/fail again.
    await page.evaluate(() => {
      for (const type of ['pointerup', 'click']) window.overlay.dispatchEvent(new Event(type));
      for (const type of ['ended', 'error', 'abort', 'playing', 'waiting', 'timeupdate']) window.media.dispatchEvent(new Event(type));
    });
    await page.clock.fastForward(10000);
    assert.deepEqual(await page.evaluate(() => [window.result.complete, window.result.fail]), [complete, fail]);
  };

  for (const key of ['Enter', 'Space']) {
    await start();
    assert.equal(await page.evaluate(() => window.started), true);
    const skip = page.getByRole('button', { name: 'Skip interstitial', exact: true });
    assert.equal(await skip.evaluate(button => button.tagName), 'BUTTON');
    assert.equal(await skip.evaluate(button => button.type), 'button');
    assert.equal(await skip.evaluate(button => document.activeElement === button), true);
    assert.equal(await skip.evaluate(button => button.tabIndex), 0);
    // Tabbing out and back demonstrates native keyboard reachability.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'before');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await skip.evaluate(button => document.activeElement === button), true);
    await page.keyboard.press(key);
    await outcome(1, 0);
    console.log(`Native ${key}, Tab navigation, pending autoplay, one-shot cleanup PASS`);
  }

  for (const input of ['mouse', 'touch']) {
    await start();
    await progress();
    await page.clock.fastForward(150);
    assert.equal(await page.evaluate(() => window.result.visible), 1);
    await page.setViewportSize({ width: 480, height: 800 });
    const bounds = await page.locator('[data-ofeliya-video]').boundingBox();
    assert.deepEqual(bounds, { x: 0, y: 0, width: 480, height: 800 });
    assert.equal(await page.evaluate(() => getComputedStyle(window.overlay).zIndex), '10000');
    assert.equal(await page.evaluate(() => getComputedStyle(window.media).pointerEvents), 'none');
    if (input === 'mouse') await page.mouse.click(240, 400);
    else await page.touchscreen.tap(240, 400);
    await outcome(1, 0);
    console.log(`${input} skip, visibility, layering and resize PASS`);
  }

  for (const type of ['ended', 'error', 'abort']) {
    await start();
    await page.evaluate(type => window.media.dispatchEvent(new Event(type)), type);
    await outcome(type === 'ended' ? 1 : 0, type === 'ended' ? 0 : 1);
  }
  await start({ mediaMode: 'reject' });
  await outcome(0, 1);
  await start();
  await page.clock.fastForward(1801);
  await outcome(0, 1);
  await start();
  await progress();
  await page.evaluate(() => window.media.dispatchEvent(new Event('waiting')));
  await page.clock.fastForward(2201);
  await outcome(0, 1);
  await start({ maxDurationMs: 500 });
  await progress();
  await page.clock.fastForward(501);
  await outcome(1, 0);
  console.log('ended/error/abort/rejected autoplay/start/stall/hard-limit outcomes PASS');

  await start();
  await page.evaluate(() => window.Interstitial.cancelActive());
  await outcome(0, 0);
  await start();
  await page.evaluate(() => document.getElementById('other').focus());
  await page.evaluate(() => window.media.dispatchEvent(new Event('ended')));
  await outcome(1, 0, 'other');
  await start();
  await page.evaluate(() => document.getElementById('before').remove());
  await page.keyboard.press('Enter');
  await outcome(1, 0, '');
  console.log('cancel and safe focus restoration (moved/disconnected target) PASS');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await server.close();
}
