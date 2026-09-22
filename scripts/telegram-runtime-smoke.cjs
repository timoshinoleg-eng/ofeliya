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
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 740 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  let telegramSdkRequests = 0;
  await ctx.route('https://st.max.ru/**', (route) => route.abort());
  await ctx.route('https://telegram.org/js/**', async (route) => {
    telegramSdkRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.Telegram = {
          WebApp: {
            initData: 'signed-telegram-qa',
            initDataUnsafe: {
              user: { id: 4242, first_name: 'Telegram', last_name: 'QA' },
              start_param: 'qa_start'
            },
            platform: 'android',
            version: '10.1',
            viewportHeight: 740,
            viewportStableHeight: 740,
            ready() { window.__telegramReady = true; },
            expand() { window.__telegramExpanded = true; },
            BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
            HapticFeedback: { impactOccurred() {}, notificationOccurred() {} }
          }
        };
      `,
    });
  });

  const browserPage = await ctx.newPage();
  await browserPage.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 5000 });
  await browserPage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 5000 });
  if (telegramSdkRequests !== 0) {
    throw new Error('plain browser launch unexpectedly requested Telegram SDK');
  }
  await browserPage.close();

  const tgPage = await ctx.newPage();
  const errors = [];
  tgPage.on('pageerror', (error) => errors.push(String(error)));
  await tgPage.goto(
    'http://127.0.0.1:5173/#tgWebAppData=signed&tgWebAppVersion=10.1&tgWebAppPlatform=android',
    { waitUntil: 'domcontentloaded', timeout: 5000 }
  );
  await tgPage.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 5000 });
  await tgPage.waitForFunction(
    () =>
      window.__game?.scene
        .getScene('Menu')
        ?.children?.list?.some((obj) => obj?.text === 'Носитель: Telegram QA'),
    null,
    { timeout: 5000 }
  );

  if (telegramSdkRequests !== 1) {
    throw new Error('Telegram launch expected exactly one SDK request, got ' + telegramSdkRequests);
  }
  const state = await tgPage.evaluate(() => ({
    initData: window.Telegram?.WebApp?.initData,
    ready: window.__telegramReady === true,
    expanded: window.__telegramExpanded === true,
  }));
  if (state.initData !== 'signed-telegram-qa' || !state.ready || !state.expanded) {
    throw new Error('Telegram adapter did not initialize correctly: ' + JSON.stringify(state));
  }
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));

  await ctx.close();
  await browser.close();
  console.log('telegram runtime browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
