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
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const getMotion = () => page.evaluate(async () => {
    const { prefersReducedMotion } = await import('/src/systems/MotionPreferences.ts');
    return prefersReducedMotion();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await getMotion(), true, 'reduced motion preference must be respected');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await getMotion(), false, 'changing preference must be observed immediately');
  console.log('reduced motion media preference dynamic detection PASS');
} finally {
  await browser?.close();
  await server.close();
}
