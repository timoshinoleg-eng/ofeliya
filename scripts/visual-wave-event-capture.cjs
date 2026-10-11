// Wave-event visual capture (P0-1 wave events).
// Usage: node scripts/visual-wave-event-capture.cjs <out-dir> [tag]
// Drives the real game in headless Chromium at the primary 390x740 viewport,
// survives to the first Bloodstream wave event (encircle @ 02:10) and saves
// one screenshot during the telegraph and one right after the burst.
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'visual-qa');
const TAG = process.argv[3] || 'capture';
const PORT = process.env.WAVE_EVENT_PORT || '5173';

const TELEGRAPH_AT_MS = 128_600; // encircle-1 atMs 130_000 minus 1_400 lead
const BURST_AT_MS = 131_200;

function browserDriver() {
  try {
    const { chromium } = require('playwright');
    const managed = chromium.executablePath();
    if (managed && fs.existsSync(managed)) return { chromium, executablePath: managed };
  } catch {}
  const { chromium } = require('playwright-core');
  const executablePath = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function touchText(page, sceneKey, label) {
  const point = await page.evaluate(({ sceneKey, label }) => {
    const scene = window.__game.scene.getScene(sceneKey);
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    scene.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === label && obj.visible !== false);
    if (!text) return null;
    const candidates = flat
      .filter((obj) => obj?.input?.enabled && typeof obj.getBounds === 'function')
      .map((obj) => ({ bounds: obj.getBounds() }))
      .filter(
        ({ bounds }) =>
          text.x >= bounds.left && text.x <= bounds.right && text.y >= bounds.top && text.y <= bounds.bottom
      )
      .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
    const bounds = candidates[0]?.bounds;
    return bounds ? { x: Math.round(bounds.centerX), y: Math.round(bounds.centerY) } : null;
  }, { sceneKey, label });
  if (!point) throw new Error(`touch target not found: ${sceneKey}/${label}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(35);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function touchMutationCard(page) {
  const pt = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (o) => {
      flat.push(o);
      if (Array.isArray(o?.list)) o.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    const titles = flat.filter(
      (o) =>
        o?.visible !== false &&
        typeof o?.text === 'string' &&
        (/УРОВЕНЬ 1\//.test(o.text) || /ЛЕГЕНДАРНАЯ|КРИТИЧЕСКАЯ МУТАЦИЯ/.test(o.text))
    );
    if (!titles.length) return null;
    // Survival heuristic: regen first, then defence family, then the first card.
    const score = (title) => {
      const tb = title.getBounds();
      const texts = flat
        .filter((o) => typeof o?.text === 'string' && o.visible !== false)
        .filter((o) => {
          const b = o.getBounds();
          return b.centerX >= tb.left - 90 && b.centerX <= tb.right + 90 && Math.abs(b.centerY - tb.centerY) < 130;
        })
        .map((o) => o.text);
      if (texts.some((t) => /РЕКОМБИНАЦИЯ/.test(t))) return 0;
      if (texts.some((t) => /ЗАЩИТА/.test(t))) return 1;
      return 2;
    };
    const title = [...titles].sort((a, b) => score(a) - score(b))[0];
    if (!title) return null;
    const tb = title.getBounds();
    const cards = flat
      .filter((o) => o?.input?.enabled && typeof o.getBounds === 'function')
      .map((o) => ({ b: o.getBounds() }))
      .filter(({ b }) => tb.centerX >= b.left && tb.centerX <= b.right && tb.centerY >= b.top && tb.centerY <= b.bottom)
      .sort((a, b) => a.b.width * a.b.height - b.b.width * b.b.height);
    return cards[0] ? { x: Math.round(cards[0].b.centerX), y: Math.round(cards[0].b.centerY) } : null;
  });
  if (!pt) return false;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: pt.x, y: pt.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(35);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.mkdirSync(OUT, { recursive: true });

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 740 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem(
      'ofeliya_save_v1',
      JSON.stringify({ muted: true, runs: 2, tutorialDone: true })
    );
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-wave-event-capture',
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'Carrier' } },
      getViewportSize: async () => ({ width: '390', height: '740' }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await sleep(4_000);

  // Start a standard run through the real menu action.
  await page.waitForFunction(() => window.__game?.scene?.isActive?.('Menu'));
  await touchText(page, 'Menu', 'НАЧАТЬ ЗАРАЖЕНИЕ');
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const stageTime = () =>
    page.evaluate(() => {
      const scene = window.__game?.scene?.getScene?.('Game');
      return scene?.runState?.stage?.timeMs ?? -1;
    });

  // Evasive drift: kiting through the floating joystick. Every tick reads the
  // live enemy field and steers away from the nearest threat centroid.
  let drifting = true;
  const drift = (async () => {
    let engaged = false;
    while (drifting) {
      try {
        const dir = await page.evaluate(() => {
          const gs = window.__game?.scene?.getScene?.('Game');
          const player = gs?.player;
          if (!player || !gs?.enemies) return null;
          let wx = 0;
          let wy = 0;
          for (const enemy of gs.enemies.getChildren()) {
            if (!enemy.active) continue;
            const dx = player.x - enemy.x;
            const dy = player.y - enemy.y;
            const d = Math.hypot(dx, dy);
            if (d < 1 || d > 420) continue;
            const w = (1 - d / 420) / d;
            wx += dx * w;
            wy += dy * w;
          }
          if (wx === 0 && wy === 0) return null;
          const len = Math.hypot(wx, wy);
          return { x: wx / len, y: wy / len };
        });
        if (dir) {
          const x = Math.round(195 + dir.x * 60);
          const y = Math.round(560 + dir.y * 60);
          const joy = await page.evaluate(() => window.__game?.registry?.get('joy'));
          const joystickLive = Boolean(joy && (joy.x !== 0 || joy.y !== 0));
          if (!engaged || !joystickLive) {
            // Pointer-down can be swallowed by a level-up modal; re-engage.
            await page.mouse.up().catch(() => {});
            await page.mouse.move(195, 560);
            await page.mouse.down();
            engaged = true;
          }
          await page.mouse.move(x, y, { steps: 1 });
        }
      } catch {}
      await sleep(140);
    }
    await page.mouse.up().catch(() => {});
  })();

  const waitUntil = async (targetMs, budgetMs) => {
    const started = Date.now();
    let lastT = -1;
    for (;;) {
      const t = await stageTime();
      if (t >= targetMs) return t;
      if (t !== lastT) {
        lastT = t;
      } else if (Date.now() - started > budgetMs) {
        const state = await page.evaluate(() => {
          const g = window.__game;
          const gs = g?.scene?.getScene?.('Game');
          return {
            phase: gs?.stageDirector?.phase,
            hp: gs?.runState?.stage?.hp,
            active: g?.scene?.isActive?.('Game'),
          };
        });
        throw new Error(
          `stage clock stuck at ${t} on the way to ${targetMs}: ${JSON.stringify(state)}`
        );
      }
      await sleep(250);
    }
  };

  // Run clock only advances while PLAYING; level-up modals pause it, so
  // resolve them by touching the first mutation card through the real UI.
  const resolveChoices = (async () => {
    while (drifting) {
      try {
        await touchMutationCard(page);
      } catch {}
      await sleep(400);
    }
  })();

  const t0 = await stageTime();
  if (t0 < 0) throw new Error('game scene not reachable');

  await waitUntil(TELEGRAPH_AT_MS, 240_000);
  await page.screenshot({ path: path.join(OUT, `wave-event-telegraph-${TAG}.png`) });

  await waitUntil(BURST_AT_MS, 30_000);
  await page.screenshot({ path: path.join(OUT, `wave-event-burst-${TAG}.png`) });

  drifting = false;
  await Promise.allSettled([drift, resolveChoices]);
  await browser.close();

  if (errors.length) {
    console.log(`page errors (non-fatal): ${errors.slice(0, 3).join(' | ')}`);
  }
  console.log(`wave-event captures saved to ${OUT} (tag=${TAG})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
