/**
 * QuestBoard toast depth smoke (CR4).
 *
 * Тост о награде за сезонную миссию должен быть ВИДЕН поверх QuestBoard
 * (root depth 70 + дим): showMetaToast вызывается из claim с depth > 70.
 * Проверяет в headless Chromium (dev-сервер на 127.0.0.1:5173):
 *  - сид сезона: миссия season.runs-10 выполнена (10 забегов, free-трек);
 *  - открытие доски заданий, тап «ЗАБРАТЬ»;
 *  - тост '+200 РНК' создан с depth > depth доски (70).
 *
 * Запуск: NODE_PATH=<worktree>/node_modules node scripts/questboard-toast-depth-smoke.cjs
 * (dev-сервер должен быть уже поднят: npx vite --port 5173 --strictPort).
 */
const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  chromium.executablePath(),
].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const BASE = process.env.OFELIYA_DEV_URL || 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function touchAt(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const failures = [];
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });
    await ctx.route('https://st.max.ru/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    );
    // Сид сезона: текущий месяц UTC, 10 забегов → season.runs-10 выполнена
    // (free-трек, награда +200 РНК, пропуск не нужен).
    await ctx.addInitScript(() => {
      const d = new Date();
      const seasonId = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      localStorage.setItem(
        'ofeliya.season-quests.v1',
        JSON.stringify({ version: 1, seasonId, progress: { runs: 10 }, claimed: [] })
      );
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game && window.__game.scene, null, { timeout: 15000 });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 15000 });
    await sleep(500);

    // Открыть доску заданий.
    await page.evaluate(() => window.__game.scene.getScene('Menu').showQuestBoard());
    await sleep(500);
    const boardOpen = await page.evaluate(
      () => !!window.__game.scene.getScene('Menu').questBoard?.root
    );
    if (!boardOpen) {
      failures.push('доска заданий не открылась');
    } else {
      // Кнопка «ЗАБРАТЬ» миссии (текст — центр кнопки).
      const btn = await page.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        let found = null;
        const visit = (o) => {
          if (found) return;
          if (o?.type === 'Text' && o.text === 'ЗАБРАТЬ') found = o;
          if (Array.isArray(o?.list)) o.list.forEach(visit);
        };
        visit(menu.questBoard.root);
        if (!found) return { found: false };
        const b = found.getBounds();
        return { found: true, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
      });
      if (!btn.found) {
        failures.push('кнопка «ЗАБРАТЬ» не найдена (миссия не claimable?)');
      } else {
        await touchAt(ctx, page, { x: btn.x, y: btn.y });
        // Тост живёт ~1.4 с — читаем depth сразу после тапа.
        await sleep(150);
        const toast = await page.evaluate(() => {
          const menu = window.__game.scene.getScene('Menu');
          const boardDepth = menu.questBoard?.root?.depth ?? null;
          let toastDepth = null;
          let toastTexts = null;
          for (const o of menu.children.list) {
            if (o?.type !== 'Container') continue;
            const texts = (o.list ?? []).filter((c) => c?.type === 'Text').map((c) => c.text);
            if (texts.includes('+200 РНК')) {
              toastDepth = o.depth;
              toastTexts = texts.join(' | ');
            }
          }
          return { boardDepth, toastDepth, toastTexts };
        });
        if (toast.toastDepth == null) {
          failures.push('тост о награде (+200 РНК) не создан после claim');
        } else if (!(toast.toastDepth > toast.boardDepth)) {
          failures.push(
            `тост depth ${toast.toastDepth} <= доски ${toast.boardDepth} — подтверждение награды не видно (${toast.toastTexts})`
          );
        } else {
          console.log(`  toast depth ${toast.toastDepth} > board depth ${toast.boardDepth} (${toast.toastTexts})`);
        }
      }
    }
    if (errors.length) failures.push(`page errors: ${errors.join(' | ')}`);
    await ctx.close();
  } finally {
    await browser.close();
  }
  if (failures.length) {
    for (const f of failures) console.error('  FAIL ' + f);
    console.log('questboard toast depth smoke: FAILED');
    process.exit(1);
  }
  console.log('questboard toast depth smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
