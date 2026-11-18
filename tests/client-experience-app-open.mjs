/**
 * client-experience-app-open — P2-7: дедупликация app_open в Umami.
 *
 * Compiles the TS modules with tsc like the other node-side contract tests.
 *
 * Race: при медленном MAX-мосте Umami может стать ready раньше, чем мост
 * ответит (initData). Старый flush слал fallback app_open сразу, а затем
 * installAppOpenTracking (main.ts: tryTrack на 350/1200 мс или событие
 * ofeliya:max-bridge-ready) слал настоящий — дубль в воронке Umami.
 *
 * Covers:
 * - браузер (настоящего app_open нет): fallback уходит ровно один раз;
 * - медленный мост (настоящий app_open приходит после flush, но до
 *   истечения окна моста): уходит только настоящий, fallback отменён;
 * - очень медленный мост (настоящий приходит после fallback): второй
 *   app_open не уходит — открытие уже посчитано (серверный /api/event
 *   при этом не затронут: он идёт отдельным путём в AnalyticsClient);
 * - настоящий app_open в буфере до готовности Umami: реплей, без fallback;
 * - Umami выключен: app_open вообще не уходит.
 *
 * Fake document — тот же паттерн, что в scripts/check-muse-telemetry.mjs.
 * Задержка fallback инжектится через appOpenFallbackDelayMs (15 мс),
 * чтобы тест не ждал боевые 1200 мс.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-app-open-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`client-experience-app-open: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeDocument() {
  const scripts = [];
  const head = {
    appendChild(script) {
      script.parentNode = head;
      scripts.push(script);
      return script;
    },
    removeChild(script) {
      const index = scripts.indexOf(script);
      if (index >= 0) scripts.splice(index, 1);
      script.parentNode = null;
      return script;
    },
  };
  return {
    scripts,
    head,
    createElement(tag) {
      assert(tag === 'script', 'only script elements are created');
      const attrs = new Map();
      return {
        tagName: 'SCRIPT',
        async: false,
        src: '',
        dataset: {},
        parentNode: null,
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.get(name) ?? null; },
        remove() { this.parentNode?.removeChild(this); },
      };
    },
    querySelectorAll(selector) {
      assert(selector === 'script[data-ofeliya-umami]', 'unexpected selector');
      return scripts.filter((item) => item.getAttribute('data-ofeliya-umami') !== null);
    },
  };
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/ClientExperience.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'pipe' }
  );

  const { configureClientExperience, trackClientEvent } = require(
    join(temp, 'systems/ClientExperience.js')
  );

  const UMAMI = {
    src: 'https://cloud.umami.is/script.js',
    websiteId: 'site_12345678',
  };
  // Один сценарий: свежие document/window (loadScript дедуплицирует по
  // документу), свежий configure. Возвращает {calls, fireReady}.
  const scenario = (options = {}) => {
    const calls = [];
    const document = fakeDocument();
    globalThis.document = document;
    globalThis.window = { umami: { track: (...args) => calls.push(args) } };
    configureClientExperience({
      qaTools: false,
      search: '',
      analyticsEnabled: true,
      src: UMAMI.src,
      websiteId: UMAMI.websiteId,
      appOpenFallbackDelayMs: 15,
      ...options,
    });
    const appOpens = () => calls.filter(([p]) => p.name === 'app_open');
    const pageviews = () => calls.filter(([p]) => p.name === undefined);
    return {
      calls,
      appOpens,
      pageviews,
      fireReady: async () => {
        eq(document.scripts.length, 1, 'umami script appended');
        document.scripts[0].onload();
        await sleep(0); // дать ready.then-флашу выполниться
      },
    };
  };

  // --- 1. Браузер: настоящего app_open нет — fallback ровно один ---
  {
    const s = scenario();
    await s.fireReady();
    await sleep(60);
    eq(s.pageviews().length, 1, 'browser: exactly one manual pageview');
    eq(s.pageviews()[0][0].url, '/ofeliya', 'pageview uses fixed URL without Telegram initData');
    eq(Object.keys(s.pageviews()[0][0]).sort().join(','), 'title,url,website', 'pageview only sends safe fields');
    eq(s.appOpens().length, 1, 'browser: exactly one fallback app_open');
    eq(s.appOpens()[0][0].data.screen, 'menu', 'fallback carries screen=menu');
  }

  // --- 2. Медленный мост: настоящий app_open после flush — только он ---
  {
    const s = scenario();
    await s.fireReady();
    // Мост ответил после готовности Umami, но до истечения окна моста:
    // настоящий app_open (от installAppOpenTracking) приходит сейчас.
    trackClientEvent('app_open', { screen: 'game' });
    await sleep(60);
    eq(s.appOpens().length, 1, 'slow bridge: exactly one app_open, no fallback duplicate');
    eq(s.appOpens()[0][0].data.screen, 'game', 'slow bridge: the real app_open wins');
  }

  // --- 3. Очень медленный мост: настоящий приходит после fallback ---
  {
    const s = scenario();
    await s.fireReady();
    await sleep(60); // fallback уже ушёл
    eq(s.appOpens().length, 1, 'very slow bridge: fallback sent');
    trackClientEvent('app_open', { screen: 'game' });
    await sleep(10);
    eq(s.appOpens().length, 1, 'very slow bridge: late real app_open suppressed');
    eq(s.appOpens()[0][0].data.screen, 'menu', 'very slow bridge: fallback counted the open');
  }

  // --- 4. Настоящий app_open в буфере до готовности — реплей, без fallback ---
  {
    const s = scenario();
    trackClientEvent('app_open', { screen: 'game' });
    await s.fireReady();
    await sleep(60);
    eq(s.appOpens().length, 1, 'buffered: exactly one app_open');
    eq(s.appOpens()[0][0].data.screen, 'game', 'buffered: the real app_open is replayed');
  }

  // --- 5. Umami выключен — app_open не уходит вообще ---
  {
    const calls = [];
    globalThis.document = fakeDocument();
    globalThis.window = { umami: { track: (...args) => calls.push(args) } };
    configureClientExperience({
      qaTools: false, search: '', analyticsEnabled: false,
      src: UMAMI.src, websiteId: UMAMI.websiteId, appOpenFallbackDelayMs: 15,
    });
    trackClientEvent('app_open', { screen: 'game' });
    await sleep(60);
    eq(calls.length, 0, 'disabled analytics: no events sent');
  }

  // --- 6. CR-R3-12: буфер полон (48 событий) — app_open выброшен,
  // но seen не ставится, и fallback при готовности шлёт opening event ---
  {
    const s = scenario();
    for (let i = 0; i < 48; i++) trackClientEvent('store_viewed', { screen: 'menu' });
    trackClientEvent('app_open', { screen: 'game' });
    await s.fireReady();
    await sleep(60);
    eq(s.appOpens().length, 1, 'full buffer: dropped app_open is replaced by fallback');
    eq(s.appOpens()[0][0].data.screen, 'menu', 'full buffer: fallback carries screen=menu');
  }

  console.log('client-experience-app-open: all assertions passed');
} finally {
  delete globalThis.document;
  delete globalThis.window;
  rmSync(temp, { recursive: true, force: true });
}
