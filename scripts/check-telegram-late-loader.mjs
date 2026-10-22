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
      addEventListener(type, cb) {
        if (!callbacks.has(type)) callbacks.set(type, []);
        callbacks.get(type).push(cb);
      },
      emit(type) {
        for (const cb of callbacks.get(type) ?? []) cb({ type });
      },
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
    cleanup: () => { delete globalThis.window; delete globalThis.document; },
  };
}

let failures = 0;
async function caseRun(name, body) {
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

if (failures) {
  console.error('telegram late loader regressions:', failures, 'failed');
  process.exitCode = 1;
} else {
  console.log('telegram late loader regressions: 2/2 PASS');
}
