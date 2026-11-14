/**
 * Прогон телефонного QA-модуля «КАРДИАЛЬНЫЙ ТИТАН» (пара без карты / кандидат).
 *
 * Тот же код, что пойдёт на телефон: ?qa=titan-candidate → два эпизода с одинаковым
 * стартом. Здесь игрок не играет (без ввода), поэтому эпизод заканчивается смертью
 * от босса или таймаутом — это и есть проверка, что модуль доводит эпизод до конца
 * и пишет итог.
 *
 * Запуск:
 *   # dev-сервер QA-копии игры:
 *   cd /workspace/ofeliya-exp3 && VITE_QA_TOOLS=1 npx vite --port 5177 --host 127.0.0.1
 *   NODE_PATH=/workspace/ofeliya/node_modules \
 *   OFELIYA_BASE_URL=http://127.0.0.1:5177/ \
 *   node probe/phone-titan-smoke.cjs
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5177/';
const SEED = process.env.SEED || 'titan-candidate-1';
/** FAST=1 — перехваченные часы (нужно для headless-проверки: ~1 fps). */
const FAST = process.env.FAST === '1' ? '&fast=1' : '';
const OUT = path.join(require('os').tmpdir(), 'ofeliya-titan-integrated.json');

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    localStorage.removeItem('ofeliya_qa_titan_candidate_v1');
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-titan-candidate',
      initDataUnsafe: { user: { id: 42, first_name: 'Titan', last_name: 'QA' } },
      getViewportSize: async () => ({ width: 390, height: 844 }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) console.log('  NAV:', f.url());
  });
  page.on('load', () => console.log('  LOAD'));
  page.on('crash', () => console.log('  PAGE CRASH'));

  await page.goto(`${BASE_URL}?qa=titan-candidate&seed=${SEED}${FAST}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some((b) =>
        b.textContent.includes('Начать эпизод 1')
      ),
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

  const readResults = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('ofeliya_qa_titan_candidate_v1') || '[]'));

  await clickByText('Начать эпизод 1');
  console.log('· эпизод 1 запущен');

  const diag = setInterval(async () => {
    try {
      const st = await page.evaluate(() => {
        const overlay = document.querySelector('[data-qa-overlay]');
        const gs = window.__game?.scene?.getScene('Game');
        return {
          overlay: overlay ? overlay.innerText.slice(0, 150).replace(/\n/g, ' | ') : '(нет)',
          stage: gs?.runState?.stage?.id ?? null,
          t: gs ? Math.round(gs.runState?.stage?.timeMs ?? -1) : null,
          hp: gs ? Math.round(gs.runState?.stage?.hp ?? -1) : null,
          bossHp: gs?.wave?.boss ? Math.round(gs.wave.boss.hp) : null,
        };
      });
      console.log('   diag:', JSON.stringify(st));
    } catch {
      /* страница занята */
    }
  }, 6000);

  for (let episode = 1; episode <= 4; episode++) {
    await page.waitForFunction(
      (n) => {
        const raw = localStorage.getItem('ofeliya_qa_titan_candidate_v1');
        try {
          return raw && JSON.parse(raw).length >= n;
        } catch {
          return false;
        }
      },
      episode,
      { timeout: 300_000 }
    );
    const results = await readResults();
    const r = results[episode - 1];
    console.log(`· эпизод ${episode} завершён: ${JSON.stringify(r)}`);
    if (episode < 4) {
      await clickByText('Перейти');
      console.log(`· эпизод ${episode + 1} запущен`);
    }
  }

  const all = await readResults();
  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ meta: { baseUrl: BASE_URL, seed: SEED, at: new Date().toISOString() }, results: all }, null, 2)
  );
  console.log(`\n→ ${OUT}`);
  console.log('\nИтог пары (без карты → кандидат):');
  for (const r of all) {
    console.log(
      `  эпизод ${r.episode} [${r.arm}]: исход ${r.outcome}, убито ${r.kills}, урон ${r.damageDealt}, ` +
        `потери ${r.damageTaken}, продержался ${(r.survivedMs / 1000).toFixed(1)} с, ` +
        `титан HP ${r.bossHpLeft}/${r.bossMaxHp} (фаза ${r.bossPhase})`
    );
  }
  clearInterval(diag);
  await browser.close();
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
