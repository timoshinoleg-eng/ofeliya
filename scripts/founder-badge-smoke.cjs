const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const profile = (withBadge) => ({
  ok: true,
  profile: {
    profileVersion: 1,
    createdAt: 1000,
    updatedAt: 2000,
    preferences: {},
    records: {
      bestSurvivalMs: 0,
      bestBoss1ClearMs: 0,
      bestCampaignClearMs: 0,
      bestKills: 0,
      bestLevel: 0,
      runs: 1,
      totalKills: 0,
      achievements: [],
      migrated: false,
    },
    inventory: {
      schemaVersion: 1,
      items: withBadge
        ? { 'founder-badge-v1': { source: 'grant', grantedAt: 1500 } }
        : {},
    },
  },
});

async function maxContext(browser, withBadge) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 740 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  const profileRequests = [];
  await ctx.route('**/api/profile', async (route) => {
    profileRequests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile(withBadge)),
    });
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-founder-badge-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'QA', last_name: 'Carrier' } },
      getViewportSize: async () => ({ width: '390', height: '740' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  return { ctx, profileRequests };
}

async function readBadge(page) {
  return page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const badge = menu.children.list.find((obj) => obj?.name === 'ofeliya-menu-founder-badge');
    if (!badge) return null;
    const bounds = badge.getBounds();
    const texts = (badge.list || [])
      .filter((obj) => typeof obj?.text === 'string')
      .map((obj) => obj.text);
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      texts,
    };
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Signed profile with the server entitlement: render exactly one bounded cosmetic mark.
  {
    const { ctx, profileRequests } = await maxContext(browser, true);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await page.waitForFunction(() =>
      window.__game.scene.getScene('Menu').children.list.some(
        (obj) => obj?.name === 'ofeliya-menu-founder-badge'
      )
    );
    const badge = await readBadge(page);
    if (!badge || !badge.texts.some((text) => text.includes('ЗНАК ОСНОВАТЕЛЯ'))) {
      throw new Error('server-proven founder badge did not render');
    }
    if (badge.left < 12 || badge.right > 378 || badge.top < 2 || badge.bottom > 738) {
      throw new Error('founder badge overflow: ' + JSON.stringify(badge));
    }
    if (profileRequests.length !== 1 || profileRequests[0].method !== 'POST') {
      throw new Error('profile read request contract changed: ' + JSON.stringify(profileRequests));
    }
    if (
      profileRequests[0].body?.platform !== 'max' ||
      profileRequests[0].body?.initData !== 'signed-founder-badge-smoke'
    ) {
      throw new Error('profile read identity contract changed');
    }
    const visibleCopy = await page.evaluate(() =>
      window.__game.scene.getScene('Menu').children.list
        .flatMap((obj) => Array.isArray(obj?.list) ? obj.list : [obj])
        .filter((obj) => typeof obj?.text === 'string')
        .map((obj) => obj.text)
        .join('\n')
    );
    if (visibleCopy.includes('founder-badge-v1')) {
      throw new Error('internal entitlement id leaked into player copy');
    }
    if (errors.length) throw new Error('pageerror with founder badge: ' + errors.join(' | '));
    await ctx.close();
  }

  // Signed profile without entitlement: no cosmetic mark.
  {
    const { ctx, profileRequests } = await maxContext(browser, false);
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await page.waitForTimeout(350);
    if (await readBadge(page)) throw new Error('badge rendered without server entitlement');
    if (profileRequests.length !== 1) throw new Error('profile read did not complete exactly once');
    await ctx.close();
  }

  // Browser/no signed messenger identity: ProfileClient must stay offline and badge fail-closed.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 740 } });
    let profileRequests = 0;
    await ctx.route('**/api/profile', async (route) => {
      profileRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(profile(true)),
      });
    });
    await ctx.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await page.waitForTimeout(350);
    if (profileRequests !== 0) throw new Error('browser mode attempted a profile network read');
    if (await readBadge(page)) throw new Error('browser mode rendered a founder badge');
    await ctx.close();
  }

  await browser.close();
  console.log('founder badge browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
