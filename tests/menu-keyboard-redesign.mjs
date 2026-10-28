import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const executablePath = process.platform === 'win32' ? undefined
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 740 },
    { width: 768, height: 1024 }, { width: 1080, height: 1920 }]) {
    const page = await browser.newPage({ viewport });
    await page.route('https://st.max.ru/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
    await page.route('**/api/**', r => r.fulfill({ status: 503, body: '{}' }));
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas&video=0');
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    const canvas = page.locator('canvas');
    assert.equal(await canvas.getAttribute('tabindex'), '0', 'game canvas must be keyboard focusable');
    await canvas.focus();
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('Сложность'));
    const before = await page.evaluate(() => window.__game.registry.get('difficultyId'));
    await page.keyboard.press('Enter');
    const after = await page.evaluate(() => window.__game.registry.get('difficultyId'));
    assert.notEqual(after, before, 'Enter on difficulty must run the actual selector action');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.includes('Управление'));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.toUpperCase().includes('НАЧАТЬ'));
    assert.ok(await page.evaluate(() => !!window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-keyboard-focus')));
    await page.keyboard.press('ArrowDown'); // rating
    await page.keyboard.press('ArrowDown'); // tasks
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').questBoard));
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => Boolean(window.__game.scene.getScene('Menu').questBoard)), true,
      'menu activation must remain blocked behind the board');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').questBoard);
    await page.keyboard.press('ArrowDown'); // codex
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').codexOverlay));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').codexOverlay);
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.toUpperCase().includes('О ПРИЛОЖЕНИИ'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#ofeliya-legal-overlay');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#ofeliya-legal-overlay', { state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement === window.__game.canvas), true,
      'closing legal must restore canvas focus');
    console.log('PASS redesigned menu keyboard selector, navigation, focus ring and real action', viewport);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
