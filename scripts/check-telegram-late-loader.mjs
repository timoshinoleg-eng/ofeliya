import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Independent regression: real script timing behavior, not a pre-installed SDK stub.
const source = readFileSync(resolve('src/platform/TelegramBridgeLoader.ts'), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup() {
  const scripts = new Map();
  const events = [];
  const scriptFactory = () => {
    const callbacks = new Map();
    return {
      dataset: {},
      addEventListener(type, cb, options) {
        if (!callbacks.has(type)) callbacks.set(type, []);
        callbacks.get(type).push({ cb, once: options?.once });
      },
      removeEventListener(type, cb) {
        callbacks.set(type, (callbacks.get(type) ?? []).filter(entry => entry.cb !== cb));
      },
      emit(type) {
        for (const entry of [...(callbacks.get(type) ?? [])]) {
          if (entry.once) this.removeEventListener(type, entry.cb);
          entry.cb({ type });
        }
      },
      listenerCount: () => [...callbacks.values()].reduce((n, list) => n + list.length, 0),
      remove() { scripts.delete(this.id); },
    };
  };
  const window = {
    location: { hash: '#tgWebAppData=abc&tgWebAppVersion=8.0' },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (id) => clearTimeout(id),
    dispatchEvent: (event) => { events.push(event.type); return true; },
  };
  const document = {
    getElementById: (id) => scripts.get(id) ?? null,
    createElement: (tag) => {
      assert.equal(tag, 'script');
      return scriptFactory();
    },
    head: { appendChild: (script) => { scripts.set(script.id, script); } },
  };
  globalThis.window = window;
  globalThis.document = document;
  const mod = { exports: {} };
  vm.runInThisContext('(function(exports, require, module){' + transpiled + '\n})')(mod.exports, undefined, mod);
  return {
    window, document, events, ensure: mod.exports.ensureTelegramBridge,
    script: () => scripts.get('ofeliya-telegram-web-app') ?? null,
    scriptCount: () => scripts.size,
    cleanup: () => { delete globalThis.window; delete globalThis.document; },
  };
}

let failures = 0;
let cases = 0;
async function caseRun(name, body) {
  cases++;
  const env = setup();
  try {
    await body(env);
    console.log('PASS', name);
  } catch (error) {
    failures++;
    console.error('FAIL', name, error.message);
  } finally {
    env.cleanup();
  }
}

await caseRun('late script load after initial timeout announces Telegram readiness', async (env) => {
  const first = env.ensure(8);
  const firstReady = await first;
  assert.equal(firstReady, false);
  assert.ok(env.script(), 'script must remain attached while an in-flight load may succeed');
  env.window.Telegram = { WebApp: { initData: 'signed-user-data' } };
  env.script().emit('load');
  assert.equal(env.events.filter((x) => x === 'ofeliya:telegram-bridge-ready').length, 1,
    'the post-timeout load must notify facade instead of leaving game in browser mode');
});

await caseRun('failed script request can retry without reloading the Mini App', async (env) => {
  const pending = env.ensure(70);
  const first = env.script();
  assert.ok(first, 'first script should be appended');
  first.emit('error');
  assert.equal(await pending, false);
  const retry = env.ensure(70);
  const second = env.script();
  if (!second || second === first) {
    await retry; // settle the pending timeout before tearing down the mock DOM
    assert.fail('a failed SDK request must create another script tag, not wait on a dead one');
  }
  env.window.Telegram = { WebApp: { initData: 'signed-user-data' } };
  second.emit('load');
  assert.equal(await retry, true);
  assert.equal(env.events.filter((x) => x === 'ofeliya:telegram-bridge-ready').length, 1);
});

await caseRun('concurrent callers retain separate deadlines but announce one late SDK load', async (env) => {
  const early = env.ensure(8);
  const late = env.ensure(25);
  const script = env.script();
  assert.deepEqual(await Promise.all([early, late]), [false, false]);
  assert.equal(env.scriptCount(), 1, 'concurrent callers share one script');
  env.window.Telegram = { WebApp: { initData: 'signed-user-data' } };
  script.emit('load');
  assert.equal(env.events.length, 1, 'one successful late SDK load emits one ready event');
  assert.equal(script.listenerCount(), 0, 'both load and error handlers are released');
  assert.equal(await env.ensure(8), true);
  assert.equal(await env.ensure(25), true);
  assert.equal(env.events.length, 1, 'probing the same SDK must not announce again');
  env.window.Telegram.WebApp = { initData: 'replacement-sdk' };
  assert.equal(await env.ensure(8), true);
  assert.equal(env.events.length, 2, 'a replacement SDK can announce its own readiness');
});

await caseRun('one caller times out while another still observes a successful load', async (env) => {
  const early = env.ensure(8), late = env.ensure(70);
  assert.equal(await early, false);
  env.window.Telegram = { WebApp: { initData: 'signed-user-data' } };
  env.script().emit('load');
  assert.equal(await late, true);
  assert.equal(env.events.length, 1);
  assert.equal(env.script().listenerCount(), 0);
});

await caseRun('concurrent network failure cleans handlers and retry remains single flight', async (env) => {
  const a = env.ensure(70), b = env.ensure(90), failed = env.script();
  failed.emit('error');
  assert.deepEqual(await Promise.all([a, b]), [false, false]);
  assert.equal(failed.listenerCount(), 0);
  assert.equal(env.scriptCount(), 0);
  assert.equal(env.events.length, 0);
  const c = env.ensure(70), d = env.ensure(90), retry = env.script();
  assert.notEqual(retry, failed);
  env.window.Telegram = { WebApp: { initData: 'retry-sdk' } };
  failed.emit('load');
  assert.equal(env.events.length, 0, 'a failed request cannot announce after retry');
  retry.emit('load');
  assert.deepEqual(await Promise.all([c, d]), [true, true]);
  assert.equal(env.events.length, 1);
  assert.equal(retry.listenerCount(), 0);
});

await caseRun('browser and MAX without Telegram launch data never request Telegram SDK', async (env) => {
  env.window.location.hash = '';
  env.window.WebApp = { initData: 'max-init' };
  assert.equal(await env.ensure(8), false);
  assert.equal(env.scriptCount(), 0);
  assert.equal(env.events.length, 0);
});

if (failures) {
  console.error('telegram late loader regressions:', failures, 'failed');
  process.exitCode = 1;
} else {
  console.log(`telegram late loader regressions: ${cases}/${cases} PASS`);
}
