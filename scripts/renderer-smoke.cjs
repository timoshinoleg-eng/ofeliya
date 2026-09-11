const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openRenderer(browser, renderer) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    sessionStorage.clear();
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-renderer-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'Renderer' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:5173/?renderer=${renderer}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await sleep(250);

  const state = await page.evaluate(() => {
    const game = window.__game;
    const menu = game.scene.getScene('Menu');
    const title = menu.children.list.find((obj) => obj.text === 'OFELIYA');
    const titleResolution = title?.style?.resolution ?? title?.resolution ?? null;
    return {
      renderer: game.renderer?.constructor?.name ?? '',
      rendererType: game.renderer?.type ?? null,
      titleResolution,
      titleTextureWidth: title?.texture?.source?.[0]?.width ?? null,
      titleDisplayWidth: title?.displayWidth ?? null,
      canvas: [game.canvas.width, game.canvas.height],
      css: [game.canvas.clientWidth, game.canvas.clientHeight],
      dpr: window.devicePixelRatio,
    };
  });

  if (renderer === 'webgl') {
    if (!state.renderer.startsWith('WebGLRenderer')) {
      throw new Error(`High-DPI WebGL path did not boot WebGL: ${JSON.stringify(state)}`);
    }
    if (state.titleResolution === null || state.titleResolution < 2) {
      throw new Error(`High-DPI WebGL text lost resolution: ${JSON.stringify(state)}`);
    }
  } else {
    if (state.renderer !== 'CanvasRenderer') {
      throw new Error(`Canvas fallback did not boot Canvas: ${JSON.stringify(state)}`);
    }
    if (state.titleResolution !== 1) {
      throw new Error(`Canvas fallback text must stay resolution=1: ${JSON.stringify(state)}`);
    }
  }

  if (errors.length) throw new Error(`${renderer} page errors: ${errors.join(' | ')}`);

  fs.mkdirSync('/tmp/browser-smoke', { recursive: true });
  await page.locator('#game').screenshot({
    path: `/tmp/browser-smoke/${renderer === 'webgl' ? '05-webgl-hidpi' : '06-canvas-fallback'}.png`,
  });
  await ctx.close();
  return state;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-angle=swiftshader',
    ],
  });

  const webgl = await openRenderer(browser, 'webgl');
  const canvas = await openRenderer(browser, 'canvas');
  await browser.close();
  console.log(`Renderer smoke: ok; WebGL=${JSON.stringify(webgl)} Canvas=${JSON.stringify(canvas)}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
