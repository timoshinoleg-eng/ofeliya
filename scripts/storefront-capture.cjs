/**
 * Storefront capture — визуальная матрица витрины «после» (P1-4).
 *
 * Снимает mock-витрину на 5 вьюпортах x пропуск активен/неактивен
 * (верх списка + 3 скролл-позиции на кейс), кейс с pending-баннером и
 * оверлей успеха покупки. С --telegram — дополнительно вариант
 * Telegram Stars (стаб window.Telegram.WebApp + VITE_PAYMENTS_API_URL
 * у dev-сервера; реальных платежей нет — только рендер цен «N ★»).
 *
 * Запуск: NODE_PATH=<worktree>/node_modules node scripts/storefront-capture.cjs [--telegram]
 * Dev-сервер должен быть поднят (npx vite --port 5173 --strictPort);
 * для --telegram — с VITE_PAYMENTS_API_URL и VITE_TG_BOT_USERNAME.
 * Скриншоты: OFELIYA_CAPTURE_DIR (по умолчанию ~/workspace/your_files).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(
  fs.existsSync
);
if (!chrome) throw new Error('Chrome not found');

const BASE = process.env.OFELIYA_DEV_URL || 'http://127.0.0.1:5173';
const OUT = process.env.OFELIYA_CAPTURE_DIR || path.join(os.homedir(), 'workspace', 'your_files');
const TELEGRAM = process.argv.includes('--telegram');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORTS = [
  { width: 320, height: 520 },
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];
const STARS_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
];

const INIT_DATA =
  'user=' +
  encodeURIComponent(JSON.stringify({ id: 42, first_name: 'QA', username: 'qa' })) +
  '&auth_date=1797000000&hash=deadbeef';

async function boot(browser, viewport, opts) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript((o) => {
    localStorage.setItem(
      'ofeliya.meta.v1',
      JSON.stringify({ seasonPassUntilMs: o.passActive ? Date.now() + 30 * 24 * 3600 * 1000 : 0 })
    );
    if (o.pending) {
      localStorage.setItem(
        'ofeliya.payments.pending.v1',
        JSON.stringify([
          {
            nonce: 'qa-pending-1',
            productId: 'currency.rna-pack-s',
            stars: 35,
            createdAt: Date.now(),
            attempts: 0,
          },
        ])
      );
    }
    if (o.telegram) {
      const noop = () => {};
      window.Telegram = {
        WebApp: {
          initData: o.initData,
          initDataUnsafe: { user: { id: 42, first_name: 'QA', username: 'qa' } },
          version: '8.0',
          platform: 'android',
          colorScheme: 'dark',
          themeParams: {},
          isExpanded: true,
          viewportHeight: o.viewport.height,
          viewportStableHeight: o.viewport.height,
          openInvoice: noop,
          ready: noop,
          expand: noop,
          close: noop,
          setHeaderColor: noop,
          setBackgroundColor: noop,
          enableClosingConfirmation: noop,
          disableClosingConfirmation: noop,
          onEvent: noop,
          offEvent: noop,
          sendData: noop,
          openLink: noop,
          openTelegramLink: noop,
          showPopup: noop,
          showAlert: noop,
          showConfirm: noop,
          HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
          BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
          MainButton: { show: noop, hide: noop, onClick: noop, offClick: noop, setText: noop },
        },
      };
    }
  }, { ...opts, initData: INIT_DATA, viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  const variant = opts.telegram ? 'telegram' : 'mock';
  await page.goto(
    `${BASE}/?flag.storefront.variant=${variant}&flag.monetization.starter-pack=true`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__game.scene.getScene('Menu').scene.start('Storefront');
  });
  await page.waitForFunction(
    () =>
      window.__game.scene.isActive('Storefront') &&
      window.__game.scene.getScene('Storefront').state === 'ready',
    null,
    { timeout: 15000 }
  );
  await page.waitForFunction(() => document.fonts?.ready.then(() => true) ?? true, null, {
    timeout: 5000,
  }).catch(() => {});
  await sleep(400);
  return { ctx, page, errors };
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  console.log('  shot ' + name);
  return file;
}

async function scrollShots(page, base, fractions) {
  const limit = await page.evaluate(() => window.__game.scene.getScene('Storefront').scrollLimit);
  for (let i = 0; i < fractions.length; i++) {
    await page.evaluate((f) => {
      const s = window.__game.scene.getScene('Storefront');
      s.applyScroll(s.scrollLimit * f);
    }, fractions[i]);
    await sleep(200);
    await shot(page, `${base}-s${i + 2}.png`);
  }
  await page.evaluate(() => window.__game.scene.getScene('Storefront').applyScroll(0));
  await sleep(150);
  return limit;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Mock-матрица: вьюпорт x состояние пропуска.
  for (const vp of VIEWPORTS) {
    for (const passActive of [false, true]) {
      const state = passActive ? 'active' : 'inactive';
      const base = `store-after-${vp.width}x${vp.height}-${state}`;
      console.log(`case ${base}`);
      const { ctx, page, errors } = await boot(browser, vp, { passActive });
      try {
        if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
        await shot(page, `${base}.png`);
        await scrollShots(page, base, [0.33, 0.66, 1]);
      } finally {
        await ctx.close();
      }
    }
  }

  // Pending-баннер на самом узком экране.
  {
    console.log('case store-after-320x568-inactive-pending');
    const { ctx, page, errors } = await boot(browser, { width: 320, height: 568 }, { passActive: false, pending: true });
    try {
      if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
      await shot(page, 'store-after-320x568-inactive-pending.png');
    } finally {
      await ctx.close();
    }
  }

  // Оверлей успеха: покупка RNA-пакета (mock) на 390x844.
  {
    console.log('case store-after-390x844-success');
    const { ctx, page, errors } = await boot(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        s.buy(s.products.find((p) => p.id === 'currency.rna-pack-s'));
      });
      await page.waitForFunction(
        () => window.__game.scene.getScene('Storefront').state === 'success',
        null,
        { timeout: 10000 }
      );
      await sleep(600);
      if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
      await shot(page, 'store-after-390x844-success.png');
    } finally {
      await ctx.close();
    }
  }

  // Telegram Stars (только рендер: цены «N ★», подпись режима, баннер приглашения).
  if (TELEGRAM) {
    for (const vp of STARS_VIEWPORTS) {
      for (const passActive of [false, true]) {
        const state = passActive ? 'active' : 'inactive';
        const base = `store-after-${vp.width}x${vp.height}-${state}-stars`;
        console.log(`case ${base}`);
        const { ctx, page, errors } = await boot(browser, vp, { passActive, telegram: true });
        try {
          if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
          const mode = await page.evaluate(() => {
            const s = window.__game.scene.getScene('Storefront');
            return { variant: s.variant, provider: s.provider?.id ?? null, state: s.state };
          });
          console.log(`  scene: ${JSON.stringify(mode)}`);
          await shot(page, `${base}.png`);
          await scrollShots(page, base, [0.5, 1]);
        } finally {
          await ctx.close();
        }
      }
    }
  }

  await browser.close();
  console.log('storefront capture: done -> ' + OUT);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
