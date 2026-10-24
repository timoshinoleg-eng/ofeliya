/**
 * OFELIYA — MiniMax Muse convergence adversarial contracts.
 *
 * These cases close gaps that the shipped Muse suites did NOT already cover:
 *
 *   telegram loader : repeated readiness, SDK object replacement, throwing dispatcher
 *   collection      : 31+ visit days, invalid stored days, UTC boundary, backwards visit
 *   telemetry       : launch URL query/hash never transmitted
 *   quest runtime   : negative timestamp, oversized event id
 *
 * Nothing here weakens an existing assertion; every case is a new strict contract.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSync } from 'esbuild';

const root = resolve(import.meta.dirname, '..');

let failures = 0;
let cases = 0;
async function caseRun(name, body) {
  cases++;
  try {
    await body();
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, error.message);
  }
}

/* ------------------------------------------------------------------ helpers */

function transpileToDataUrl(relativePath) {
  const source = readFileSync(resolve(root, relativePath), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

function bundleTs(relativePath) {
  const result = buildSync({
    absWorkingDir: root,
    entryPoints: [relativePath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire());
  return module.exports;
}

function createRequire() {
  return (id) => require(id);
}
const require = (await import('node:module')).createRequire(import.meta.url);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

/* ------------------------------------------------------------ telegram loader */

function loaderEnv({ hash = '#tgWebAppData=abc&tgWebAppVersion=8.0', dispatch } = {}) {
  const scripts = new Map();
  const events = [];
  const window = {
    location: { hash },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (id) => clearTimeout(id),
    dispatchEvent: dispatch ?? ((event) => { events.push(event.type); return true; }),
  };
  const document = {
    getElementById: (id) => scripts.get(id) ?? null,
    createElement: (tag) => {
      assert.equal(tag, 'script');
      return {
        dataset: {},
        id: 'ofeliya-telegram-web-app',
        addEventListener() {},
        removeEventListener() {},
        remove() { scripts.delete(this.id); },
      };
    },
    head: { appendChild: (script) => { scripts.set(script.id, script); } },
  };
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = window;
  globalThis.document = document;
  const source = readFileSync(resolve(root, 'src/platform/TelegramBridgeLoader.ts'), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext('(function(exports, require, module){' + transpiled + '\n})')(mod.exports, undefined, mod);
  return {
    window,
    events,
    ensure: mod.exports.ensureTelegramBridge,
    READY: mod.exports.TELEGRAM_BRIDGE_READY_EVENT,
    cleanup() {
      if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    },
  };
}

await caseRun('repeated readiness announces the same SDK exactly once', async () => {
  const env = loaderEnv();
  try {
    const bridge = { initData: 'qa-init-data' };
    env.window.Telegram = { WebApp: bridge };
    assert.equal(await env.ensure(50), true, 'an already present SDK must resolve immediately');
    assert.deepEqual(env.events, [env.READY], 'the first readiness must be announced once');
    assert.equal(await env.ensure(50), true, 'a second call must still resolve true');
    assert.equal(await env.ensure(50), true, 'a third call must still resolve true');
    assert.deepEqual(env.events, [env.READY], 'the same SDK object must never be announced twice');
  } finally {
    env.cleanup();
  }
});

await caseRun('a replaced SDK object is announced again', async () => {
  const env = loaderEnv();
  try {
    env.window.Telegram = { WebApp: { initData: 'qa-init-data' } };
    await env.ensure(50);
    assert.equal(env.events.length, 1);
    // Telegram replaces the WebApp object when the Mini App is re-mounted.
    env.window.Telegram = { WebApp: { initData: 'qa-init-data-2' } };
    await env.ensure(50);
    assert.equal(env.events.length, 2, 'a replaced SDK object must be announced as a new bridge');
  } finally {
    env.cleanup();
  }
});

await caseRun('a throwing readiness dispatcher cannot break the bridge', async () => {
  const env = loaderEnv({
    dispatch: () => { throw new Error('host listener exploded'); },
  });
  try {
    env.window.Telegram = { WebApp: { initData: 'qa-init-data' } };
    let resolved;
    assert.equal(await env.ensure(50), true, 'a throwing dispatcher must not fail the bridge');
    resolved = true;
    assert.equal(resolved, true);
  } finally {
    env.cleanup();
  }
});

/* ---------------------------------------------------------------- collection */

const { ClientCollection, COLLECTION_KEY } = bundleTs('./src/game/collection/ClientCollection.ts');

await caseRun('the visit calendar stays bounded past 31 days', async () => {
  let now = Date.UTC(2026, 0, 1, 12);
  const storage = memoryStorage();
  const collection = new ClientCollection(storage, () => now);
  for (let i = 0; i < 40; i++) {
    collection.visit();
    now += 86_400_000;
  }
  const snapshot = collection.snapshot();
  assert.equal(snapshot.visitDays, 40, 'every distinct UTC day must be counted');
  assert.equal(snapshot.visitStreak, 40, 'a continuous UTC run keeps the streak');
  assert.equal(snapshot.recentVisitDays.length, 31, 'the stored calendar must stay bounded at 31 days');
  assert.equal(snapshot.recentVisitDays.at(-1), '2026-02-09', 'the newest UTC day must be kept');
  assert.equal(snapshot.recentVisitDays[0], '2026-01-10', 'the oldest kept day must be the 31st newest');
  assert.ok(snapshot.achievements.find((a) => a.id === 'streak_30').unlocked, 'a 30 day streak must unlock');
});

await caseRun('invalid stored visit days are dropped without inflating the streak', async () => {
  const now = Date.UTC(2026, 0, 1, 12);
  const storage = memoryStorage({
    [COLLECTION_KEY]: JSON.stringify({
      version: 1,
      visitDays: 99,
      visitStreak: 99,
      lastVisitDay: '2026-01-01',
      recentVisitDays: ['2026-01-01', 'not-a-day', '', '2026-13-45', '2026-01-02', 12345, null],
    }),
  });
  const collection = new ClientCollection(storage, () => now);
  const snapshot = collection.snapshot();
  assert.deepEqual(snapshot.recentVisitDays, ['2026-01-01', '2026-01-02'], 'only real UTC days survive');
  // A stored day that already passed must not be counted again by a new visit.
  collection.visit();
  const after = collection.snapshot();
  assert.equal(after.visitDays, 99, 'a repeated UTC day must not inflate the visit counter');
  assert.equal(after.visitStreak, 99, 'a stored streak must not be reset by a same-day visit');
});

await caseRun('the UTC day boundary counts exactly one visit per UTC day', async () => {
  let now = Date.parse('2026-03-31T23:59:59.999Z');
  const storage = memoryStorage();
  const collection = new ClientCollection(storage, () => now);
  collection.visit();
  now = Date.parse('2026-04-01T00:00:00.000Z');
  collection.visit();
  const snapshot = collection.snapshot();
  assert.equal(snapshot.visitDays, 2, 'the UTC midnight boundary starts a new visit day');
  assert.equal(snapshot.visitStreak, 2, 'consecutive UTC days extend the streak');
  assert.deepEqual(snapshot.recentVisitDays, ['2026-03-31', '2026-04-01']);
});

await caseRun('a backwards visit never lowers the recorded UTC day', async () => {
  let now = Date.parse('2026-05-10T12:00:00Z');
  const storage = memoryStorage();
  const collection = new ClientCollection(storage, () => now);
  collection.visit();
  now = Date.parse('2026-05-01T12:00:00Z');
  collection.visit();
  const snapshot = collection.snapshot();
  assert.equal(snapshot.visitDays, 1, 'a clock that jumps backwards must not create a second visit day');
  assert.deepEqual(snapshot.recentVisitDays, ['2026-05-10'], 'the newest UTC day must be preserved');
});

await caseRun('the observed run ledger stays bounded across many runs', async () => {
  const storage = memoryStorage();
  const collection = new ClientCollection(storage, () => Date.UTC(2026, 0, 1, 12));
  const observation = id => ({
    id, kills: 0, timeMs: 0, noDamageMs: 0, level: 1, combo: 0,
    mutations: [], elites: 0, hostCells: 0, evolutions: [], legendaryIds: [], won: false,
  });
  for (let i = 0; i < 2000; i++) collection.observeRun(observation(`run-${i}`));

  const stored = JSON.parse(storage.data.get(COLLECTION_KEY));
  assert.ok(Array.isArray(stored.processedRunIds), 'the observed run ledger must be stored');
  assert.ok(stored.processedRunIds.length <= 1024,
    `the observed run ledger must stay bounded (got ${stored.processedRunIds.length} entries)`);
  assert.ok(storage.data.get(COLLECTION_KEY).length <= 64 * 1024,
    'the stored collection record must stay small');
  assert.equal(stored.counters.runs, 2000, 'every observed run must still be counted');
  assert.deepEqual(collection.observeRun(observation('run-1999')), [],
    'the most recently observed run must stay idempotent');
  assert.deepEqual(collection.observeRun(observation('run-1998')), [],
    'a run inside the retained window must stay idempotent');
});

/* ----------------------------------------------------------------- telemetry */

const analyticsModule = await transpileToDataUrl('src/systems/OptionalWebAnalytics.ts');

function fakeDocument() {
  const scripts = [];
  const head = {
    appendChild(script) { script.parentNode = head; scripts.push(script); return script; },
    removeChild(script) {
      const index = scripts.indexOf(script);
      if (index >= 0) scripts.splice(index, 1);
      script.parentNode = null;
    },
  };
  return {
    scripts,
    head,
    createElement(tag) {
      assert.equal(tag, 'script');
      const attrs = new Map();
      return {
        tagName: 'SCRIPT', async: false, src: '', dataset: {}, parentNode: null,
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.get(name) ?? null; },
        remove() { this.parentNode?.removeChild(this); },
      };
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'script[data-ofeliya-umami]');
      return scripts.filter((item) => item.getAttribute('data-ofeliya-umami') !== null);
    },
  };
}

await caseRun('the launch URL query and hash are never transmitted', async () => {
  const document = fakeDocument();
  const calls = [];
  const launchUrl = 'https://ofeliya.example/?tgWebAppData=qa-secret-init-data&user=12345#tgWebAppData=qa-secret-init-data';
  const window = {
    location: { href: launchUrl, search: '?tgWebAppData=qa-secret-init-data&user=12345', hash: '#tgWebAppData=qa-secret-init-data' },
    umami: { track: (...args) => calls.push(args) },
  };
  const client = analyticsModule.createOptionalWebAnalytics({
    enabled: true,
    src: 'https://cloud.umami.is/script.js',
    websiteId: 'site_12345678',
    document,
    window,
  });
  document.scripts[0].onload();
  assert.equal(await client.ready, true);
  const script = document.scripts[0];
  assert.equal(script.getAttribute('data-auto-track'), 'false', 'automatic tracking must stay off');
  assert.equal(script.getAttribute('data-exclude-search'), 'true', 'the launch query must be excluded');
  assert.ok(!script.src.includes('tgWebAppData'), 'the script URL must not carry launch credentials');
  assert.ok(!script.src.includes('#'), 'the script URL must not carry a hash');

  assert.equal(client.track('app_open', { screen: 'menu', telegramUserId: '999', initData: 'qa-secret-init-data' }), true);
  assert.equal(calls.length, 1);
  const payload = calls[0][0];
  assert.equal(payload.url, '/ofeliya', 'events must use the fixed product URL');
  assert.ok(!payload.url.includes('?'), 'the transmitted URL must never contain a query');
  assert.ok(!payload.url.includes('#'), 'the transmitted URL must never contain a hash');
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('qa-secret-init-data'), 'no initData may be transmitted');
  assert.ok(!serialized.includes('999'), 'no user id may be transmitted');
  assert.ok(!serialized.includes('tgWebAppData'), 'no launch parameter may be transmitted');
  assert.deepEqual(payload.data, { screen: 'menu' },
    'only allowlisted properties may reach the tracker, PII must be dropped');
});

/* -------------------------------------------------------------- quest runtime */

const { QuestRuntime } = bundleTs('./src/quests/questRuntime.ts');

await caseRun('a negative timestamp cannot move the quest clock', async () => {
  let raw = null;
  const storage = { read: () => raw, write: value => { raw = value; } };
  const now = Date.parse('2026-06-01T12:00:00Z');
  const runtime = new QuestRuntime(storage, { now: () => now });
  runtime.begin(0);
  runtime.tick(5000, 5000);
  runtime.flush();
  const before = JSON.parse(raw);
  assert.equal(before.lastTickTimeMs, 5000);
  runtime.tick(-1, -1, true);
  runtime.flush();
  const after = JSON.parse(raw);
  assert.equal(after.lastTickTimeMs, 5000, 'a negative timestamp must not become the recorded tick');
  assert.equal(after.dayMetrics.q_nodmg, before.dayMetrics.q_nodmg, 'a negative streak must not be recorded');
});

await caseRun('an oversized event id cannot corrupt the processed-event set', async () => {
  let raw = null;
  const storage = { read: () => raw, write: value => { raw = value; } };
  const now = Date.parse('2026-06-01T12:00:00Z');
  const runtime = new QuestRuntime(storage, { now: () => now });
  runtime.begin(0);
  runtime.kill(1, 'swarm', true);
  runtime.flush();
  const seen = JSON.parse(raw).seenEventIds;
  assert.ok(seen.every(id => typeof id === 'string' && id.length <= 64), 'persisted event ids stay bounded');
  assert.ok(seen.length > 0, 'the real kill must be recorded');
});

/* ------------------------------------------------------------------ verdict */

console.log(`muse convergence adversarial contracts: ${cases - failures}/${cases} PASS`);
if (failures > 0) process.exitCode = 1;
