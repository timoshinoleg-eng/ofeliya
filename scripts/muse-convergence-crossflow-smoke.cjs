/**
 * OFELIYA — MiniMax Muse convergence cross-flow.
 *
 * One real Chromium session, one real Phaser game, one real Telegram adapter.
 * The scenario walks the whole safe Muse client surface in the order a player
 * meets it:
 *
 *   platform startup -> viewport -> Collection -> QuestBoard -> Game
 *   -> kill/RNA/mutation/hit -> forced terminal tick -> cosmetic
 *   -> host pause/resume -> platform transfer -> cleanup
 *
 * Everything is driven through shipped code. The only synthetic parts are
 * explicitly marked `synthetic` in the evidence report: the Telegram SDK
 * object (a browser cannot host a real Mini App) and the MAX bridge stub.
 * Every assertion about the game itself is made against the real scene graph,
 * the real localStorage and the real event bus.
 *
 * Requires a Vite dev server (CI starts one on 127.0.0.1:5173).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright-core');

// Same driver convention as the other browser suites in this repository:
// playwright-core plus the system Chrome, so the suite never depends on a
// Playwright-managed browser download.
const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find(fs.existsSync)
  : [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].find(fs.existsSync));
if (!chrome) throw Error('Chrome executable not found (harness)');

const url = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
const evidencePath = process.env.MUSEFLOW_EVIDENCE
  || path.join(os.tmpdir(), 'muse-convergence-crossflow.json');

/**
 * Synthetic Telegram Mini App host. It implements only the documented surface
 * the product actually uses: viewport signal, closing confirmation, host event
 * bus, back button and safe-area insets.
 */
const SDK = String.raw`
  const handlers = new Map();
  const backHandlers = new Set();
  const parse = (value) => {
    const parts = String(value || '').trim().split('.').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return null;
    return parts;
  };
  window.__p11Tg = {
    initData: 'qa-synthetic-only', platform: 'android', version: '10.1', viewportHeight: 600,
    isVerticalSwipesEnabled: false,
    ready() {}, expand() {}, disableVerticalSwipes() {},
    enableClosingConfirmation() { this.closingEnabled = true; },
    disableClosingConfirmation() { this.closingEnabled = false; },
    BackButton: {
      show() { this.visible = true; }, hide() { this.visible = false; },
      onClick(cb) { backHandlers.add(cb); }, offClick(cb) { backHandlers.delete(cb); }
    },
    isVersionAtLeast(required) {
      const a = parse(this.version), b = parse(required);
      if (!a || !b) return false;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0, y = b[i] ?? 0;
        if (x !== y) return x > y;
      }
      return true;
    },
    onEvent(name, fn) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(fn); },
    offEvent(name, fn) { handlers.get(name)?.delete(fn); },
    emit(name, payload) { for (const fn of [...(handlers.get(name) || [])]) fn(payload ?? { isStateStable: true }); },
    count(name) { return handlers.get(name)?.size || 0; },
    backCount() { return backHandlers.size; }
  };
  window.Telegram = { WebApp: window.__p11Tg };
`;

const report = {
  script: 'scripts/muse-convergence-crossflow-smoke.cjs',
  url,
  startedAt: new Date().toISOString(),
  checks: [],
  synthetic: [
    'Telegram WebApp SDK object (a desktop Chromium cannot host a real Mini App WebView)',
    'MAX bridge stub (window.WebApp)',
    'Telegram SDK script delivery is intercepted and fulfilled locally',
  ],
  errors: [],
};
const mark = (name, value, kind = 'real') => {
  report.checks.push({ name, kind, value });
  console.log('PASS', name, JSON.stringify(value).slice(0, 600));
};

(async () => {
  let browser;
  let page;
  try {
    browser = await chromium.launch({
      executablePath: chrome,
      headless: true,
      args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    page = await browser.newPage({
      viewport: { width: 390, height: 740 },
      hasTouch: true,
      reducedMotion: 'reduce',
    });

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.route('https://st.max.ru/**', route =>
      route.fulfill({ body: '', contentType: 'application/javascript' }));
    // The product must survive an unavailable backend without turning it into a crash.
    await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));

    await page.addInitScript(() => {
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 1, muted: true, tutorialDone: true }));
      // Sentinel: the client Muse Collection must never touch the server Daily authority.
      localStorage.setItem('ofeliya_daily_score_outbox_v1', 'muse-convergence-outbox-sentinel');
      window.__p11BridgeReady = 0;
      window.addEventListener('ofeliya:telegram-bridge-ready', () => { window.__p11BridgeReady++; });
    });

    let sdkRequests = 0;
    let releaseSdk;
    const sdkGate = new Promise(resolve => { releaseSdk = resolve; });
    await page.route('https://telegram.org/js/**', async route => {
      sdkRequests++;
      await sdkGate;
      await route.fulfill({ body: SDK, contentType: 'application/javascript' });
    });

    /**
     * Bounded, self-describing wait. A plain page.waitForFunction hides the state that
     * caused the timeout; this reports the last observed snapshot instead.
     */
    const waitUntil = async (snapshotFn, label, readyFn, readyArg = undefined, timeoutMs = 8000) => {
      const started = Date.now();
      let last;
      while (Date.now() - started < timeoutMs) {
        last = await page.evaluate(snapshotFn);
        if (await page.evaluate(readyFn, readyArg)) {
          // Re-read after readiness so the caller never gets a stale snapshot.
          return await page.evaluate(snapshotFn);
        }
        await page.waitForTimeout(50);
      }
      throw new Error(`timeout waiting for ${label}; last=${JSON.stringify(last)}`);
    };
    const sceneSnapshot = () => {
      const ui = window.__game.scene.getScene('UI');
      const gs = window.__game.scene.getScene('Game');
      return {
        game: gs?.sys?.settings?.status,
        gameActive: window.__game.scene.isActive('Game'),
        gamePaused: window.__game.scene.isPaused('Game'),
        phase: gs?.stageDirector?.phase,
        visibility: document.visibilityState,
        deactivatedHandlers: window.__p11Tg?.count('deactivated'),
        activatedHandlers: window.__p11Tg?.count('activated'),
        canResumeFromHost: ui?.canResumeFromHost?.() ?? null,
        modalOpen: ui?.modalOpen ?? null,
        uiBlocked: ui?.uiBlocked ?? null,
        overShown: ui?.overShown ?? null,
        manualPaused: ui?.manualPaused ?? null,
        transitionOverlay: Boolean(ui?.transitionOverlay),
        activeBossReveals: ui?.activeBossReveals ?? null,
        awaitingChoice: gs?.awaitingChoice ?? null,
      };
    };

    // ---------------------------------------------------------------- Phase 1
    // Platform startup: no Telegram SDK at boot, two concurrent bridge calls,
    // both time out, the SDK arrives late, readiness is announced exactly once.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    assert.equal(sdkRequests, 0, 'browser launch must not request the Telegram SDK');

    // Checkpoint: the browser-only frame starts at the real window size.
    const bootViewport = await page.evaluate(() => [window.__game.scale.width, window.__game.scale.height]);
    assert.deepEqual(bootViewport, [390, 740], 'the initial viewport must be 390x740');
    mark('viewport: the browser-only frame starts at 390x740', { bootViewport });

    const expired = await page.evaluate(async () => {
      const { ensureTelegramBridge } = await import('/src/platform/TelegramBridgeLoader.ts');
      const { PlatformBridge } = await import('/src/platform/index.ts');
      window.__p11Platform = PlatformBridge;
      window.__p11Counts = [0, 0];
      window.__p11DetachA = PlatformBridge.subscribeViewportChange(() => { window.__p11Counts[0]++; });
      window.__p11DetachB = PlatformBridge.subscribeViewportChange(() => { window.__p11Counts[1]++; });
      location.hash = 'tgWebAppData=qa-synth&tgWebAppVersion=10.1';
      return Promise.all([ensureTelegramBridge(8), ensureTelegramBridge(25)]);
    });
    assert.deepEqual(expired, [false, false], 'both concurrent bridge calls must time out');
    assert.equal(sdkRequests, 1, 'concurrent callers must share one SDK script request');

    releaseSdk();
    await page.waitForFunction(() => window.__p11BridgeReady === 1 && window.__p11Platform.kind === 'telegram');
    assert.equal(sdkRequests, 1, 'a late SDK load must not duplicate the script request');
    mark('platform startup: late SDK, one shared script request, one readiness announcement', {
      sdkRequests,
      ready: await page.evaluate(() => window.__p11BridgeReady),
      adapter: await page.evaluate(() => window.__p11Platform.kind),
    });

    const multicast = await page.evaluate(async () => {
      window.__p11Tg.emit('viewportChanged');
      await window.__viewportManager.sync();
      return {
        counts: window.__p11Counts,
        physical: window.__p11Tg.count('viewportChanged'),
      };
    });
    assert.deepEqual(multicast.counts, [1, 1], 'both logical subscribers must receive the viewport signal');
    assert.equal(multicast.physical, 1, 'multicast must keep exactly one physical host subscription');
    mark('platform startup: one physical viewport subscription, correct logical multicast', multicast);

    // ---------------------------------------------------------------- Phase 2
    // Viewport: the Telegram virtual viewport shrinks the real Phaser frame.
    await page.waitForFunction(() => window.__game.scale.height === 600);
    const telegramViewport = await page.evaluate(() => ({
      scale: [window.__game.scale.width, window.__game.scale.height],
      canvas: (() => {
        const r = document.querySelector('#game canvas').getBoundingClientRect();
        return { width: r.width, height: r.height };
      })(),
    }));
    assert.deepEqual(telegramViewport.scale, [390, 600], 'the Telegram virtual viewport must resize the Phaser frame');
    assert.equal(telegramViewport.canvas.height, 600, 'the real canvas must follow the virtual viewport');
    mark('viewport: the Telegram virtual viewport drives the real frame to 390x600', telegramViewport);

    // An explicit resize must recreate the Menu and keep both CTAs inside the new bounds.
    await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      window.__p11MenuCreates = 0;
      menu.events.on('create', () => {
        window.__p11MenuCreates++;
        window.__p11MenuScale = [menu.scale.width, menu.scale.height];
      });
      window.__p11Tg.viewportHeight = 700;
      window.__p11Tg.emit('viewportChanged');
    });
    await page.waitForFunction(() => window.__p11MenuCreates >= 1 && window.__game.scale.height === 700);

    const viewportLayout = await page.evaluate(() => {
      const game = window.__game;
      const menu = game.scene.getScene('Menu');
      // The shipped touch target is the interactive button plate; the label text is only a caption.
      const action = menu.children.getByName('ofeliya-menu-action-bg');
      const legal = menu.children.list.find(o => o.text === 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА');
      const canvas = document.querySelector('#game canvas').getBoundingClientRect();
      return {
        menuCreates: window.__p11MenuCreates,
        menuScale: window.__p11MenuScale,
        scale: [game.scale.width, game.scale.height],
        canvas: { width: canvas.width, height: canvas.height },
        action: action?.getBounds(),
        actionInteractive: Boolean(action?.input?.enabled),
        legal: legal?.getBounds(),
        legalInteractive: Boolean(legal?.input?.enabled),
      };
    });
    assert.ok(viewportLayout.menuCreates >= 1, 'a viewport change must recreate the Menu');
    assert.deepEqual(viewportLayout.menuScale, [390, 700], 'the recreated Menu must be built for the new frame');
    assert.deepEqual(viewportLayout.scale, [390, 700], 'the Phaser frame must follow the new viewport');
    assert.equal(viewportLayout.actionInteractive, true, 'the action button must stay interactive after the resize');
    for (const name of ['action', 'legal']) {
      const b = viewportLayout[name];
      assert.ok(b, `${name} CTA must exist after the viewport change`);
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 390 && b.y + b.height <= 700,
        `${name} CTA must stay inside the resized viewport`);
    }
    assert.equal(viewportLayout.legalInteractive, true, 'the legal CTA must stay tappable after the resize');
    assert.ok(viewportLayout.action.height >= 44, 'the action button must keep a 44px touch target');
    mark('viewport: a resize recreates the Menu and keeps both CTAs inside the new bounds', viewportLayout);

    await page.evaluate(() => {
      window.__p11Tg.viewportHeight = 600;
      window.__p11Tg.emit('viewportChanged');
    });
    await page.waitForFunction(() => window.__game.scale.height === 600);
    mark('viewport: the frame returns to 390x600 on the next virtual viewport signal', {
      scale: await page.evaluate(() => [window.__game.scale.width, window.__game.scale.height]),
    });

    // ---------------------------------------------------------------- Phase 3
    // Muse Collection. Real touch taps, real tabs, real localStorage.
    /**
     * Tap a named control anywhere in a scene tree, using its real screen bounds.
     * The Menu, the Collection board, the level-up modal and the result overlay all
     * live in different scenes, so the lookup is generic on purpose.
     */
    const tapControl = async (sceneKey, name) => {
      const point = await page.evaluate(({ sceneKey, name }) => {
        const scene = window.__game.scene.getScene(sceneKey);
        const visit = o => {
          if (o.name === name) return o;
          for (const child of (o.list || [])) {
            const found = visit(child);
            if (found) return found;
          }
          return null;
        };
        let target = null;
        for (const child of scene.children.list) {
          target = visit(child);
          if (target) break;
        }
        if (!target) throw Error(`missing control ${name} in scene ${sceneKey}`);
        const b = target.getBounds();
        const canvas = window.__game.canvas.getBoundingClientRect();
        return {
          x: canvas.x + (b.x + b.width / 2) * canvas.width / scene.scale.width,
          y: canvas.y + (b.y + b.height / 2) * canvas.height / scene.scale.height,
        };
      }, { sceneKey, name });
      await page.touchscreen.tap(point.x, point.y);
    };
    const tap = name => tapControl('Menu', name);

    const storageSnapshot = () => page.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        out[key] = localStorage.getItem(key);
      }
      return out;
    });

    const storageBefore = await storageSnapshot();

    await page.evaluate(() => { window.__game.scene.getScene('Menu').showCodex(); });
    await tap('ofeliya-menu-collection');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection')));

    const achievements = await page.evaluate(async () => {
      const { COLLECTION_CATALOG } = await import('/src/game/collection/ClientCollection.ts');
      const root = window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
      const texts = root.list.filter(o => o.type === 'Text').map(o => o.text);
      return {
        catalogSize: COLLECTION_CATALOG.length,
        progressRows: texts.filter(t => /^\d[\d\s ]*\/\s[\d\s ]+$/.test(t)).length,
        hasMoneyWords: texts.some(t => /руб|₽|цена|купить|оплат|скидк/i.test(t)),
      };
    });
    assert.ok(achievements.catalogSize >= 24, 'the Muse catalog must keep its 24 goals');
    assert.ok(achievements.progressRows > 0, 'the achievements tab must render observable progress');
    assert.equal(achievements.hasMoneyWords, false, 'achievements must not present purchase or currency copy');
    mark('collection: achievements tab renders the observational catalog without money copy', achievements);

    // The board paginates; walk every page and prove the pager advances and terminates.
    // The pager label is the only centred "n / m" text; achievement rows are left-aligned.
    const readPager = () => page.evaluate(() => {
      const root = window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
      const indicator = root.list
        .filter(o => o.type === 'Text' && Math.abs((o.originX ?? 0) - 0.5) < 0.01)
        .map(o => o.text)
        .find(t => /^\d+\s*\/\s*\d+$/.test(t));
      const next = root.list.find(o => o.name === 'ofeliya-collection-next');
      const prev = root.list.find(o => o.name === 'ofeliya-collection-prev');
      return { indicator, nextEnabled: Boolean(next?.input?.enabled), prevEnabled: Boolean(prev?.input?.enabled) };
    });
    const pager = await readPager();
    assert.match(pager.indicator, /^1\s*\/\s*\d+$/, 'the achievements pager must start on the first page');
    assert.equal(pager.prevEnabled, false, 'the first page must not offer a previous page');
    assert.equal(pager.nextEnabled, true, 'the achievements catalog must offer more than one page');

    await tap('ofeliya-collection-next');
    const pager2 = await readPager();
    assert.match(pager2.indicator, /^2\s*\/\s*\d+$/, 'the achievements pager must advance to the second page');
    mark('collection: the achievements pager advances through the catalog', { first: pager, second: pager2 });

    await tap('ofeliya-collection-skins');
    const skins = await page.evaluate(async () => {
      const { SKIN_CATALOG, ClientCollection } = await import('/src/game/collection/ClientCollection.ts');
      const state = new ClientCollection().snapshot();
      const root = window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
      const buttons = root.list.filter(o => o.name?.startsWith('ofeliya-skin-'));
      const next = root.list.find(o => o.name === 'ofeliya-collection-next');
      return {
        catalogSize: SKIN_CATALOG.length,
        catalogIds: SKIN_CATALOG.map(s => s.id),
        owned: state.ownedSkinIds,
        selected: state.selectedSkinId,
        buttonNames: buttons.map(b => b.name),
        interactive: buttons.map(b => Boolean(b.input?.enabled)),
        nextEnabled: Boolean(next?.input?.enabled),
      };
    });
    assert.ok(skins.catalogSize >= 4, 'the skin catalog must expose at least the four Muse palettes');
    assert.ok(skins.owned.includes('strain-zero'), 'the default palette must always be owned');
    assert.equal(skins.selected, 'strain-zero', 'a fresh collection must select the default palette');

    // Walk every skin page and collect the palettes the board actually shows.
    const seenSkins = new Set(skins.buttonNames.map(n => n.replace('ofeliya-skin-', '')));
    let skinsTruncated = false;
    while (skins.nextEnabled) {
      await tap('ofeliya-collection-next');
      const skinPage = await page.evaluate(() => {
        const root = window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
        const buttons = root.list.filter(o => o.name?.startsWith('ofeliya-skin-'));
        const next = root.list.find(o => o.name === 'ofeliya-collection-next');
        return { names: buttons.map(b => b.name), nextEnabled: Boolean(next?.input?.enabled) };
      });
      skinPage.names.forEach(n => seenSkins.add(n.replace('ofeliya-skin-', '')));
      if (!skinPage.nextEnabled) skinsTruncated = true;
      if (!skinPage.nextEnabled) break;
    }
    for (const id of skins.catalogIds) {
      assert.ok(seenSkins.has(id), `the skins tab must be able to show ${id}`);
    }
    assert.ok(skinsTruncated, 'the skin pager must terminate on the last page');
    const lockedRejected = await page.evaluate(async () => {
      const { ClientCollection } = await import('/src/game/collection/ClientCollection.ts');
      const c = new ClientCollection();
      const locked = c.selectSkin('skin.gilded-prime');
      const unknown = c.selectSkin('skin.does-not-exist');
      return { locked, unknown, selected: c.snapshot().selectedSkinId };
    });
    assert.equal(lockedRejected.locked, false, 'a locked skin must be rejected');
    assert.equal(lockedRejected.unknown, false, 'an unknown skin must be rejected');
    assert.equal(lockedRejected.selected, 'strain-zero', 'a rejected selection must not change the palette');
    mark('collection: skins tab pages through every palette, shows locked/owned state and rejects locked and unknown palettes',
      { ...skins, seenSkins: [...seenSkins], ...lockedRejected });

    await tap('ofeliya-collection-lab');
    const lab = await page.evaluate(() => {
      const root = window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection');
      const texts = root.list.filter(o => o.type === 'Text').map(o => o.text);
      const interactive = root.list.filter(o => o.input?.enabled).map(o => o.name || o.type);
      return {
        informational: texts.some(t => t.includes('БЕЗ УСИЛЕНИЙ')),
        noPermanentPower: texts.some(t => t.includes('не меняются')),
        branches: ['МЕТАБОЛИЗМ', 'ХИТИН', 'ХЕМОТАКСИС'].filter(b => texts.some(t => t.includes(b))),
        interactiveControls: interactive,
      };
    });
    assert.equal(lab.informational, true, 'the lab must be labelled informational');
    assert.equal(lab.noPermanentPower, true, 'the lab must state that stats do not change');
    assert.equal(lab.branches.length, 3, 'all three Muse research branches must be listed');
    assert.deepEqual(lab.interactiveControls.filter(n => /buy|upgrade|purchase|buy/i.test(String(n))), [],
      'the lab must not expose a purchase control');
    mark('collection: lab tab is informational and exposes no permanent power control', lab);

    await tap('ofeliya-collection-close');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection'));

    const storageAfterCollection = await storageSnapshot();
    const changedKeys = Object.keys({
      ...storageBefore, ...storageAfterCollection,
    }).filter(key => storageBefore[key] !== storageAfterCollection[key]);
    const foreignKeys = changedKeys.filter(key => key !== 'ofeliya.collection.v1');
    assert.deepEqual(foreignKeys, [],
      'the Muse Collection must not write any storage key other than ofeliya.collection.v1 (no second Daily authority, no currency)');
    mark('collection: opening the board writes no foreign storage key', { changedKeys, foreignKeys });

    // Repeated open/close must not accumulate listeners or back handlers.
    const listenerBaseline = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return {
        shutdown: menu.events.listenerCount('shutdown'),
        resize: menu.scale.listenerCount('resize'),
        back: window.__p11Tg.backCount(),
      };
    });
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => { window.__game.scene.getScene('Menu').showCodex(); });
      await tap('ofeliya-menu-collection');
      await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection')));
      await tap('ofeliya-collection-close');
      await page.waitForFunction(() => !window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection'));
    }
    const listenerAfter = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return {
        shutdown: menu.events.listenerCount('shutdown'),
        resize: menu.scale.listenerCount('resize'),
        back: window.__p11Tg.backCount(),
      };
    });
    assert.deepEqual(listenerAfter, listenerBaseline, 'repeated Collection open/close must not grow listeners');
    mark('collection: 10 open/close cycles keep listener and back-handler counts flat', {
      before: listenerBaseline, after: listenerAfter,
    });

    // ---------------------------------------------------------------- Phase 4
    // QuestBoard under the live Telegram adapter.
    const questBaseline = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return { shutdown: menu.events.listenerCount('shutdown'), back: window.__p11Tg.backCount() };
    });
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => { window.__game.scene.getScene('Menu').showCodex(); });
      await tap('ofeliya-menu-quests');
      await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').questBoard));
      await page.evaluate(() => { window.__game.scene.getScene('Menu').questBoard.destroy(); });
    }
    const questAfter = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return { shutdown: menu.events.listenerCount('shutdown'), back: window.__p11Tg.backCount() };
    });
    assert.deepEqual(questAfter, questBaseline, 'repeated QuestBoard open/close must not grow listeners');
    mark('questboard: 5 open/close cycles keep listener and back-handler counts flat', {
      before: questBaseline, after: questAfter,
    });

    // ---------------------------------------------------------------- Phase 5
    // Real GameScene: kill, RNA, mutation, damage, forced terminal tick, finish.

    // --- Phase 4.5: the compact viewport matrix and the Collection teardown paths.
    // The Menu must survive every supported compact frame, and the Collection board
    // must tear down cleanly when the Menu restarts underneath it or while a tween runs.
    const readMenuCtas = () => page.evaluate(() => {
      const game = window.__game;
      const menu = game.scene.getScene('Menu');
      const action = menu.children.getByName('ofeliya-menu-action-bg');
      const legal = menu.children.list.find(o => o.text === 'О ПРИЛОЖЕНИИ · ПОЛИТИКА · ПОДДЕРЖКА');
      return {
        scale: [game.scale.width, game.scale.height],
        action: action?.getBounds(),
        legal: legal?.getBounds(),
        actionInteractive: Boolean(action?.input?.enabled),
        legalInteractive: Boolean(legal?.input?.enabled),
      };
    });

    const viewportMatrix = [];
    for (const [width, height] of [[320, 474], [320, 568], [390, 600], [390, 740], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(h => {
        window.__p11Tg.viewportHeight = h;
        window.__p11Tg.emit('viewportChanged');
      }, height);
      await waitUntil(sceneSnapshot, `the frame to reach ${width}x${height}`,
        size => window.__game.scale.width === size.width && window.__game.scale.height === size.height,
        { width, height });
      const ctas = await readMenuCtas();
      assert.deepEqual(ctas.scale, [width, height], `the frame must reach ${width}x${height}`);
      assert.equal(ctas.actionInteractive, true, `the action CTA must stay interactive at ${width}x${height}`);
      assert.equal(ctas.legalInteractive, true, `the legal CTA must stay interactive at ${width}x${height}`);
      for (const name of ['action', 'legal']) {
        const b = ctas[name];
        assert.ok(b, `${name} CTA must exist at ${width}x${height}`);
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height,
          `${name} CTA must stay inside ${width}x${height} (got ${JSON.stringify(b)})`);
      }
      assert.ok(ctas.action.height >= 44, `the action button must keep a 44px touch target at ${width}x${height}`);
      viewportMatrix.push({ size: `${width}x${height}`, action: ctas.action, legal: ctas.legal });
    }
    mark('viewport matrix: the Menu keeps both CTAs in bounds at 320x474, 320x568, 390x600, 390x740 and 390x844',
      { sizes: viewportMatrix.map(v => v.size) });

    // Back to the reference frame for the remaining phases.
    await page.setViewportSize({ width: 390, height: 740 });
    await page.evaluate(() => {
      window.__p11Tg.viewportHeight = 600;
      window.__p11Tg.emit('viewportChanged');
    });
    await waitUntil(sceneSnapshot, 'the frame to return to 390x600',
      () => window.__game.scale.width === 390 && window.__game.scale.height === 600);

    // Teardown during an active tween: open and close the board inside the reveal animation.
    const tweenTeardown = await page.evaluate(async () => {
      const menu = window.__game.scene.getScene('Menu');
      const before = {
        shutdown: menu.events.listenerCount('shutdown'),
        resize: menu.scale.listenerCount('resize'),
        back: window.__p11Tg.backCount(),
      };
      menu.showCodex();
      return before;
    });
    await tap('ofeliya-menu-collection');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection')));
    // Close immediately: the reward-reveal tween is still running at this point.
    await tap('ofeliya-collection-close');
    await page.waitForTimeout(120);
    const afterTweenTeardown = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return {
        collection: Boolean(menu.children.getByName('ofeliya-collection')),
        shutdown: menu.events.listenerCount('shutdown'),
        resize: menu.scale.listenerCount('resize'),
        back: window.__p11Tg.backCount(),
      };
    });
    assert.equal(afterTweenTeardown.collection, false, 'the board must be gone after an early close');
    assert.equal(afterTweenTeardown.shutdown, tweenTeardown.shutdown,
      'closing during the reveal tween must not leak a shutdown listener');
    assert.equal(afterTweenTeardown.resize, tweenTeardown.resize,
      'closing during the reveal tween must not leak a resize listener');
    mark('collection: closing the board during the reveal tween leaves no listener behind', afterTweenTeardown);

    // Teardown by a Menu restart: the viewport changes while the board is open.
    const restartBaseline = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return {
        shutdown: menu.events.listenerCount('shutdown'),
        resize: menu.scale.listenerCount('resize'),
        back: window.__p11Tg.backCount(),
      };
    });
    await page.evaluate(() => { window.__game.scene.getScene('Menu').showCodex(); });
    await tap('ofeliya-menu-collection');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').children.getByName('ofeliya-collection')));
    await page.evaluate(() => {
      window.__p11Tg.viewportHeight = 700;
      window.__p11Tg.emit('viewportChanged');
    });
    await waitUntil(sceneSnapshot, 'the Menu to restart under the open board',
      () => window.__game.scale.height === 700);
    const afterRestart = await page.evaluate(() => {
      const menu = window.__game.scene.getScene('Menu');
      return {
        collection: Boolean(menu.children.getByName('ofeliya-collection')),
        collectionBoard: Boolean(menu.collectionBoard),
        shutdown: menu.events.listenerCount('shutdown'),
        resize: menu.scale.listenerCount('resize'),
        back: window.__p11Tg.backCount(),
      };
    });
    assert.equal(afterRestart.collection, false, 'a Menu restart must destroy the open Collection board');
    assert.equal(afterRestart.collectionBoard, false, 'a Menu restart must clear the board reference');
    assert.equal(afterRestart.shutdown, restartBaseline.shutdown, 'a Menu restart must not leak shutdown listeners');
    assert.equal(afterRestart.resize, restartBaseline.resize, 'a Menu restart must not leak resize listeners');
    assert.equal(afterRestart.back, restartBaseline.back, 'a Menu restart must not leak a back handler');
    mark('collection: a Menu restart under an open board destroys it cleanly and leaks nothing', afterRestart);

    await page.evaluate(() => {
      window.__p11Tg.viewportHeight = 600;
      window.__p11Tg.emit('viewportChanged');
    });
    await waitUntil(sceneSnapshot, 'the frame to return to 390x600',
      () => window.__game.scale.width === 390 && window.__game.scale.height === 600);

    await page.evaluate(() => { window.__game.scene.getScene('Menu').scene.start('Game'); });
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
    assert.equal(await page.evaluate(() => window.__p11Tg.closingEnabled), true,
      'the Muse Game must enable the Telegram closing confirmation');

    // Real kill and real RNA pickup, both through the live game objects.
    const early = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const read = () => { gs.quests.flush(); return JSON.parse(localStorage.getItem('ofeliya.quests.v1')); };
      const baseline = read();
      const enemy = gs.spawnEnemy('swarm', gs.player.x + 100, gs.player.y, true);
      enemy.takeDamage(1000000);
      enemy.takeDamage(1000000);
      const killed = read();
      const gem = gs.gems.get(gs.player.x, gs.player.y);
      gem.activate(gs, gs.player.x, gs.player.y, 7);
      gem.collect();
      const picked = read();
      // Ask the game for one real level-up so the UI builds the real upgrade cards.
      gs.queuedLevels = 1;
      return { baseline, killed, picked };
    });
    assert.equal(early.killed.runMetrics.q_kills - early.baseline.runMetrics.q_kills, 1,
      'one real kill must produce exactly one quest kill');
    assert.equal(early.picked.runMetrics.q_rna - early.killed.runMetrics.q_rna, 7,
      'one real RNA pickup must produce exactly seven quest RNA');

    // The mutation is chosen through the real level-up modal, by touching a real card.
    await page.waitForFunction(() => {
      const ui = window.__game.scene.getScene('UI');
      return Boolean(ui?.modal) && window.__game.scene.getScene('Game').awaitingChoice === true;
    });
    const cardInfo = await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      const cards = ui.modal.list.filter(o => o.type === 'Container');
      const gs = window.__game.scene.getScene('Game');
      return {
        cards: cards.length,
        choices: gs.pendingChoices.map(c => ({ id: c.id, title: c.title, kind: c.kind })),
      };
    });
    assert.ok(cardInfo.cards > 0, 'the level-up modal must render real upgrade cards');
    assert.ok(cardInfo.choices.length > 0, 'the real level-up must offer real upgrade definitions');

    const cardPoint = await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      const card = ui.modal.list.filter(o => o.type === 'Container')[0];
      const hit = card.list.find(o => o.input && o.input.enabled);
      if (!hit) throw Error('the first upgrade card has no interactive surface');
      const b = hit.getBounds();
      const canvas = window.__game.canvas.getBoundingClientRect();
      const scene = window.__game.scene.getScene('UI');
      return {
        x: canvas.x + (b.x + b.width / 2) * canvas.width / scene.scale.width,
        y: canvas.y + (b.y + b.height / 2) * canvas.height / scene.scale.height,
      };
    });
    await page.touchscreen.tap(cardPoint.x, cardPoint.y);
    await page.waitForFunction(() => {
      const ui = window.__game.scene.getScene('UI');
      const gs = window.__game.scene.getScene('Game');
      return !ui.modal && gs.awaitingChoice === false;
    });

    // Damage, a clean streak, a suppressed pending sample and the forced terminal tick.
    const gameplay = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      gs.scene.pause();
      const read = () => { gs.quests.flush(); return JSON.parse(localStorage.getItem('ofeliya.quests.v1')); };
      const mutated = read();

      gs.runState.run.timeMs = 65950;
      gs.runState.stage.noDamageMs = 65950;
      gs.quests.tick(65950, 65950, true);
      const attacker = gs.spawnEnemy('swarm', gs.player.x + 100, gs.player.y, false);
      gs.player.hurtUntil = 0;
      gs.onPlayerHit(gs.player, attacker);
      const damaged = read();

      // A clean streak, then a pending sample that only a forced terminal tick can flush.
      gs.runState.run.timeMs = 125000;
      gs.runState.stage.noDamageMs = 59050;
      gs.quests.tick(125000, 59050);
      gs.runState.run.timeMs = 125950;
      gs.runState.stage.noDamageMs = 60000;
      gs.quests.tick(125950, 60000);
      const pending = read();

      gs.finish(false);
      const ended = read();
      const collectionAfterFirstFinish = localStorage.getItem('ofeliya.collection.v1');
      const outboxAfterFirstFinish = localStorage.getItem('ofeliya_daily_score_outbox_v1');

      gs.finish(false);
      const repeated = read();
      const collectionAfterSecondFinish = localStorage.getItem('ofeliya.collection.v1');

      return {
        mutated, damaged, pending, ended, repeated,
        collectionAfterFirstFinish, collectionAfterSecondFinish,
        outboxAfterFirstFinish,
        outboxAfterSecondFinish: localStorage.getItem('ofeliya_daily_score_outbox_v1'),
      };
    });

    assert.equal(gameplay.mutated.runMetrics.q_mut - early.picked.runMetrics.q_mut, 1,
      'one real mutation chosen through the level-up modal must produce exactly one quest mutation');
    assert.equal(gameplay.damaged.streakLast, 0, 'a real hit must reset the no-damage streak');
    assert.equal(gameplay.pending.lastTickTimeMs, 125000, 'the suppressed sample must stay pending');
    assert.equal(gameplay.ended.lastTickTimeMs, 125950, 'the forced terminal tick must be delivered');
    assert.equal(gameplay.ended.streakLast, 60, 'the forced terminal tick must deliver the full 60s streak');
    assert.deepEqual(gameplay.ended, gameplay.repeated, 'a repeated finish must not change QuestState');
    assert.equal(gameplay.collectionAfterFirstFinish, gameplay.collectionAfterSecondFinish,
      'a repeated finish must not add a second collection observation');
    assert.equal(gameplay.outboxAfterFirstFinish, 'muse-convergence-outbox-sentinel',
      'the Daily outbox sentinel must survive the run');
    assert.equal(gameplay.outboxAfterSecondFinish, 'muse-convergence-outbox-sentinel',
      'a repeated finish must not touch the Daily outbox');
    mark('game: real kill/RNA/mutation/hit, forced terminal tick 125000->125950 with a 60s streak, idempotent finish', {
      kills: early.killed.runMetrics.q_kills - early.baseline.runMetrics.q_kills,
      rna: early.picked.runMetrics.q_rna - early.killed.runMetrics.q_rna,
      mutations: gameplay.mutated.runMetrics.q_mut - early.picked.runMetrics.q_mut,
      mutationCards: cardInfo.choices.map(c => c.id),
      streakAfterHit: gameplay.damaged.streakLast,
      pendingLastTick: gameplay.pending.lastTickTimeMs,
      finalLastTick: gameplay.ended.lastTickTimeMs,
      finalStreak: gameplay.ended.streakLast,
      outbox: gameplay.outboxAfterSecondFinish,
    });

    // ---------------------------------------------------------------- Phase 6
    // Cosmetic: an earned palette changes appearance, never the collision body.
    // Snapshot immediately before the unlock: the run legitimately wrote the save,
    // the quest state and the score outbox, and only the collection write is under test.
    const storageBeforeUnlock = await storageSnapshot();
    const cosmetic = await page.evaluate(async () => {
      const { ClientCollection } = await import('/src/game/collection/ClientCollection.ts');
      const c = new ClientCollection();
      const unlocked = c.observeRun({
        id: 'qa-crossflow-cosmetic', kills: 0, timeMs: 0, noDamageMs: 0, level: 1, combo: 50,
        mutations: [], elites: 0, hostCells: 0, evolutions: [], legendaryIds: [], won: false,
      });
      const selected = c.selectSkin('skin.abyssal-teal');
      const before = c.snapshot();
      return { unlocked, selected, owned: before.ownedSkinIds, selectedSkinId: before.selectedSkinId };
    });
    assert.ok(cosmetic.unlocked.includes('combo_50'), 'the cosmetic goal must unlock from an observation');
    assert.equal(cosmetic.selected, true, 'an earned palette must be selectable');
    assert.equal(cosmetic.selectedSkinId, 'skin.abyssal-teal', 'the selected palette must persist');

    // Earning a cosmetic must stay inside the collection store and leave the Daily authority alone.
    const storageAfterUnlock = await storageSnapshot();
    const unlockChanged = Object.keys({
      ...storageBeforeUnlock, ...storageAfterUnlock,
    }).filter(key => storageBeforeUnlock[key] !== storageAfterUnlock[key]);
    assert.deepEqual(unlockChanged.filter(k => k !== 'ofeliya.collection.v1'), [],
      'unlocking a cosmetic must not write outside ofeliya.collection.v1');
    assert.equal(storageAfterUnlock.ofeliya_daily_score_outbox_v1, 'muse-convergence-outbox-sentinel',
      'the Daily outbox sentinel must survive a cosmetic unlock');
    mark('collection: a cosmetic unlock writes only ofeliya.collection.v1 and leaves the Daily outbox intact',
      { unlockChanged });

    // The new run is started with the product's own "play again" control, which
    // restarts the Game and the UI together — the only restart path the product has.
    await page.waitForFunction(() => {
      const ui = window.__game.scene.getScene('UI');
      const visit = o => {
        if (o.name === 'ofeliya-result-retry-bg') return true;
        return (o.list || []).some(visit);
      };
      return ui.children.list.some(visit);
    });
    await tapControl('UI', 'ofeliya-result-retry-bg');
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
    await page.waitForTimeout(300);
    const appearance = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const body = gs.player.body;
      const radius = body.radius * gs.player.scaleX;
      const tint = gs.player.tintTopLeft;
      const silhouette = gs.player.texture?.key ?? null;
      const ui = window.__game.scene.getScene('UI');
      return {
        radius, tint, silhouette,
        width: body.width, height: body.height,
        overShown: ui.overShown, uiBlocked: ui.uiBlocked, modalOpen: ui.modalOpen,
      };
    });
    assert.notEqual(appearance.tint, 0xffffff, 'an earned cosmetic must change the player appearance');
    assert.ok(appearance.radius > 10 && appearance.radius < 14, 'a cosmetic must preserve the authoritative body radius');
    assert.ok(appearance.silhouette, 'the mutation silhouette texture must still be present');
    assert.equal(appearance.overShown, false, 'a fresh run must not inherit the previous game-over state');
    assert.equal(appearance.uiBlocked, false, 'a fresh run must not inherit the previous blocked UI state');
    mark('cosmetic: earned palette changes appearance while collision body and silhouette stay authoritative', appearance);

    // ---------------------------------------------------------------- Phase 7
    // Host lifecycle: a host pause is resumable, a manual pause is not.
    // The host deliberately refuses to own a pause it did not create, so the game
    // must be running before the host deactivates it.
    const phase7State = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const before = {
        status: gs.sys.settings.status,
        visibility: document.visibilityState,
        phase: gs.stageDirector?.phase,
      };
      // The manager-level resume is immediate, so the host contract below is tested
      // from a deterministic running state instead of a queued one.
      window.__game.scene.resume('Game');
      return before;
    });
    await page.waitForTimeout(200);
    const phase7Final = await page.evaluate(() => ({
      status: window.__game.scene.getScene('Game').sys.settings.status,
      isActive: window.__game.scene.isActive('Game'),
    }));
    assert.equal(phase7Final.isActive, true,
      `the game must be running before the host deactivates it (${JSON.stringify({ phase7State, phase7Final })})`);
    await page.evaluate(() => { window.__p11Tg.emit('deactivated'); });
    const pausedSnapshot = await waitUntil(sceneSnapshot, 'the host deactivation to pause the game',
      () => window.__game.scene.isPaused('Game'));
    assert.equal(pausedSnapshot.gamePaused, true,
      'a Telegram deactivation must pause the running game');
    await page.evaluate(() => { window.__p11Tg.emit('activated'); });
    const resumedSnapshot = await waitUntil(sceneSnapshot, 'the host activation to resume the game',
      () => window.__game.scene.isActive('Game'));
    assert.equal(resumedSnapshot.gameActive, true,
      'a Telegram activation must resume the host-owned pause');
    mark('host lifecycle: Telegram deactivated pauses and activated resumes the host-owned pause', {
      afterDeactivated: pausedSnapshot,
      afterActivated: resumedSnapshot,
    });

    // A manual pause owns the game: the host must neither take it over nor release it.
    await page.evaluate(() => { window.__game.scene.getScene('UI').showPauseMenu(); });
    await waitUntil(sceneSnapshot, 'the manual pause menu to pause the game',
      () => window.__game.scene.isPaused('Game'));
    await page.evaluate(() => { window.__p11Tg.emit('deactivated'); window.__p11Tg.emit('activated'); });
    await page.waitForTimeout(300);
    const manualSnapshot = await page.evaluate(sceneSnapshot);
    assert.equal(manualSnapshot.gamePaused, true,
      'host activation must not resume a manual pause');
    await page.evaluate(() => { window.__game.scene.getScene('UI').closePauseMenu(true); });
    await waitUntil(sceneSnapshot, 'the manual pause menu to release the game',
      () => window.__game.scene.isActive('Game'));
    mark('host lifecycle: a manual pause survives deactivated -> activated', { manualPausePreserved: true });

    // ---------------------------------------------------------------- Phase 8
    // Platform transfer: Telegram -> MAX -> Browser -> Telegram.
    const telegramHandlersBefore = await page.evaluate(() => window.__p11Tg.count('viewportChanged'));
    await page.evaluate(() => {
      window.WebApp = {
        initData: 'qa-max-synthetic',
        getViewportSize: async () => ({ width: '390', height: '580' }),
      };
      window.dispatchEvent(new Event('ofeliya:max-bridge-ready'));
    });
    await page.waitForFunction(() => document.getElementById('game')?.dataset.viewportSource === 'max');
    const maxState = await page.evaluate(() => ({
      source: document.getElementById('game')?.dataset.viewportSource,
      scale: [window.__game.scale.width, window.__game.scale.height],
      telegramViewportHandlers: window.__p11Tg.count('viewportChanged'),
    }));
    assert.equal(maxState.source, 'max', 'the MAX bridge must take over the viewport source');
    assert.equal(maxState.scale[1], 580, 'the MAX viewport must be applied to the real frame');
    assert.ok(maxState.telegramViewportHandlers < telegramHandlersBefore,
      'Telegram listeners must be released when the adapter changes');
    mark('platform transfer: Telegram -> MAX applies the MAX viewport and releases Telegram listeners', maxState);

    await page.evaluate(() => {
      delete window.WebApp;
      delete window.Telegram;
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.getElementById('game')?.dataset.viewportSource === 'browser');
    const browserState = await page.evaluate(() => ({
      source: document.getElementById('game')?.dataset.viewportSource,
      scale: [window.__game.scale.width, window.__game.scale.height],
      hasTelegram: Boolean(window.Telegram),
    }));
    assert.equal(browserState.source, 'browser', 'MAX -> Browser must fall back to the browser host');
    assert.equal(browserState.hasTelegram, false, 'the browser host must run without a Telegram SDK');
    mark('platform transfer: MAX -> Browser runs without any Telegram SDK', browserState);

    await page.evaluate(() => {
      window.Telegram = { WebApp: window.__p11Tg };
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.getElementById('game')?.dataset.viewportSource === 'telegram');
    const telegramAgain = await page.evaluate(() => ({
      source: document.getElementById('game')?.dataset.viewportSource,
      physical: window.__p11Tg.count('viewportChanged'),
      scale: [window.__game.scale.width, window.__game.scale.height],
    }));
    assert.equal(telegramAgain.source, 'telegram', 'Browser -> Telegram must restore the Telegram host');
    assert.equal(telegramAgain.physical, 1, 'returning to Telegram must create exactly one subscription');
    mark('platform transfer: Browser -> Telegram re-subscribes exactly once', telegramAgain);

    // Repeated switching must never accumulate host subscriptions.
    const switching = [];
    for (let round = 0; round < 3; round++) {
      await page.evaluate(() => {
        window.WebApp = { initData: 'qa-max-synthetic', getViewportSize: async () => ({ width: '390', height: '580' }) };
        window.dispatchEvent(new Event('ofeliya:max-bridge-ready'));
      });
      await waitUntil(sceneSnapshot, `round ${round}: the MAX viewport to apply`,
        () => document.getElementById('game')?.dataset?.viewportSource === 'max');
      const maxRound = await page.evaluate(() => ({
        source: document.getElementById('game')?.dataset.viewportSource,
        telegram: window.__p11Tg.count('viewportChanged'),
      }));
      assert.equal(maxRound.source, 'max', `round ${round} must select MAX`);
      assert.equal(maxRound.telegram, 0, `round ${round} must release the Telegram viewport subscription`);

      await page.evaluate(() => {
        delete window.WebApp;
        window.Telegram = { WebApp: window.__p11Tg };
        window.dispatchEvent(new Event('resize'));
      });
      await waitUntil(sceneSnapshot, `round ${round}: the Telegram host to return`,
        () => document.getElementById('game')?.dataset?.viewportSource === 'telegram');
      const telegramRound = await page.evaluate(() => ({
        source: document.getElementById('game')?.dataset.viewportSource,
        telegram: window.__p11Tg.count('viewportChanged'),
      }));
      assert.equal(telegramRound.telegram, 1, `round ${round} must keep exactly one Telegram subscription`);
      switching.push({ round, max: maxRound, telegram: telegramRound });
    }
    mark('platform transfer: three MAX/Telegram switching rounds never accumulate host subscriptions', {
      rounds: switching.length,
      telegramSubscriptions: switching.map(s => s.telegram.telegram),
    });

    // ---------------------------------------------------------------- Phase 9
    // Cleanup: finish the run and prove the host contract is released.
    const activationHandlersBefore = await page.evaluate(() => window.__p11Tg.count('activated'));
    await page.evaluate(() => { window.__game.scene.getScene('Game').finish(false); });
    await page.waitForFunction(() => window.__p11Tg.closingEnabled === false);
    const cleanup = await page.evaluate(async () => {
      const { ViewportManager } = await import('/src/platform/ViewportManager.ts');
      for (let i = 0; i < 3; i++) {
        const manager = new ViewportManager(document.createElement('div'));
        manager.start();
        manager.start();
        await manager.sync();
        manager.destroy();
        manager.destroy();
      }
      window.__p11DetachA();
      window.__p11DetachB();
      window.__viewportManager.destroy();
      const menu = window.__game.scene.getScene('Menu');
      return {
        closingEnabled: window.__p11Tg.closingEnabled,
        activatedHandlers: window.__p11Tg.count('activated'),
        viewportHandlers: window.__p11Tg.count('viewportChanged'),
        ready: window.__p11BridgeReady,
        menuShutdown: menu.events.listenerCount('shutdown'),
        menuResize: menu.scale.listenerCount('resize'),
      };
    });
    assert.equal(cleanup.closingEnabled, false, 'ending the run must disable the closing confirmation');
    assert.equal(cleanup.activatedHandlers, activationHandlersBefore,
      'ending the run must remove only the game-specific activation handler');
    assert.equal(cleanup.viewportHandlers, 0, 'teardown must release the Telegram viewport subscription');
    assert.equal(cleanup.ready, 1, 'the bridge must announce readiness exactly once for the whole session');
    mark('cleanup: run end disables the closing confirmation and releases the host subscriptions', cleanup);

    // The backend is deliberately unreachable in this run, so a failed score/Daily
    // request is expected product behaviour. Anything else is a real defect.
    const expectedNetworkNoise = /Failed to load resource|503 \(Service Unavailable\)|net::ERR_FAILED/;
    const unexpectedPageErrors = pageErrors.filter(e => !expectedNetworkNoise.test(e));
    const unexpectedConsoleErrors = consoleErrors.filter(e => !expectedNetworkNoise.test(e));
    const distinctConsoleErrors = [...new Set(consoleErrors)];
    assert.deepEqual(unexpectedPageErrors, [], 'the cross-flow must not raise unexpected page errors');
    assert.deepEqual(unexpectedConsoleErrors, [], 'the cross-flow must not raise unexpected console errors');
    mark('cleanup: no unexpected page or console errors', {
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      distinctConsoleErrors,
    });

    report.result = 'PASS';
  } catch (error) {
    report.result = 'FAIL';
    report.error = String(error && error.stack ? error.stack : error);
    console.error('FAILED', error);
    if (page) {
      try {
        report.diagnostics = await page.evaluate(() => ({
          ready: window.__p11BridgeReady,
          adapter: window.__p11Platform?.kind,
          source: document.getElementById('game')?.dataset?.viewportSource,
          scale: [window.__game?.scale.width, window.__game?.scale.height],
          scenes: window.__game?.scene?.scenes?.map(s => ({ key: s.scene.key, status: s.sys.settings.status })),
          collection: Boolean(window.__game?.scene?.getScene('Menu')?.children?.getByName('ofeliya-collection')),
        }));
      } catch { /* page may already be gone */ }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    try {
      fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2));
      console.log('evidence:', evidencePath);
    } catch (error) {
      console.error('REPORT ERROR', String(error));
    }
    try { await page?.close(); } catch { /* ignore */ }
    await browser?.close();
  }
  if (report.result !== 'PASS') process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
