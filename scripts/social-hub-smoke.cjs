const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
const sizes = [
  { width: 320, height: 568 },
  { width: 360, height: 600 },
  { width: 390, height: 740 },
  { width: 412, height: 915 },
];
const UID = '987654321';
const INIT_DATA = 'signed-social-hub-ci';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const season = { ok: true, season: { index: 4, start: 1, end: 2, daysLeft: 12 } };
const top = {
  ok: true,
  top: [
    { rank: 1, platform: 'max', daily: false, win: true, timeMs: 184000, kills: 320, level: 12, dateKey: '2026-09-22', rulesetVersion: 2, campaignVersion: 2, difficultyId: 'standard', completionStage: 'heart' },
    { rank: 2, platform: 'telegram', daily: false, win: true, timeMs: 191000, kills: 305, level: 11, dateKey: '2026-09-22', rulesetVersion: 2, campaignVersion: 2, difficultyId: 'standard', completionStage: 'heart' },
    { rank: 3, platform: 'max', daily: false, win: true, timeMs: 205000, kills: 292, level: 10, dateKey: '2026-09-22', rulesetVersion: 2, campaignVersion: 2, difficultyId: 'standard', completionStage: 'heart' },
    { rank: 4, platform: 'telegram', daily: false, win: false, timeMs: 213000, kills: 280, level: 9, dateKey: '2026-09-22', rulesetVersion: 2, campaignVersion: 2, difficultyId: 'standard', completionStage: null },
  ],
};
const daily = { ok: true, dateKey: '2026-09-22', total: 1, rank: 2, you: { win: true, timeMs: 198000, kills: 287, rulesetVersion: 2 } };
const friends = {
  ok: true,
  friends: [
    { relation: 'both', platform: 'max', win: true, timeMs: 201000, kills: 270, level: 10, dateKey: '2026-09-22' },
    { relation: 'invited', platform: 'telegram', win: false, timeMs: 220000, kills: 260, level: 9, dateKey: '2026-09-22' },
    { relation: 'inviter', platform: 'max', win: true, timeMs: 230000, kills: 250, level: 8, dateKey: '2026-09-22' },
    { relation: 'both', platform: 'telegram', win: false, timeMs: 240000, kills: 240, level: 8, dateKey: '2026-09-22' },
  ],
};

function pathKey(url) {
  const u = new URL(url);
  return u.pathname + u.search;
}

function successBody(url) {
  const u = new URL(url);
  if (u.pathname.endsWith('/api/season')) return season;
  if (u.pathname.endsWith('/api/top')) return top;
  if (u.pathname.endsWith('/api/daily')) return daily;
  if (u.pathname.endsWith('/api/friends')) return friends;
  throw new Error('unexpected social request ' + u.pathname);
}

async function boot(browser, size, options = {}) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  const requests = [];
  let batch = 0;
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    requests.push({ method: req.method(), key: pathKey(req.url()) });
    if (options.mode === 'network') {
      await route.abort('failed');
      return;
    }
    if (options.mode === 'http-first' && batch < 4) {
      batch += 1;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      return;
    }
    if (options.mode === 'http') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      return;
    }
    if (options.mode === 'empty') {
      const u = new URL(req.url());
      const body = u.pathname.endsWith('/api/season')
        ? { ok: true, season: null }
        : u.pathname.endsWith('/api/top')
          ? { ok: true, top: [] }
          : u.pathname.endsWith('/api/daily')
            ? { ok: true, dateKey: null, total: 0, rank: null, you: null }
            : { ok: true, friends: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(successBody(req.url())) });
  });

  await ctx.addInitScript(({ width, height, uid, initData, withIdentity }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    sessionStorage.clear();
    window.__qaBack = null;
    const user = withIdentity ? { id: uid, first_name: 'QA', last_name: 'Social' } : undefined;
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData,
      initDataUnsafe: user ? { user } : {},
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async () => {},
      BackButton: {
        show() {},
        hide() {},
        onClick(fn) { window.__qaBack = fn; },
        offClick(fn) { if (window.__qaBack === fn) window.__qaBack = null; },
      },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { ...size, uid: UID, initData: INIT_DATA, withIdentity: options.withIdentity !== false });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await sleep(120);
  return { ctx, page, requests, errors };
}

async function namedBounds(page, name) {
  return page.evaluate((targetName) => {
    const menu = window.__game.scene.getScene('Menu');
    const flatten = (obj) => {
      const out = [obj];
      if (Array.isArray(obj?.list)) {
        for (const child of obj.list) out.push(...flatten(child));
      }
      return out;
    };
    const all = menu.children.list.flatMap(flatten);
    const obj = all.find((candidate) => candidate?.name === targetName);
    if (!obj || typeof obj.getBounds !== 'function') return null;
    const b = obj.getBounds();
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
  }, name);
}

async function clickNamed(page, name) {
  const b = await namedBounds(page, name);
  if (!b) throw new Error('missing clickable object ' + name);
  await page.mouse.click((b.left + b.right) / 2, (b.top + b.bottom) / 2);
}

async function waitLoaded(page) {
  await page.waitForFunction(() => {
    const menu = window.__game.scene.getScene('Menu');
    const root = menu.children.list.find((obj) => obj?.name === 'ofeliya-social-hub');
    if (!root) return false;
    const flatten = (obj) => {
      const out = [obj];
      if (Array.isArray(obj?.list)) for (const child of obj.list) out.push(...flatten(child));
      return out;
    };
    return !flatten(root).some((obj) => typeof obj?.text === 'string' && obj.text.includes('ЗАГРУЗКА'));
  }, null, { timeout: 8000 });
}

async function inspectHub(page, size) {
  return page.evaluate(({ width, height, uid, initData }) => {
    const menu = window.__game.scene.getScene('Menu');
    const root = menu.children.list.find((obj) => obj?.name === 'ofeliya-social-hub');
    if (!root) throw new Error('social hub root missing');
    const flatten = (obj) => {
      const out = [obj];
      if (Array.isArray(obj?.list)) for (const child of obj.list) out.push(...flatten(child));
      return out;
    };
    const all = flatten(root);
    const byName = (name) => all.find((obj) => obj?.name === name) ?? null;
    const panel = byName('ofeliya-social-panel');
    const close = byName('ofeliya-social-close-hit');
    const retry = byName('ofeliya-social-retry-bg');
    const disabled = byName('ofeliya-social-daily-disabled');
    const panelBounds = panel.getBounds();
    const closeBounds = close.getBounds();
    const retryBounds = retry?.getBounds?.() ?? null;
    const texts = all.filter((obj) => typeof obj?.text === 'string' && obj.visible !== false).map((obj) => obj.text);
    const content = all.filter((obj) => obj !== root && obj !== byName('ofeliya-social-dim') && obj !== panel && obj.visible !== false && typeof obj?.getBounds === 'function');
    const overflow = content
      .map((obj) => ({ name: obj.name || '', text: typeof obj.text === 'string' ? obj.text : '', bounds: obj.getBounds() }))
      .filter(({ bounds }) =>
        bounds.left < panelBounds.left - 1 ||
        bounds.right > panelBounds.right + 1 ||
        bounds.top < panelBounds.top - 1 ||
        bounds.bottom > panelBounds.bottom + 1
      );
    const joined = texts.join('\n');
    const forbidden = [uid, initData, 'run-seed-ci', 'run-id-ci', 'user=', '/api/'].filter((needle) => joined.includes(needle));
    return {
      screen: [width, height],
      panel: panelBounds,
      close: closeBounds,
      retry: retryBounds,
      disabledInteractive: Boolean(disabled?.input?.enabled),
      seasonRows: all.filter((obj) => String(obj?.name || '').startsWith('ofeliya-social-season-row-')).length,
      friendRows: all.filter((obj) => String(obj?.name || '').startsWith('ofeliya-social-friend-row-')).length,
      hasSeasonMore: Boolean(byName('ofeliya-social-season-more')),
      hasFriendsMore: Boolean(byName('ofeliya-social-friends-more')),
      texts,
      overflow,
      forbidden,
    };
  }, { ...size, uid: UID, initData: INIT_DATA });
}

function assertSuccessContract(contract, size) {
  if (contract.overflow.length) throw new Error('social hub overflow ' + JSON.stringify({ size, overflow: contract.overflow }));
  if (contract.panel.left < 0 || contract.panel.right > size.width || contract.panel.top < 0 || contract.panel.bottom > size.height) {
    throw new Error('social panel outside viewport ' + JSON.stringify({ size, panel: contract.panel }));
  }
  if (contract.close.width < 43 || contract.close.height < 43) throw new Error('social close target <44 ' + JSON.stringify(contract.close));
  if (contract.disabledInteractive) throw new Error('daily disabled surface must not be interactive');
  if (contract.seasonRows !== 3 || contract.friendRows !== 3 || !contract.hasSeasonMore || !contract.hasFriendsMore) {
    throw new Error('social row cap contract failed ' + JSON.stringify(contract));
  }
  if (contract.forbidden.length) throw new Error('PII/internal data leaked into canvas ' + JSON.stringify(contract.forbidden));
}

async function openHub(page) {
  await clickNamed(page, 'ofeliya-menu-social');
  await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').children.list.find((obj) => obj?.name === 'ofeliya-social-hub')));
  await waitLoaded(page);
}

async function runSuccessMatrix(browser) {
  for (const size of sizes) {
    const { ctx, page, requests, errors } = await boot(browser, size);
    await openHub(page);
    const contract = await inspectHub(page, size);
    assertSuccessContract(contract, size);

    const expected = [
      '/api/season',
      '/api/top?period=season',
      `/api/daily?user=${UID}&platform=max`,
      `/api/friends?user=${UID}&platform=max`,
    ].sort();
    const actual = requests.map((item) => item.key).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('social request set mismatch ' + JSON.stringify({ size, actual, expected }));
    }
    if (requests.some((item) => item.method !== 'GET' || item.key.includes('/api/daily/run'))) {
      throw new Error('forbidden Daily POST/request ' + JSON.stringify(requests));
    }

    const action = await namedBounds(page, 'ofeliya-menu-action');
    if (!action) throw new Error('menu action anchor missing');
    await page.mouse.click((action.left + action.right) / 2, (action.top + action.bottom) / 2);
    await sleep(120);
    const active = await page.evaluate(() => ({
      menu: window.__game.scene.isActive('Menu'),
      game: window.__game.scene.isActive('Game'),
    }));
    if (!active.menu || active.game) throw new Error('social overlay allowed menu click-through');

    await clickNamed(page, 'ofeliya-social-close-hit');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').children.list.find((obj) => obj?.name === 'ofeliya-social-hub'));

    await clickNamed(page, 'ofeliya-menu-social');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').children.list.find((obj) => obj?.name === 'ofeliya-social-hub')));
    const backAttached = await page.evaluate(() => typeof window.__qaBack === 'function');
    if (!backAttached) throw new Error('social hub Back handler not attached');
    await page.evaluate(() => window.__qaBack());
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').children.list.find((obj) => obj?.name === 'ofeliya-social-hub'));

    if (errors.length) throw new Error('pageerror in social success matrix ' + JSON.stringify({ size, errors }));
    await ctx.close();
  }
}

async function runStateCase(browser, mode, expectedText, options = {}) {
  const size = { width: 390, height: 740 };
  const { ctx, page, requests, errors } = await boot(browser, size, { mode, withIdentity: options.withIdentity });
  await openHub(page);
  let contract = await inspectHub(page, size);
  if (!contract.texts.some((text) => text.includes(expectedText))) {
    throw new Error(`state ${mode} missing text ${expectedText}: ${JSON.stringify(contract.texts)}`);
  }
  if (mode === 'http' || mode === 'network') {
    if (!contract.retry || contract.retry.width < 43 || contract.retry.height < 43) throw new Error(`state ${mode} retry target missing/undersized`);
    const before = requests.length;
    await sleep(500);
    if (requests.length !== before) throw new Error(`state ${mode} auto-retried`);
  } else if (contract.retry) {
    throw new Error(`state ${mode} must not show retry`);
  }
  if (errors.length) throw new Error(`pageerror in state ${mode}: ${JSON.stringify(errors)}`);
  await ctx.close();
}

async function runHttpRetry(browser) {
  const size = { width: 360, height: 600 };
  const { ctx, page, requests, errors } = await boot(browser, size, { mode: 'http-first' });
  await openHub(page);
  let contract = await inspectHub(page, size);
  if (!contract.retry || !contract.texts.some((text) => text.includes('СЕРВЕР НЕ ОТВЕТИЛ'))) {
    throw new Error('HTTP retry state missing');
  }
  if (requests.length !== 4) throw new Error('HTTP state request count before retry ' + requests.length);
  await clickNamed(page, 'ofeliya-social-retry-bg');
  await waitLoaded(page);
  contract = await inspectHub(page, size);
  if (contract.retry) throw new Error('retry control must clear after successful manual retry');
  if (contract.seasonRows !== 3 || contract.friendRows !== 3) throw new Error('manual retry did not render data');
  if (requests.length !== 8) throw new Error('manual retry must issue exactly one second batch: ' + requests.length);
  if (errors.length) throw new Error('pageerror in HTTP retry ' + JSON.stringify(errors));
  await ctx.close();
}

async function runSkipped(browser) {
  const size = { width: 390, height: 740 };
  const { ctx, page, requests, errors } = await boot(browser, size, { withIdentity: false });
  await openHub(page);
  const contract = await inspectHub(page, size);
  if (!contract.texts.some((text) => text.includes('ПОСЛЕ ВХОДА ЧЕРЕЗ MAX ИЛИ Telegram'))) {
    throw new Error('skipped identity copy missing ' + JSON.stringify(contract.texts));
  }
  const expected = ['/api/season', '/api/top?period=season'].sort();
  const actual = requests.map((item) => item.key).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('skipped identity request set mismatch ' + JSON.stringify({ actual, expected }));
  }
  if (contract.retry) throw new Error('skipped identity must not be rendered as an error');
  if (errors.length) throw new Error('pageerror in skipped identity ' + JSON.stringify(errors));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    await runSuccessMatrix(browser);
    await runStateCase(browser, 'empty', 'СЕГОДНЯ РЕЗУЛЬТАТА ЕЩЁ НЕТ');
    await runStateCase(browser, 'http', 'СЕРВЕР НЕ ОТВЕТИЛ');
    await runStateCase(browser, 'network', 'НЕТ СОЕДИНЕНИЯ');
    await runHttpRetry(browser);
    await runSkipped(browser);
    console.log('social hub browser smoke: ok (4 viewports + empty/http/network/skipped + retry + PII)');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
