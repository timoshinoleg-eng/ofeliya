const fs = require('fs');

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.removeItem('ofeliya_control_mode_v1');
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-controls-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Controls', last_name: 'QA' } },
      getViewportSize: async () => ({ width: '390', height: '844' }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));

  const defaultMode = await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    return {
      registry: menu.registry.get('controlMode'),
      stored: localStorage.getItem('ofeliya_control_mode_v1'),
    };
  });
  if (defaultMode.registry !== 'one-hand' || defaultMode.stored !== null) {
    throw new Error('one-hand default changed: ' + JSON.stringify(defaultMode));
  }

  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const label = menu.children.list.find(
      (obj) => obj?.type === 'Text' && typeof obj.text === 'string' && obj.text.startsWith('УПРАВЛЕНИЕ:')
    );
    if (!label) throw new Error('control selector label missing');
    const selector = menu.children.list.find(
      (obj) =>
        obj?.type === 'Rectangle' &&
        obj.input?.enabled &&
        Math.abs(obj.y - label.y - 7) < 22 &&
        obj.width > 200
    );
    if (!selector) throw new Error('control selector hit target missing');
    selector.emit('pointerup');
  });

  const toggled = await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    return {
      registry: menu.registry.get('controlMode'),
      stored: localStorage.getItem('ofeliya_control_mode_v1'),
    };
  });
  if (toggled.registry !== 'two-hand' || toggled.stored !== 'two-hand') {
    throw new Error('menu did not persist twin-stick selection: ' + JSON.stringify(toggled));
  }

  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const routed = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return {
      mode: ui.registry.get('controlMode'),
      oneHandMounted: Boolean(ui.joystick),
      twinStickMounted: Boolean(ui.twinStick),
      joy: ui.registry.get('joy'),
      aimJoy: ui.registry.get('aimJoy'),
    };
  });
  if (
    routed.mode !== 'two-hand' ||
    routed.oneHandMounted ||
    !routed.twinStickMounted ||
    !routed.aimJoy
  ) {
    throw new Error('twin-stick routing failed: ' + JSON.stringify(routed));
  }

  const cdp = await ctx.newCDPSession(page);
  const leftId = 1;
  const rightId = 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 95, y: 690, radiusX: 8, radiusY: 8, force: 1, id: leftId },
      { x: 300, y: 690, radiusX: 8, radiusY: 8, force: 1, id: rightId },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: 135, y: 650, radiusX: 8, radiusY: 8, force: 1, id: leftId },
      { x: 260, y: 625, radiusX: 8, radiusY: 8, force: 1, id: rightId },
    ],
  });
  await page.waitForTimeout(80);

  const live = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return { joy: ui.registry.get('joy'), aimJoy: ui.registry.get('aimJoy') };
  });
  const joyMag = Math.hypot(live.joy?.x ?? 0, live.joy?.y ?? 0);
  const aimMag = Math.hypot(live.aimJoy?.x ?? 0, live.aimJoy?.y ?? 0);
  if (joyMag < 0.2 || aimMag < 0.2) {
    throw new Error('simultaneous two-thumb vectors not published: ' + JSON.stringify(live));
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
  const released = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return { joy: ui.registry.get('joy'), aimJoy: ui.registry.get('aimJoy') };
  });
  if (
    Math.hypot(released.joy?.x ?? 0, released.joy?.y ?? 0) > 0.001 ||
    Math.hypot(released.aimJoy?.x ?? 0, released.aimJoy?.y ?? 0) > 0.001
  ) {
    throw new Error('twin-stick vectors did not reset on release: ' + JSON.stringify(released));
  }

  await page.evaluate(() => localStorage.setItem('ofeliya_control_mode_v1', 'one-hand'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const legacy = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return {
      mode: ui.registry.get('controlMode'),
      oneHandMounted: Boolean(ui.joystick),
      twinStickMounted: Boolean(ui.twinStick),
      aimJoy: ui.registry.get('aimJoy'),
    };
  });
  if (
    legacy.mode !== 'one-hand' ||
    !legacy.oneHandMounted ||
    legacy.twinStickMounted ||
    legacy.aimJoy !== undefined
  ) {
    throw new Error('legacy one-hand path changed: ' + JSON.stringify(legacy));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('control mode + multitouch browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
