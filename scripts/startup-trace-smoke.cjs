const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const REQUIRED_MARKS = [
  'runtime-config',
  'runtime-config.release-match',
  'max.bridge.loaded',
  'main.module',
  'boot.start',
  'viewport.first.start',
  'viewport.first.end',
  'fonts.start',
  'fonts.end',
  'renderer.select.start',
  'renderer.select.end',
  'phaser.construct.start',
  'phaser.construct.end',
  'viewport.second.start',
  'viewport.second.end',
  'boot.scene.create',
  'boot.textures.start',
  'boot.textures.end',
  'splash.removed',
  'menu.start.request',
  'menu.create.start',
  'menu.cinematicTextures.start',
  'menu.cinematicTextures.end',
  'menu.strainTextures.start',
  'menu.strainTextures.end',
  'menu.create.end',
  'menu.visible',
];

async function waitForTrace(page) {
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ofeliya_startup_trace_history_v1');
    if (!raw) return false;
    try {
      const history = JSON.parse(raw);
      return Array.isArray(history) && history.length > 0 && history[0]?.marks?.some((m) => m.name === 'menu.visible');
    } catch {
      return false;
    }
  });
  return page.evaluate(() => ({
    history: JSON.parse(localStorage.getItem('ofeliya_startup_trace_history_v1') || '[]'),
    overlay: document.getElementById('ofeliya-startup-trace')?.textContent || '',
    href: location.href,
  }));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'startup-trace-secret-token',
      initDataUnsafe: {
        user: { id: 987654321, first_name: 'TraceSecret', username: 'must-not-be-stored' },
      },
      getViewportSize: async () => {
        await new Promise((resolve) => setTimeout(resolve, 90));
        return { width: '390', height: '844' };
      },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto('http://127.0.0.1:5173/?startupTrace=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  const first = await waitForTrace(page);
  const firstTrace = first.history[0];
  if (!firstTrace) throw new Error('first startup trace missing');

  const names = new Set(firstTrace.marks.map((mark) => mark.name));
  for (const required of REQUIRED_MARKS) {
    if (!names.has(required)) throw new Error('startup trace missing mark: ' + required);
  }
  if ((firstTrace.meta?.redirectCount ?? 0) < 1) {
    throw new Error('clean launch did not capture runtime-config redirect');
  }
  if (!(firstTrace.totalMs > 0)) throw new Error('invalid startup total');
  if (!first.overlay.includes('OFELIYA STARTUP TRACE')) throw new Error('debug overlay missing');
  if (!first.href.includes('app=')) throw new Error('release URL redirect did not complete');

  const serialized = JSON.stringify(first.history);
  for (const forbidden of ['startup-trace-secret-token', 'TraceSecret', 'must-not-be-stored', '987654321']) {
    if (serialized.includes(forbidden)) throw new Error('startup trace leaked user data: ' + forbidden);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  const second = await waitForTrace(page);
  if (second.history.length < 2) throw new Error('startup trace history did not retain previous launch');
  const secondTrace = second.history[0];
  if ((secondTrace.meta?.redirectCount ?? -1) !== 0) {
    throw new Error('already-versioned reload should not report release redirect: ' + secondTrace.meta?.redirectCount);
  }
  if (second.history.length > 6) throw new Error('startup trace history exceeded retention limit');
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await ctx.close();
  await browser.close();
  console.log(
    'startup trace smoke: ok (' +
      firstTrace.totalMs.toFixed(1) +
      'ms first, ' +
      secondTrace.totalMs.toFixed(1) +
      'ms reload)'
  );
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
