const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-startup-viewport-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Startup', last_name: 'QA' } },
      getViewportSize: () => new Promise(() => {}),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const startedAt = Date.now();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
  const elapsedMs = Date.now() - startedAt;
  const state = await page.evaluate(() => ({
    splash: Boolean(document.querySelector('#splash')),
    canvases: document.querySelectorAll('#game canvas').length,
    scale: [window.__game?.scale.width, window.__game?.scale.height],
  }));

  if (state.splash || state.canvases !== 1 || JSON.stringify(state.scale) !== JSON.stringify([390, 844])) {
    throw new Error('stalled bridge fallback failed: ' + JSON.stringify(state));
  }
  // This gate proves the bridge cannot hang startup. GitHub runner cold-start time is noisy,
  // so keep the wall-clock ceiling comfortably above the 320ms bridge timeout while still
  // failing a genuinely unresolved startup.
  if (elapsedMs >= 5000) throw new Error('stalled bridge delayed startup: ' + elapsedMs + 'ms');
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await browser.close();
  console.log('stalled MAX viewport startup smoke: ok (' + elapsedMs + 'ms)');

  const { execFileSync } = require('child_process');
  execFileSync(process.execPath, ['scripts/startup-trace-smoke.cjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['scripts/max-bridge-nonblocking-smoke.cjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
