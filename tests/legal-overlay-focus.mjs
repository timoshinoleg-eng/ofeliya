import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Isolated DOM fixture, loading the actual module through Vite; no game or bridge changes.
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'legal-focus-fixture', configureServer(vite) {
    vite.middlewares.use('/__legal-focus', (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body><button id="opener">Legal</button><button id="other">Other</button></body></html>');
    });
  } }],
});
let browser;
try {
  await server.listen();
  const executablePath = process.platform === 'win32' ? undefined :
    ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 740 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(server.resolvedUrls.local[0] + '__legal-focus');
  await page.evaluate(async () => {
    const { showLegalOverlay } = await import('/src/legal/LegalOverlay.ts');
    window.openLegal = showLegalOverlay;
    window.liveKeys = new Set();
    const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
    document.addEventListener = (type, listener, options) => {
      if (type === 'keydown' || type === 'keyup') window.liveKeys.add(listener);
      add(type, listener, options);
    };
    document.removeEventListener = (type, listener, options) => {
      if (type === 'keydown' || type === 'keyup') window.liveKeys.delete(listener);
      remove(type, listener, options);
    };
    window.leakedKeys = [];
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => window.leakedKeys.push(e.key));
    document.querySelector('#opener').onclick = showLegalOverlay;
  });
  const dialog = page.locator('#ofeliya-legal-overlay');
  const focused = () => page.evaluate(() => document.activeElement?.className || document.activeElement?.id);
  const open = async () => {
    await page.locator('#opener').click();
    assert.equal(await focused(), 'legal-close');
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  };
  const closed = async (expected = 'opener') => {
    assert.equal(await dialog.count(), 0);
    assert.equal(await focused(), expected);
    assert.equal(await page.evaluate(() => window.liveKeys.size), 0, 'document keyboard listeners cleaned up');
  };

  await open();
  // Ignore hidden, disabled, non-tabbable and inert native controls.
  await dialog.evaluate(root => root.insertAdjacentHTML('beforeend',
    '<button hidden>Hidden</button><button disabled>Disabled</button><a href="#" tabindex="-1">Skipped</a>' +
    '<button style="visibility:hidden">Invisible</button><div inert><button>Inert</button></div>'));
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelectorAll('#ofeliya-legal-overlay .legal-sheet a')[1]), true);
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'legal-close', 'forward wraps to close');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#ofeliya-legal-overlay a')), true);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'legal-close');
  await page.keyboard.press('a');
  assert.deepEqual(await page.evaluate(() => window.leakedKeys), [], 'modal keyboard input does not reach gameplay bubble listeners');
  await page.locator('.legal-close').click();
  await closed();
  await page.keyboard.press('a');
  assert.deepEqual(await page.evaluate(() => window.leakedKeys), ['a', 'a'], 'keyboard released after close');

  await open();
  await page.keyboard.press('Escape');
  await closed();
  await open();
  await dialog.click({ position: { x: 5, y: 5 } });
  await closed();

  await open();
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.openLegal(); });
  assert.equal(await dialog.count(), 1);
  assert.equal(await page.evaluate(() => window.liveKeys.size), 1, 'only current overlay owns listeners');
  await page.keyboard.press('Escape');
  await closed();

  await open();
  await page.locator('#other').evaluate(element => element.focus());
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'legal-close', 'forward Tab recovers outside focus');
  await page.locator('#other').evaluate(element => element.focus());
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelectorAll('#ofeliya-legal-overlay a')[1]), true);
  await page.locator('#other').evaluate(element => element.focus());
  await page.evaluate(() => document.querySelector('.legal-close').click());
  await closed('other');

  await open();
  await page.evaluate(() => {
    const unrelated = document.createElement('div');
    unrelated.setAttribute('role', 'dialog');
    unrelated.innerHTML = '<button id="unrelated">Unrelated</button>';
    document.body.append(unrelated);
    document.querySelector('#unrelated').focus();
  });
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 1, 'unrelated dialog Escape is untouched');
  await page.evaluate(() => document.querySelector('.legal-close').click());
  await closed('unrelated');
  await page.locator('#unrelated').evaluate(element => element.parentElement.remove());

  await open();
  await dialog.evaluate(root => root.querySelectorAll('button, a').forEach(element => element.remove()));
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'ofeliya-legal-overlay', 'empty dialog retains focus');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focused(), 'ofeliya-legal-overlay');
  await page.keyboard.press('Escape');
  await closed();

  await open();
  await page.locator('#opener').evaluate(element => element.remove());
  await page.keyboard.press('Escape');
  await closed(''); // Chromium falls back to body; detached opener is never focused.
  assert.deepEqual(errors, []);
  console.log('PASS LegalOverlay: Tab/Shift+Tab, close/Escape/backdrop, focus recovery/restoration, listener cleanup, unrelated dialog, detached opener');
} finally {
  await browser?.close();
  await server.close();
}
