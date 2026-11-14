'use strict';
/**
 * Прогон телефонного QA-модуля в headless-браузере.
 *
 * Тот же код, что пойдёт на телефон: `?qa=<param>` → два эпизода с одинаковым
 * стартом. Здесь игрок не играет (без ввода), поэтому эпизод заканчивается
 * смертью или таймаутом — этого достаточно, чтобы проверить, что модуль доводит
 * эпизод до конца и пишет итог в localStorage (то есть итог переживает смерть).
 *
 * Запуск:
 *   NODE_PATH=/workspace/ofeliya/node_modules \
 *   OFELIYA_BASE_URL=http://127.0.0.1:5175/ \
 *   QA_PARAM=carry-pair STORE_KEY=ofeliya_qa_carry_pair_v1 EPISODES=2 \
 *   node probe/phone-pair-smoke.cjs
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5175/';
const SEED = process.env.SEED || 'phone-1';
const QA_PARAM = process.env.QA_PARAM || 'carry-pair';
const STORE_KEY = process.env.STORE_KEY || 'ofeliya_qa_carry_pair_v1';
const EPISODES = Number(process.env.EPISODES || 2);
const FAST = process.env.FAST === '1' ? '&fast=1' : '';
const EXTRA = process.env.EXTRA || '';
const OUT = path.join(require('os').tmpdir(), 'ofeliya-carry-integrated.json');

function browserDriver() {
  const { chromium } = require('playwright');
  const candidates = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* not registered */
  }
  for (const root of [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME || '', '.cache/ms-playwright'),
    '/root/.cache/ms-playwright',
    '/workspace/.home/.cache/ms-playwright',
  ]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      candidates.push(
        path.join(root, dir, 'chrome-linux64', 'chrome'),
        path.join(root, dir, 'chrome-linux', 'chrome')
      );
    }
  }
  candidates.unshift('C:/Program Files/Google/Chrome/Application/chrome.exe');
  candidates.push('/usr/bin/chromium', '/usr/bin/google-chrome');
  const executablePath = candidates.find((c) => c && fs.existsSync(c));
  if (!executablePath) throw new Error('Chromium not found');
  return { chromium, executablePath };
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    localStorage.removeItem('ofeliya_run_checkpoint_v1');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-phone-pair',
      initDataUnsafe: { user: { id: 42, first_name: 'Phone', last_name: 'QA' } },
      getViewportSize: async () => ({ width: 390, height: 844 }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(String(e));
    console.log('  PAGEERR:', String(e).split('\n').slice(0, 4).join(' | '));
  });

  await page.goto(`${BASE_URL}?qa=${QA_PARAM}&seed=${SEED}${FAST}${EXTRA}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Начать эпизод 1')),
    null,
    { timeout: 180_000 }
  );
  console.log('· оверлей QA показан');

  const clickByText = async (needle) => {
    await page.waitForFunction(
      (n) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(n)),
      needle,
      { timeout: 180_000 }
    );
    await page.evaluate((n) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(n));
      b.click();
    }, needle);
  };

  await clickByText('Начать эпизод 1');
  console.log('· эпизод 1 запущен');

  // Автовыбор карты из модалки level-up: на телефоне это делает игрок, здесь —
  // ввода нет, иначе сцена «Game» остаётся на паузе и эпизод не идёт.
  const autoPick = setInterval(async () => {
    try {
      await page.evaluate(() => {
        const gs = window.__game?.scene?.getScene('Game');
        if (!gs || !gs.awaitingChoice || !gs.pendingChoices?.length) return;
        gs.chooseUpgrade(gs.pendingChoices[0].id);
        gs.consumeLegendaryCeremony?.();
        gs.consumeEvolutionCeremony?.();
        const ui = window.__game.scene.getScene('UI');
        ui.hideModal?.();
        gs.scene.resume();
      });
    } catch {
      /* страница занята */
    }
  }, 250);

  // Диагностика: печатаем состояние оверлея и сцены, пока идёт эпизод.
  const diag = setInterval(async () => {
    try {
      const st = await page.evaluate(() => {
        const overlay = document.querySelector('[data-qa-overlay]');
        const gs = window.__game?.scene?.getScene('Game');
        return {
          overlay: overlay ? overlay.innerText.slice(0, 220).replace(/\n/g, ' | ') : '(нет оверлея)',
          stage: gs?.runState?.stage?.id ?? null,
          t: gs ? Math.round(gs.runState?.stage?.timeMs ?? -1) : null,
          hp: gs ? Math.round(gs.runState?.stage?.hp ?? -1) : null,
          alive: gs?.enemies?.countActive(true) ?? null,
          phase: gs?.stageDirector?.phase ?? null,
          boss: Boolean(gs?.wave?.boss),
          awaitingChoice: gs?.awaitingChoice ?? null,
          queuedLevels: gs?.queuedLevels ?? null,
          paused: gs?.scene?.isPaused?.() ?? null,
          modalOpen: gs?.scene?.getScene?.('UI')?.modalOpen ?? null,
        };
      });
      console.log('   diag:', JSON.stringify(st));
    } catch {
      /* страница занята */
    }
  }, 5000);

  const readResults = () =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), STORE_KEY);

  for (let episode = 1; episode <= EPISODES; episode++) {
    await page.waitForFunction(
      ({ n, k }) => {
        const raw = localStorage.getItem(k);
        try {
          return raw && JSON.parse(raw).length >= n;
        } catch {
          return false;
        }
      },
      { n: episode, k: STORE_KEY },
      { timeout: 300_000 }
    );
    const results = await readResults();
    const r = results[episode - 1];
    console.log(`· эпизод ${episode} завершён: ${JSON.stringify(r)}`);
    if (episode < EPISODES) {
      await clickByText('Далее');
      console.log(`· эпизод ${episode + 1} запущен`);
    }
  }

  const all = await readResults();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { meta: { baseUrl: BASE_URL, seed: SEED, qaParam: QA_PARAM, at: new Date().toISOString() }, results: all },
      null,
      2
    )
  );
  clearInterval(diag);
  clearInterval(autoPick);
  console.log(`\n→ ${OUT}`);
  console.log('\nИтог по эпизодам:');
  for (const r of all) console.log(`  эпизод ${r.episode} [${r.arm}]: ${JSON.stringify(r)}`);
  if (errors.length) console.log('\nОшибки страницы:', errors.join(' | '));
  await browser.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
