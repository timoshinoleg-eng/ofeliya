import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const platformDir = resolve('src/platform');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const source = readFileSync(file, 'utf8').replaceAll(/import\.meta\.env\.[A-Z0-9_]+/g, 'undefined');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const localRequire = (id) => {
    if (id === 'phaser') return {};
    assert.ok(id.startsWith('.'), `unexpected module import ${id}`);
    const base = resolve(dirname(file), id);
    const target = existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts');
    return load(target);
  };
  const factory = vm.runInThisContext(`(function(exports,require,module,__filename,__dirname){${js}\n})`, { filename: file });
  factory(mod.exports, localRequire, mod, file, dirname(file));
  return mod.exports;
}

function fakeHost(version = '8.0', overrides = {}) {
  const callbacks = new Map();
  const calls = { enabled: 0, disabled: 0, subscribed: [], detached: [] };
  const webApp = {
    initData: 'synthetic', version,
    safeAreaInset: { top: 47, right: 0, bottom: 34, left: 0 },
    contentSafeAreaInset: { top: 60, right: 0, bottom: 20, left: 0 },
    onEvent(type, callback) {
      calls.subscribed.push(type);
      const set = callbacks.get(type) ?? new Set(); set.add(callback); callbacks.set(type, set);
    },
    offEvent(type, callback) { calls.detached.push(type); callbacks.get(type)?.delete(callback); },
    enableClosingConfirmation() { calls.enabled++; },
    disableClosingConfirmation() { calls.disabled++; },
    ...overrides,
  };
  return {
    webApp, calls,
    emit(type, event) { for (const callback of [...(callbacks.get(type) ?? [])]) callback(event); },
    count(type) { return callbacks.get(type)?.size ?? 0; },
  };
}

const docListeners = new Map();
globalThis.document = {
  visibilityState: 'visible',
  addEventListener(type, callback) { const set = docListeners.get(type) ?? new Set(); set.add(callback); docListeners.set(type, set); },
  removeEventListener(type, callback) { docListeners.get(type)?.delete(callback); },
};
const previousWindow = globalThis.window;

try {
  const { TelegramPlatform } = load(join(platformDir, 'TelegramPlatform.ts'));
  const supported = fakeHost('8.0'); globalThis.window = { Telegram: { WebApp: supported.webApp } };
  const telegram = new TelegramPlatform();
  assert.deepEqual(telegram.getSafeAreaInsets(), { top: 60, right: 0, bottom: 34, left: 0 }, 'safe/content insets merge by max per side');
  let invalidations = 0;
  const detach = telegram.subscribeViewportChange(() => invalidations++);
  assert.equal(supported.count('viewportChanged'), 1);
  assert.equal(supported.count('safeAreaChanged'), 1);
  assert.equal(supported.count('contentSafeAreaChanged'), 1);
  supported.emit('viewportChanged', { isStateStable: false });
  assert.equal(invalidations, 0, 'unstable viewport events remain ignored');
  supported.emit('viewportChanged', { isStateStable: true });
  assert.equal(invalidations, 1, 'stable viewport event remains delivered');
  supported.emit('safeAreaChanged'); supported.emit('contentSafeAreaChanged');
  assert.equal(invalidations, 3, 'both Telegram inset events reuse the viewport subscriber');
  detach(); assert.equal(supported.count('safeAreaChanged'), 0); assert.equal(supported.count('contentSafeAreaChanged'), 0);
  assert.equal(supported.count('viewportChanged'), 0);
  const detachThrowing = telegram.subscribeViewportChange(() => { throw Error('consumer failure'); });
  assert.doesNotThrow(() => supported.emit('safeAreaChanged'), 'safe-area callback failure cannot escape into host event bus');
  detachThrowing();

  const malformed = fakeHost('8.0', {
    safeAreaInset: { top: NaN, right: 0, bottom: 0, left: 0 },
    contentSafeAreaInset: { top: 0, right: -1, bottom: 0, left: 0 },
  });
  globalThis.window = { Telegram: { WebApp: malformed.webApp } };
  assert.equal(new TelegramPlatform().getSafeAreaInsets(), null, 'malformed inset records are rejected');
  const nativeVersion = fakeHost('7.0', { isVersionAtLeast: (version) => version === '8.0' });
  globalThis.window = { Telegram: { WebApp: nativeVersion.webApp } };
  assert.equal(new TelegramPlatform().isVersionAtLeast('8.0'), true, 'native version helper is authoritative');

  const old = fakeHost('7.10'); globalThis.window = { Telegram: { WebApp: old.webApp } };
  const oldTelegram = new TelegramPlatform();
  assert.equal(oldTelegram.getSafeAreaInsets(), null, 'safe-area API is version gated');
  oldTelegram.subscribeViewportChange(() => {});
  assert.equal(old.count('safeAreaChanged'), 0, 'old clients do not subscribe to 8.0 events');

  const { mergeSafeAreaInsets } = load(join(platformDir, 'ViewportManager.ts'));
  assert.deepEqual(mergeSafeAreaInsets(
    { top: 10, right: 0, bottom: 20, left: 0 },
    { top: 47, right: 0, bottom: 34, left: 0 }
  ), { top: 47, right: 0, bottom: 34, left: 0 }, 'host insets replace overlaps by side max');
  assert.deepEqual(mergeSafeAreaInsets(
    { top: 50, right: 0, bottom: 20, left: 0 },
    { top: 47, right: 0, bottom: 34, left: 0 }
  ), { top: 50, right: 0, bottom: 34, left: 0 }, 'larger CSS edge is preserved');

  const { TelegramLifecycle } = load(join(platformDir, 'TelegramLifecycle.ts'));
  const lifecycleHost = fakeHost('8.0'); globalThis.window = { Telegram: { WebApp: lifecycleHost.webApp } };
  const visibilityListenersBefore = docListeners.get('visibilitychange')?.size ?? 0;
  const activatedBefore = lifecycleHost.count('activated');
  const deactivatedBefore = lifecycleHost.count('deactivated');
  let active = true, paused = false, serial = 0, owner = null, resumes = 0;
  const hooks = {
    isGameActive: () => active,
    isPaused: () => paused,
    pause: () => { paused = true; owner = `telegram-${++serial}`; return owner; },
    isPauseOwned: (token) => paused && owner === token,
    resume: (token) => { assert.equal(owner, token); paused = false; owner = null; resumes++; },
  };
  const lifecycle = new TelegramLifecycle(lifecycleHost.webApp, document, hooks);
  lifecycle.start();
  assert.equal(lifecycleHost.calls.enabled, 1, '6.2+ active run enables close confirmation');
  lifecycleHost.emit('deactivated'); assert.equal(paused, true);
  lifecycleHost.emit('activated'); assert.equal(paused, false); assert.equal(resumes, 1);
  document.visibilityState = 'hidden';
  lifecycleHost.emit('deactivated'); lifecycleHost.emit('activated');
  assert.equal(paused, true, 'activated event cannot resume while document is still hidden');
  document.visibilityState = 'visible';
  for (const callback of [...(docListeners.get('visibilitychange') ?? [])]) callback();
  assert.equal(paused, false, 'visible state releases the owned pause');
  lifecycleHost.emit('deactivated'); owner = 'manual-pause';
  lifecycleHost.emit('activated'); assert.equal(paused, true, 'manual pause ownership is preserved');
  paused = false; owner = null;
  document.visibilityState = 'hidden';
  for (const callback of [...(docListeners.get('visibilitychange') ?? [])]) callback();
  assert.equal(paused, true, 'hidden document pauses running game');
  document.visibilityState = 'visible';
  for (const callback of [...(docListeners.get('visibilitychange') ?? [])]) callback();
  assert.equal(paused, false, 'visible document resumes owned pause');
  lifecycle.destroy(); lifecycle.destroy();
  assert.equal(lifecycleHost.calls.disabled, 1, 'destroy symmetrically disables close confirmation');
  assert.equal(lifecycleHost.count('activated'), activatedBefore);
  assert.equal(lifecycleHost.count('deactivated'), deactivatedBefore);
  assert.equal(docListeners.get('visibilitychange')?.size ?? 0, visibilityListenersBefore);

  const unsupported = fakeHost('6.1'); globalThis.window = { Telegram: { WebApp: unsupported.webApp } };
  active = true; paused = false; owner = null;
  const oldLifecycle = new TelegramLifecycle(unsupported.webApp, document, hooks);
  oldLifecycle.start();
  assert.equal(unsupported.calls.enabled, 0, 'close confirmation is version gated');
  assert.equal(unsupported.count('activated'), 0, 'lifecycle events are version gated');
  oldLifecycle.destroy();

  console.log('Muse Telegram extension: safe-area merge, invalidation, lifecycle ownership and cleanup PASS');
} finally {
  if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  delete globalThis.document;
}
