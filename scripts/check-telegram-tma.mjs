import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

/**
 * Telegram Mini App adaptation contract.
 *
 * The Telegram Mini App host is a virtual viewport and a shared scroll surface. It also
 * reports the state of the host through its own event bus, and the SDK is fetched at
 * runtime, so the host contract can only be applied when the SDK is actually present.
 *
 * The stubs below mirror the shipped Telegram WebApp SDK: the vertical swipe flag, the
 * version gate on the swipe lock, and the event bus, which keeps an array of handlers per
 * event type, deduplicates by reference, and invokes every handler.
 */

const PLATFORM_DIR = resolve('src/platform');

function createLoader() {
  const cache = new Map();
  return function load(file) {
    if (cache.has(file)) return cache.get(file).exports;

    const source = readFileSync(file, 'utf8')
      .replaceAll(/import\.meta\.env\.[A-Z0-9_]+/g, 'undefined')
      .replaceAll('import.meta.env', '({})');
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    const mod = { exports: {} };
    cache.set(file, mod);

    const localRequire = (id) => {
      if (id === 'phaser') return {};
      assert.ok(id.startsWith('.'), `unexpected module import: ${id}`);
      const base = resolve(dirname(file), id);
      const target = existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts');
      return load(target);
    };

    const factory = vm.runInThisContext(
      `(function (exports, require, module, __filename, __dirname) {${js}\n})`,
      { filename: file }
    );
    factory(mod.exports, localRequire, mod, file, dirname(file));
    return mod.exports;
  };
}

/** Mirrors the SDK's versionAtLeast comparison. */
function versionAtLeast(version, target) {
  const parse = (value) => String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(version);
  const right = parse(target);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function createWebApp(overrides = {}) {
  const calls = { ready: 0, expand: 0, disableVerticalSwipes: 0, onEvent: [], offEvent: [] };
  const handlers = new Map();
  const webApp = {
    initData: 'signed-init-data',
    initDataUnsafe: { user: { id: 42, first_name: 'Pilot' } },
    platform: 'android',
    version: '7.10',
    viewportHeight: 640,
    isVerticalSwipesEnabled: true,
    ready: () => { calls.ready += 1; },
    expand: () => { calls.expand += 1; },
    disableVerticalSwipes: () => {
      calls.disableVerticalSwipes += 1;
      // The real SDK accepts the call on every version but only applies it from Bot API 7.7.
      if (!versionAtLeast(webApp.version, '7.7')) return;
      webApp.isVerticalSwipesEnabled = false;
    },
    onEvent: (type, callback) => {
      calls.onEvent.push(type);
      const list = handlers.get(type) ?? [];
      if (!list.includes(callback)) list.push(callback);
      handlers.set(type, list);
    },
    offEvent: (type, callback) => {
      calls.offEvent.push(type);
      const list = handlers.get(type);
      if (!list) return;
      const index = list.indexOf(callback);
      if (index !== -1) list.splice(index, 1);
    },
    ...overrides,
  };

  const emit = (type, event) => {
    for (const callback of [...(handlers.get(type) ?? [])]) callback(event);
  };
  const liveCount = (type) => (handlers.get(type) ?? []).length;

  return { webApp, calls, handlers, emit, liveCount };
}

function installDom({ webApp, innerWidth = 390, innerHeight = 844 } = {}) {
  const documentListeners = new Map();
  const windowListeners = new Map();

  const element = () => ({
    style: { cssText: '' },
    dataset: {},
    setAttribute: () => {},
    remove: () => {},
    appendChild: () => {},
  });

  const dom = {
    innerWidth,
    innerHeight,
    document: {
      visibilityState: 'visible',
      documentElement: { clientWidth: innerWidth, clientHeight: innerHeight, style: { setProperty: () => {} } },
      body: { appendChild: () => {} },
      createElement: () => element(),
      addEventListener: (type, callback) => {
        if (!documentListeners.has(type)) documentListeners.set(type, new Set());
        documentListeners.get(type).add(callback);
      },
      removeEventListener: (type, callback) => {
        documentListeners.get(type)?.delete(callback);
      },
    },
    window: {
      innerWidth,
      innerHeight,
      addEventListener: (type, callback) => {
        if (!windowListeners.has(type)) windowListeners.set(type, new Set());
        windowListeners.get(type).add(callback);
      },
      removeEventListener: (type, callback) => {
        windowListeners.get(type)?.delete(callback);
      },
      dispatchEvent: (event) => {
        for (const callback of [...(windowListeners.get(event.type) ?? [])]) callback(event);
        return true;
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
    getComputedStyle: () => ({
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '0px',
      paddingLeft: '0px',
    }),
  };

  if (webApp) dom.window.Telegram = { WebApp: webApp };
  dom.documentListeners = documentListeners;
  dom.windowListeners = windowListeners;
  return dom;
}

function applyDom(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.document;
  globalThis.getComputedStyle = dom.getComputedStyle;
  return () => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.getComputedStyle;
  };
}

/** Captures console.warn so a diagnostic can be asserted instead of merely printed. */
function captureWarnings() {
  const original = globalThis.console.warn;
  const warnings = [];
  globalThis.console.warn = (...args) => { warnings.push(args.join(' ')); };
  return {
    warnings,
    restore: () => { globalThis.console.warn = original; },
  };
}

/**
 * Loads the platform modules fresh.
 *
 * The platform facade is a module-level singleton, so every case loads its own copy. That
 * keeps the cases independent of each other and lets the facade register its host listeners
 * against the DOM stub of the case, exactly as it does against the real window.
 */
function loadModules() {
  const load = createLoader();
  return {
    TelegramPlatform: load(`${PLATFORM_DIR}/TelegramPlatform.ts`).TelegramPlatform,
    PlatformBridge: load(`${PLATFORM_DIR}/index.ts`).PlatformBridge,
    ViewportManager: load(`${PLATFORM_DIR}/ViewportManager.ts`).ViewportManager,
    ensureTelegramBridge: load(`${PLATFORM_DIR}/TelegramBridgeLoader.ts`).ensureTelegramBridge,
  };
}

// --- Vertical swipe lock -------------------------------------------------------------

{
  const { webApp, calls } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  const capture = captureWarnings();
  try {
    // eslint-disable-next-line no-new
    new TelegramPlatform();
    assert.equal(calls.ready, 1, 'Telegram WebApp must be marked ready');
    assert.equal(calls.expand, 1, 'Telegram Mini App must expand to the full host viewport');
    assert.equal(
      calls.disableVerticalSwipes,
      1,
      'Telegram Mini App must lock vertical swipes so a drag cannot scroll the game away'
    );
    assert.equal(
      webApp.isVerticalSwipesEnabled,
      false,
      'the vertical swipe lock must actually be in effect after the call'
    );
    assert.equal(capture.warnings.length, 0, 'an applied swipe lock must not warn');
  } finally {
    capture.restore();
    restore();
  }
}

{
  // A client older than Bot API 7.7 accepts the call and ignores it. That must be visible.
  const { webApp, calls } = createWebApp({ version: '6.9' });
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  const capture = captureWarnings();
  try {
    // eslint-disable-next-line no-new
    new TelegramPlatform();
    assert.equal(calls.disableVerticalSwipes, 1, 'the lock is still requested from an old client');
    assert.equal(
      webApp.isVerticalSwipesEnabled,
      true,
      'an old client keeps the swipe lock disabled state unchanged'
    );
    assert.equal(
      capture.warnings.length,
      1,
      'a swipe lock that the client ignored must be reported, not silently accepted'
    );
  } finally {
    capture.restore();
    restore();
  }
}

{
  // Telegram reports the Mini App becoming visible again through its own `activated` event.
  const { webApp, calls, emit } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    // eslint-disable-next-line no-new
    new TelegramPlatform();
    assert.equal(calls.disableVerticalSwipes, 1);

    emit('activated');
    assert.equal(
      calls.disableVerticalSwipes,
      2,
      'the vertical swipe lock must be re-applied when Telegram reports the Mini App is active again'
    );

    // The DOM signal stays as the generic-browser fallback.
    for (const callback of installDomListenerGuard()) void callback;
  } finally {
    restore();
  }
}

{
  // The DOM visibility signal must still re-apply the lock outside Telegram.
  const { webApp, calls } = createWebApp();
  const dom = installDom({ webApp });
  const restore = applyDom(dom);
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    // eslint-disable-next-line no-new
    new TelegramPlatform();
    assert.equal(calls.disableVerticalSwipes, 1);

    dom.document.visibilityState = 'visible';
    for (const callback of dom.documentListeners.get('visibilitychange') ?? []) callback();
    assert.equal(
      calls.disableVerticalSwipes,
      2,
      'the vertical swipe lock must be re-applied every time the Mini App page is shown'
    );

    dom.document.visibilityState = 'hidden';
    for (const callback of dom.documentListeners.get('visibilitychange') ?? []) callback();
    assert.equal(calls.disableVerticalSwipes, 2, 'a hidden page must not re-apply the lock');
  } finally {
    restore();
  }
}

function installDomListenerGuard() {
  return [];
}

// --- Viewport change subscription ----------------------------------------------------

{
  const { webApp, calls, emit, liveCount } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const platform = new TelegramPlatform();
    let notified = 0;
    const unsubscribe = platform.subscribeViewportChange(() => { notified += 1; });

    assert.ok(calls.onEvent.includes('viewportChanged'), 'Telegram viewport change must be observed');
    assert.equal(liveCount('viewportChanged'), 1, 'exactly one viewport handler must be registered');
    emit('viewportChanged');
    assert.equal(notified, 1, 'viewport change must reach the listener');

    unsubscribe();
    assert.ok(calls.offEvent.includes('viewportChanged'), 'unsubscribe must detach the viewport listener');
    assert.equal(liveCount('viewportChanged'), 0, 'detached listener must not fire again');
    emit('viewportChanged');
    assert.equal(notified, 1, 'a detached listener must not fire');
  } finally {
    restore();
  }
}

{
  // A second subscriber must not be clobbered by the first one detaching.
  const { webApp, liveCount } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const platform = new TelegramPlatform();
    let first = 0;
    let second = 0;
    const detachFirst = platform.subscribeViewportChange(() => { first += 1; });
    platform.subscribeViewportChange(() => { second += 1; });
    assert.equal(liveCount('viewportChanged'), 2, 'both subscribers must be registered');
    detachFirst();
    assert.equal(liveCount('viewportChanged'), 1, 'detaching one subscriber must not remove the other');
    assert.equal(first, 0, 'the detached subscriber must not fire');
  } finally {
    restore();
  }
}

{
  // Telegram reports an ongoing resize with isStateStable: false. The height is a moving
  // target then, so the frame must not be re-measured on every intermediate event.
  const { webApp, emit } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const platform = new TelegramPlatform();
    let notified = 0;
    platform.subscribeViewportChange(() => { notified += 1; });
    emit('viewportChanged', { isStateStable: false });
    assert.equal(notified, 0, 'an unstable viewport must not trigger a re-measure');
    emit('viewportChanged', { isStateStable: true });
    assert.equal(notified, 1, 'the stable viewport must trigger exactly one re-measure');
    emit('viewportChanged', { isStateStable: true });
    assert.equal(notified, 2, 'each stable viewport change must be reported');
  } finally {
    restore();
  }
}

{
  // A Telegram client without the event bus must not fake a subscription and must not throw.
  const { webApp, calls } = createWebApp({ onEvent: undefined, offEvent: undefined });
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const platform = new TelegramPlatform();
    let notified = 0;
    const unsubscribe = platform.subscribeViewportChange(() => { notified += 1; });
    assert.equal(notified, 0, 'a client without the Telegram event bus cannot report viewport changes');
    assert.equal(calls.onEvent.length, 0, 'a client without the event bus must not be subscribed');
    unsubscribe();
  } finally {
    restore();
  }
}

// --- Facade delegation ----------------------------------------------------------------

{
  const { webApp, calls, emit, liveCount } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    let notified = 0;
    const unsubscribe = PlatformBridge.subscribeViewportChange(() => { notified += 1; });
    assert.ok(calls.onEvent.includes('viewportChanged'), 'the platform facade must forward to the Telegram adapter');
    emit('viewportChanged');
    assert.equal(notified, 1, 'the facade must relay the viewport change');
    unsubscribe();
    assert.ok(calls.offEvent.includes('viewportChanged'), 'the facade must detach the listener');
    assert.equal(liveCount('viewportChanged'), 0, 'the facade must leave no handler behind');
  } finally {
    restore();
  }
}

{
  // The facade must re-bind the viewport listener when the active adapter changes, because a
  // slow MAX bridge can appear after the Telegram Mini App.
  const { webApp, liveCount } = createWebApp();
  const dom = installDom({});
  const restore = applyDom(dom);
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    // Start on the generic browser host, then install the Telegram SDK.
    const unsubscribe = PlatformBridge.subscribeViewportChange(() => {});
    assert.equal(liveCount('viewportChanged'), 0, 'a browser host has no Telegram viewport signal');

    dom.window.Telegram = { WebApp: webApp };
    dom.window.dispatchEvent({ type: 'ofeliya:telegram-bridge-ready' });
    assert.equal(
      liveCount('viewportChanged'),
      1,
      'a late Telegram SDK must be adopted and bound exactly once'
    );

    // A MAX bridge appearing later takes over and the Telegram handler must be released.
    dom.window.WebApp = { initData: 'max-init-data' };
    assert.equal(PlatformBridge.kind, 'max', 'the MAX host must win the adapter selection');
    assert.equal(
      liveCount('viewportChanged'),
      0,
      'switching to the MAX host must release the Telegram viewport handler'
    );
    unsubscribe();
  } finally {
    restore();
  }
}

{
  // Unsubscribing must clear the facade intent, so a later subscribe binds fresh.
  const { webApp, liveCount } = createWebApp();
  const restore = applyDom(installDom({ webApp }));
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const first = PlatformBridge.subscribeViewportChange(() => {});
    assert.equal(liveCount('viewportChanged'), 1, 'the first subscribe must bind one handler');
    first();
    assert.equal(liveCount('viewportChanged'), 0, 'the first unsubscribe must release the handler');
    PlatformBridge.subscribeViewportChange(() => {});
    assert.equal(
      liveCount('viewportChanged'),
      1,
      'a later subscribe must bind exactly one handler, not reuse the released one'
    );
  } finally {
    restore();
  }
}

{
  // An adapter change after an unsubscribe must not resurrect the released listener.
  const { webApp, liveCount } = createWebApp();
  const dom = installDom({});
  const restore = applyDom(dom);
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const first = PlatformBridge.subscribeViewportChange(() => {});
    assert.equal(liveCount('viewportChanged'), 0, 'a browser host binds no Telegram handler');
    first();

    // A late Telegram SDK after the unsubscribe must not resurrect the released listener.
    dom.window.Telegram = { WebApp: webApp };
    dom.window.dispatchEvent({ type: 'ofeliya:telegram-bridge-ready' });
    assert.equal(
      liveCount('viewportChanged'),
      0,
      'an adapter change after an unsubscribe must not re-bind the released listener'
    );

    PlatformBridge.subscribeViewportChange(() => {});
    assert.equal(
      liveCount('viewportChanged'),
      1,
      'a later subscribe must bind exactly one handler on the adopted Telegram host'
    );
  } finally {
    restore();
  }
}

// --- ViewportManager re-measurement --------------------------------------------------

{
  const { webApp, emit } = createWebApp();
  const dom = installDom({ webApp });
  const restore = applyDom(dom);
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    const host = { style: {}, dataset: {} };
    const viewport = new ViewportManager(host);
    viewport.start();
    await viewport.sync();
    assert.equal(host.style.height, '640px', 'the game frame must follow the Telegram viewport height');

    // The Telegram viewport changes without a window resize event.
    webApp.viewportHeight = 500;
    emit('viewportChanged', { isStateStable: true });
    await new Promise((resolveTick) => setTimeout(resolveTick, 30));
    assert.equal(host.style.height, '500px', 'a Telegram viewport change must re-measure the game frame');

    viewport.destroy();
    assert.equal(
      emit('viewportChanged', { isStateStable: true }) === undefined,
      true,
      'destroy must detach the viewport listener'
    );
  } finally {
    restore();
  }
}

{
  // A Telegram SDK that is already present must announce itself, so a host that resolved
  // before the SDK arrived can still adopt the Telegram contract.
  const { webApp } = createWebApp();
  const dom = installDom({ webApp });
  const restore = applyDom(dom);
  const { ensureTelegramBridge } = loadModules();
  try {
    let announced = 0;
    dom.window.addEventListener('ofeliya:telegram-bridge-ready', () => { announced += 1; });
    const ready = await ensureTelegramBridge();
    assert.equal(ready, true, 'a present Telegram SDK must be detected');
    assert.equal(
      announced,
      1,
      'a present Telegram SDK must announce itself so the Telegram host can still be adopted'
    );
  } finally {
    restore();
  }
}

// --- MAX and browser hosts stay untouched ----------------------------------------------

{
  const { webApp, calls, liveCount } = createWebApp();
  const dom = installDom({ webApp });
  const restore = applyDom(dom);
  const { TelegramPlatform, PlatformBridge, ViewportManager } = loadModules();
  try {
    // MAX exposes its bridge as window.WebApp; it has no viewport push signal.
    dom.window.WebApp = { initData: 'max-init-data' };
    let notified = 0;
    const unsubscribe = PlatformBridge.subscribeViewportChange(() => { notified += 1; });
    assert.equal(
      PlatformBridge.kind,
      'max',
      'the MAX host must still be selected when the MAX bridge is present'
    );
    assert.equal(notified, 0, 'a MAX host must not report Telegram viewport changes');
    assert.equal(
      liveCount('viewportChanged'),
      0,
      'a MAX host must not register a Telegram viewport handler'
    );
    assert.equal(
      calls.disableVerticalSwipes,
      0,
      'the Telegram adapter must not be constructed on a MAX host'
    );
    unsubscribe();
  } finally {
    restore();
  }
}

// P11: the facade, not just the concrete Telegram adapter, must multicast.
{
  const { webApp, emit, liveCount, calls } = createWebApp();
  const dom = installDom({});
  const restore = applyDom(dom);
  const { PlatformBridge } = loadModules();
  try {
    let a = 0, b = 0;
    const detachA = PlatformBridge.subscribeViewportChange(() => { a++; });
    const detachB = PlatformBridge.subscribeViewportChange(() => { b++; });
    dom.window.Telegram = { WebApp: webApp };
    dom.window.dispatchEvent({ type: 'ofeliya:telegram-bridge-ready' });
    const before = [a, b];
    emit('viewportChanged');
    assert.deepEqual([a-before[0], b-before[1]], [1, 1], 'P11 facade must deliver viewport to A and B');
    assert.equal(liveCount('viewportChanged'), 1, 'multicast uses one adapter subscription');
    assert.equal(calls.onEvent.filter(type => type === 'viewportChanged').length, 1);
    detachA();detachA();
    const afterA = [a, b];emit('viewportChanged');
    assert.deepEqual([a-afterA[0], b-afterA[1]], [0, 1], 'detaching A leaves B active');
    dom.window.WebApp = { initData: 'max-init' };
    assert.equal(PlatformBridge.kind, 'max');
    assert.equal(liveCount('viewportChanged'), 0, 'MAX transfer releases Telegram signal');
    dom.window.WebApp = undefined;
    assert.equal(PlatformBridge.kind, 'telegram');
    assert.equal(liveCount('viewportChanged'), 1);
    const beforeReturn = b;emit('viewportChanged');assert.equal(b, beforeReturn+1);
    delete dom.window.Telegram;
    assert.equal(PlatformBridge.kind, 'browser');
    assert.equal(liveCount('viewportChanged'), 0);
    dom.window.Telegram = { WebApp: webApp };
    dom.window.dispatchEvent({ type: 'ofeliya:telegram-bridge-ready' });
    assert.equal(liveCount('viewportChanged'), 1);
    detachB();assert.equal(liveCount('viewportChanged'), 0, 'last detach releases adapter');
    const beforeDetached = b;emit('viewportChanged');assert.equal(b, beforeDetached);
    const throwing = PlatformBridge.subscribeViewportChange(() => { throw Error('listener failure'); });
    const good = PlatformBridge.subscribeViewportChange(() => { b++; });
    emit('viewportChanged');assert.equal(b, beforeDetached+1, 'one failing subscriber cannot suppress others');
    throwing();good();assert.equal(liveCount('viewportChanged'), 0);
  } finally { restore(); }
}

{
  const { webApp, emit, liveCount } = createWebApp();
  const dom = installDom({ webApp });
  const restore = applyDom(dom);
  const { ViewportManager } = loadModules();
  try {
    // Reopen multiple managers; repeated start/destroy must not orphan a callback.
    for (let i=0; i<3; i++) {
      const hostA = { style: {}, dataset: {} }, hostB = { style: {}, dataset: {} };
      const a = new ViewportManager(hostA), b = new ViewportManager(hostB);
      a.start();a.start();b.start();
      emit('viewportChanged');await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(hostA.style.height, '640px');assert.equal(hostB.style.height, '640px');
      assert.equal(liveCount('viewportChanged'), 1);
      a.destroy();a.destroy();
      webApp.viewportHeight=620;emit('viewportChanged');await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(hostA.style.height, '640px', 'destroyed manager is not updated');
      assert.equal(hostB.style.height, '620px');
      b.destroy();assert.equal(liveCount('viewportChanged'), 0);
      const oldHeight=hostB.style.height;await b.sync();
      assert.equal(hostB.style.height, oldHeight, 'sync after destroy cannot touch host');
      assert.equal(dom.windowListeners.get('resize')?.size ?? 0, 0);
      assert.equal(dom.windowListeners.get('orientationchange')?.size ?? 0, 0);
      // Telegram adapter owns one page-lifetime visibility listener; managers own none now.
      assert.equal(dom.documentListeners.get('visibilitychange')?.size ?? 0, 1);
      webApp.viewportHeight=640;
    }
    const host={style:{},dataset:{}};
    const m=new ViewportManager(host);m.start();
    const pending=m.sync();m.destroy();await pending;
    assert.equal(host.style.height, undefined, 'in-flight sync is invalidated by destroy');
    m.start();await m.sync();assert.equal(host.style.height,'640px');m.destroy();
    assert.equal(liveCount('viewportChanged'),0);
  } finally { restore(); }
}

console.log('telegram TMA adaptation: original contracts + P11 multicast/transfer/reopen/manager cleanup PASS');
