import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { checkPlatformLifecycle } from './platform-lifecycle-browser.mjs';
import { checkMuseClient } from './muse-client-browser.mjs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const executablePath = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = server.resolvedUrls.local[0] + '?renderer=canvas';
  await checkPlatformLifecycle(browser, url);
  await checkMuseClient(browser, url);
  const page = await browser.newPage({ viewport: { width: 390, height: 740 }, timezoneId: 'America/Los_Angeles' });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  let dailyReads = 0;
  await page.route('https://st.max.ru/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', route => {
    let body = { ok: true };
    if (new URL(route.request().url()).pathname.endsWith('/api/daily')) {
      dailyReads++;
      body = { ok: true, dateKey: null, challengeDateKey: dailyReads === 1 ? '2026-10-12' : '2026-10-13', total: 0, rank: null, you: null,
        serverTime: 1000, nextDayAt: dailyReads === 1 ? 1050 : 86401000 };
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 15, muted: true, achievements: [], evolutionsSeen: [], legendarySeen: [] }));
    localStorage.setItem('ofeliya_difficulty_v1', 'standard');
    localStorage.setItem('ofeliya_control_mode_v1', 'dual-move');
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  // Real SocialHub uses server date and refreshes its displayed modifier at
  // server midnight even with a completely different device timezone/date.
  await page.evaluate(async () => {
    const { SocialHub } = await import('/src/ui/SocialHub.ts');
    const platform = { kind: 'telegram', initData: 'fixture', getUser: () => ({ id: 42 }), haptic() {}, setBackHandler() {} };
    window.__reviewHub = new SocialHub(window.__game.scene.getScene('Menu'), platform, async () => 'unavailable', () => {});
  });
  await page.waitForFunction(() => {
    const visit = item => item.name === 'ofeliya-social-daily-mutator' && item.text === 'ПЛОТНЫЙ РОЙ' || item.list?.some(visit);
    return window.__game.scene.getScene('Menu').children.list.some(visit);
  });
  assert.ok(dailyReads >= 2);
  await page.evaluate(() => window.__reviewHub.destroy());
  async function start(daily) {
    await page.evaluate(daily => {
      const game = window.__game;
      if (daily) {
        game.registry.set('dailyIntent', { runId: 'review-daily-ticket' });
        game.registry.set('dailyTicket', { runId: 'review-daily-ticket', runSeed: 'aabbccddeeff1122', dateKey: '2026-10-12',
          issuedAt: Date.now(), expiresAt: Date.now() + 600000, difficultyId: 'standard', rulesetVersion: 3, campaignVersion: 2 });
        game.registry.set('runSeedOverride', 'aabbccddeeff1122');
      } else { game.registry.remove('dailyIntent'); game.registry.remove('dailyTicket'); }
      game.registry.set('difficultyId', 'standard');
      game.scene.getScene('Menu').scene.start('Game');
    }, daily);
    await page.waitForFunction(daily => window.__game?.scene.getScene('Game').dailyRun === daily && window.__game.scene.isActive('UI'), daily);
    return page.evaluate(() => {
      const scene = window.__game.scene.getScene('Game');
      const texts = [];
      const visit = item => { if (typeof item.text === 'string') texts.push(item.text); item.list?.forEach(visit); };
      scene.children.list.forEach(visit);
      return { mutator: scene.dailyMutator?.id ?? null, batch: scene.difficulty.batchBonus, banners: texts.filter(text => text.includes('МУТАТОР ДНЯ')) };
    });
  }
  async function menu() {
    await page.evaluate(() => { const game = window.__game; game.scene.stop('UI'); game.scene.stop('Game'); game.scene.start('Menu'); });
    await page.waitForFunction(() => window.__game.scene.isActive('Menu'));
  }
  const first = await start(true);
  assert.equal(first.mutator, 'elite-surge');
  assert.equal(first.banners.length, 1);
  await menu();
  const ordinary = await start(false);
  assert.equal(ordinary.mutator, null);
  assert.equal(ordinary.batch, 0);
  assert.deepEqual(ordinary.banners, []);
  if (process.env.OFELIYA_REVIEW_SCREENSHOT) await page.screenshot({ path: process.env.OFELIYA_REVIEW_SCREENSHOT });
  await menu();
  assert.equal((await start(true)).mutator, 'elite-surge');
  assert.deepEqual(errors, []);
  await page.close();
  console.log('Browser: server-date midnight + daily → ordinary → daily PASS');

  for (const scenario of ['bridge-error', 'boot-error', 'bridge-stall']) {
    const failurePage = await browser.newPage({ viewport: { width: 390, height: 740 } });
    const pageErrors = [];
    failurePage.on('pageerror', error => pageErrors.push(String(error)));
    if (scenario.startsWith('bridge')) {
      await failurePage.route('**/src/platform/TelegramBridgeLoader.ts', route => route.fulfill({ contentType: 'application/javascript',
        body: 'export const TELEGRAM_BRIDGE_READY_EVENT = "ofeliya:telegram-bridge-ready";\n' +
          (scenario === 'bridge-error' ? 'export async function ensureTelegramBridge(){throw new Error("fixture bridge failure")}'
          : 'export async function ensureTelegramBridge(){await new Promise(()=>{})}') }));
    } else {
      await failurePage.route('**/src/platform/ViewportManager.ts', route => route.fulfill({ contentType: 'application/javascript',
        body: 'export class ViewportManager {start(){this.onResize=()=>window.__lateResize=true;window.addEventListener("resize",this.onResize)} async sync(){throw new Error("fixture boot failure")} destroy(){window.removeEventListener("resize",this.onResize);window.__viewportDestroyed=true}}' }));
    }
    if (scenario === 'bridge-stall') await failurePage.addInitScript(() => {
      const realTimeout = window.setTimeout.bind(window);
      // Accelerate only the production boundary's 15s deadline for this stalled
      // fixture; no other startup wait or successful-game timing is modified.
      window.setTimeout = (callback, delay, ...args) => realTimeout(callback, delay === 15000 ? 250 : delay, ...args);
    });
    await failurePage.goto(url, { waitUntil: 'domcontentloaded' });
    await failurePage.locator('#ofeliya-boot-failure').waitFor({ state: 'visible' });
    assert.equal(await failurePage.locator('#splash').count(), 0);
    assert.equal(await failurePage.locator('#ofeliya-boot-failure button').textContent(), 'ПОВТОРИТЬ');
    if (scenario === 'boot-error') {
      assert.equal(await failurePage.evaluate(() => { window.dispatchEvent(new Event('resize')); return Boolean(window.__viewportDestroyed) && !window.__lateResize; }), true, 'failure must detach the viewport listeners');
    }
    assert.deepEqual(pageErrors, [], 'startup failure must be handled, not become an unhandled rejection');
    await failurePage.close();
    console.log(`Browser: ${scenario} visible failure + no infinite splash PASS`);
  }
} finally { await browser?.close(); await server.close(); }
