import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const executablePath = process.platform === 'win32' ? undefined :
  ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.route('https://st.max.ru/**', (route) => route.fulfill({ body: '' }));
  await page.goto(`${process.env.OFELIYA_URL || 'http://127.0.0.1:4173/'}?renderer=canvas`);
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  const scenes = await page.evaluate(() => {
    const game = window.__game;
    for (const key of ['UI', 'Game', 'Menu']) game.scene.remove(key);
    return window.__renderSnapshot().scenes;
  });
  assert.deepEqual(scenes, ['Menu', 'Game', 'UI'].map((key) => ({
    key, active: false, paused: false, camera: null, texts: [],
  })), 'missing canonical scenes must return empty diagnostic records');
  console.log('render snapshot missing scenes: ok');
} finally { await browser.close(); }
