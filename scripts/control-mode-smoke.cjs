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

async function tapControlSelector(page) {
  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const selector =
      menu.children.getByName('ofeliya-menu-control-selector') ??
      menu.children.list.find(
        (obj) =>
          obj?.type === 'Rectangle' &&
          obj.input?.enabled &&
          obj.width > 200 &&
          Math.abs(obj.y - menu.scale.height * 0.715) < 32
      );
    if (!selector) throw new Error('control selector hit target missing');
    selector.emit('pointerup');
  });
}

async function readMenuMode(page) {
  return page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const label =
      menu.children.getByName('ofeliya-menu-control-value') ??
      menu.children.list.find(
        (obj) => obj?.type === 'Text' && typeof obj.text === 'string' && obj.text.startsWith('УПРАВЛЕНИЕ:')
      );
    return {
      registry: menu.registry.get('controlMode'),
      stored: localStorage.getItem('ofeliya_control_mode_v1'),
      label: label?.text || '',
    };
  });
}

function mag(v) {
  return Math.hypot(v?.x ?? 0, v?.y ?? 0);
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
    if (!sessionStorage.getItem('ofeliya_control_smoke_initialized')) {
      localStorage.removeItem('ofeliya_control_mode_v1');
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
      sessionStorage.setItem('ofeliya_control_smoke_initialized', '1');
    }
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

  const defaultMode = await readMenuMode(page);
  if (defaultMode.registry !== 'one-hand' || defaultMode.stored !== null) {
    throw new Error('one-hand default changed: ' + JSON.stringify(defaultMode));
  }

  // Menu cycle must preserve both established modes and expose the third mode.
  await tapControlSelector(page);
  const twinSelected = await readMenuMode(page);
  if (twinSelected.registry !== 'two-hand' || twinSelected.stored !== 'two-hand') {
    throw new Error('menu did not persist twin-stick selection: ' + JSON.stringify(twinSelected));
  }

  await tapControlSelector(page);
  const dualSelected = await readMenuMode(page);
  if (
    dualSelected.registry !== 'dual-move' ||
    dualSelected.stored !== 'dual-move' ||
    !dualSelected.label.includes('ДВЕ РУКИ · ДВИЖЕНИЕ')
  ) {
    throw new Error('menu did not expose dual-move selection: ' + JSON.stringify(dualSelected));
  }

  await tapControlSelector(page);
  const wrapped = await readMenuMode(page);
  if (wrapped.registry !== 'one-hand' || wrapped.stored !== 'one-hand') {
    throw new Error('control selector did not wrap to one-hand: ' + JSON.stringify(wrapped));
  }

  // Return to the established twin-stick path and prove it behaves exactly as before.
  await tapControlSelector(page);
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
      dualMoveMounted: Boolean(ui.dualMove),
      joy: ui.registry.get('joy'),
      aimJoy: ui.registry.get('aimJoy'),
    };
  });
  if (
    routed.mode !== 'two-hand' ||
    routed.oneHandMounted ||
    !routed.twinStickMounted ||
    routed.dualMoveMounted ||
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
  if (mag(live.joy) < 0.2 || mag(live.aimJoy) < 0.2) {
    throw new Error('simultaneous twin-stick vectors not published: ' + JSON.stringify(live));
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(80);
  const released = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return { joy: ui.registry.get('joy'), aimJoy: ui.registry.get('aimJoy') };
  });
  if (mag(released.joy) > 0.001 || mag(released.aimJoy) > 0.001) {
    throw new Error('twin-stick vectors did not reset on release: ' + JSON.stringify(released));
  }

  // New movement-only two-thumb profile.
  await page.evaluate(() => localStorage.setItem('ofeliya_control_mode_v1', 'dual-move'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );

  const dual = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const controls = ui.dualMove;
    return {
      mode: ui.registry.get('controlMode'),
      oneHandMounted: Boolean(ui.joystick),
      twinStickMounted: Boolean(ui.twinStick),
      dualMoveMounted: Boolean(controls),
      aimJoy: ui.registry.get('aimJoy'),
      joy: ui.registry.get('joy'),
      left: controls
        ? {
            x: controls.left.centerX,
            y: controls.left.centerY,
            visible: controls.left.base.visible && controls.left.knob.visible,
            alpha: controls.left.base.alpha,
          }
        : null,
      right: controls
        ? {
            x: controls.right.centerX,
            y: controls.right.centerY,
            visible: controls.right.base.visible && controls.right.knob.visible,
            alpha: controls.right.base.alpha,
          }
        : null,
    };
  });

  if (
    dual.mode !== 'dual-move' ||
    dual.oneHandMounted ||
    dual.twinStickMounted ||
    !dual.dualMoveMounted ||
    dual.aimJoy !== undefined ||
    !dual.left?.visible ||
    !dual.right?.visible ||
    dual.left.alpha < 0.14 ||
    dual.left.alpha > 0.22
  ) {
    throw new Error('dual-move routing/idle pads failed: ' + JSON.stringify(dual));
  }

  const leftCenter = { x: Math.round(dual.left.x), y: Math.round(dual.left.y) };
  const rightCenter = { x: Math.round(dual.right.x), y: Math.round(dual.right.y) };

  // Freeze combat randomness while testing the pure input router. UI remains active.
  await page.evaluate(() => window.__game.scene.pause('Game'));

  // Left thumb alone moves.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...leftCenter, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: leftCenter.x + 36, y: leftCenter.y - 30, radiusX: 8, radiusY: 8, force: 1, id: 1 },
    ],
  });
  await page.waitForTimeout(80);
  const leftOnly = await page.evaluate(() => ({
    joy: window.__game.registry.get('joy'),
    aimJoy: window.__game.registry.get('aimJoy'),
  }));
  if (mag(leftOnly.joy) < 0.35 || (leftOnly.joy?.x ?? 0) <= 0.2 || leftOnly.aimJoy !== undefined) {
    throw new Error('left dual-move thumb failed: ' + JSON.stringify(leftOnly));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(70);

  // Right thumb alone moves using the same joy channel.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...rightCenter, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: rightCenter.x - 38, y: rightCenter.y - 28, radiusX: 8, radiusY: 8, force: 1, id: 1 },
    ],
  });
  await page.waitForTimeout(80);
  const rightOnly = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return {
      joy: window.__game.registry.get('joy'),
      aimJoy: window.__game.registry.get('aimJoy'),
      left: ui.dualMove
        ? {
            active: ui.dualMove.left.active,
            pointerId: ui.dualMove.left.pointerId,
            vectorX: ui.dualMove.left.vectorX,
            vectorY: ui.dualMove.left.vectorY,
          }
        : null,
      right: ui.dualMove
        ? {
            active: ui.dualMove.right.active,
            pointerId: ui.dualMove.right.pointerId,
            vectorX: ui.dualMove.right.vectorX,
            vectorY: ui.dualMove.right.vectorY,
          }
        : null,
      uiBlocked: ui.uiBlocked,
      modalOpen: ui.modalOpen,
      gamePaused: window.__game.scene.isPaused('Game'),
    };
  });
  if (mag(rightOnly.joy) < 0.35 || (rightOnly.joy?.x ?? 0) >= -0.2 || rightOnly.aimJoy !== undefined) {
    throw new Error('right dual-move thumb failed: ' + JSON.stringify(rightOnly));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(70);

  // Two thumbs: most recently moved thumb owns movement, then releasing it hands off to the other.
  const l = { x: leftCenter.x + 36, y: leftCenter.y - 18 };
  const r = { x: rightCenter.x - 38, y: rightCenter.y + 18 };
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { ...leftCenter, radiusX: 8, radiusY: 8, force: 1, id: 1 },
      { ...rightCenter, radiusX: 8, radiusY: 8, force: 1, id: 2 },
    ],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { ...l, radiusX: 8, radiusY: 8, force: 1, id: 1 },
      { ...rightCenter, radiusX: 8, radiusY: 8, force: 1, id: 2 },
    ],
  });
  await page.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { ...l, radiusX: 8, radiusY: 8, force: 1, id: 1 },
      { ...r, radiusX: 8, radiusY: 8, force: 1, id: 2 },
    ],
  });
  await page.waitForTimeout(80);

  const rightWins = await page.evaluate(() => window.__game.registry.get('joy'));
  if ((rightWins?.x ?? 0) >= -0.2) {
    throw new Error('latest dual-move thumb did not take control: ' + JSON.stringify(rightWins));
  }

  // CDP touchEnd cannot reliably synthesize "lift one finger, keep the other" across runners.
  // The two-thumb start/move above is real touch; invoke the production release path directly
  // for the right stick to verify the actual handoff algorithm deterministically.
  await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    ui.dualMove.release(ui.dualMove.right);
  });
  await page.waitForTimeout(100);
  const handedOff = await page.evaluate(() => window.__game.registry.get('joy'));
  if ((handedOff?.x ?? 0) <= 0.2) {
    throw new Error('dual-move handoff after release failed: ' + JSON.stringify(handedOff));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(70);
  await page.evaluate(() => window.__game.scene.resume('Game'));
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && !window.__game.scene.isPaused('Game'));

  // Active movement must be cleared by Pause and stay cleared while Game is paused.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...leftCenter, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: leftCenter.x + 34, y: leftCenter.y - 24, radiusX: 8, radiusY: 8, force: 1, id: 1 },
    ],
  });
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__game.scene.getScene('UI').pauseHit.emit('pointerup'));
  await page.waitForFunction(() => window.__game.scene.isPaused('Game'));
  const paused = await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    return {
      joy: ui.registry.get('joy'),
      leftActive: ui.dualMove.left.active,
      rightActive: ui.dualMove.right.active,
    };
  });
  if (mag(paused.joy) > 0.001 || paused.leftActive || paused.rightActive) {
    throw new Error('dual-move input survived Pause: ' + JSON.stringify(paused));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate(() => window.__game.scene.getScene('UI').closePauseMenu(true));
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && !window.__game.scene.isPaused('Game'));

  // Stage transition blocks both movement pads.
  await page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    ui.showStageTransition('КРОВОТОК', 'СЕРДЦЕ', 0xff4fb5, () => {});
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...rightCenter, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: rightCenter.x - 34, y: rightCenter.y - 24, radiusX: 8, radiusY: 8, force: 1, id: 1 },
    ],
  });
  await page.waitForTimeout(70);
  const duringTransition = await page.evaluate(() => window.__game.registry.get('joy'));
  if (mag(duringTransition) > 0.001) {
    throw new Error('dual-move input leaked through stage transition: ' + JSON.stringify(duringTransition));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate(() => window.__game.scene.getScene('UI').hideStageTransition());

  // Mutation modal also blocks/reset movement.
  await page.evaluate(() => window.__game.scene.getScene('UI').showLevelUp());
  await page.waitForFunction(() => window.__game.scene.isPaused('Game'));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...leftCenter, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: leftCenter.x + 34, y: leftCenter.y - 24, radiusX: 8, radiusY: 8, force: 1, id: 1 },
    ],
  });
  await page.waitForTimeout(70);
  const duringMutation = await page.evaluate(() => window.__game.registry.get('joy'));
  if (mag(duringMutation) > 0.001) {
    throw new Error('dual-move input leaked through mutation modal: ' + JSON.stringify(duringMutation));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate(() => window.__game.scene.getScene('UI').dismissProgressionForStageBoundary());
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && !window.__game.scene.isPaused('Game'));

  // Established one-hand path remains unchanged.
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
      dualMoveMounted: Boolean(ui.dualMove),
      aimJoy: ui.registry.get('aimJoy'),
    };
  });
  if (
    legacy.mode !== 'one-hand' ||
    !legacy.oneHandMounted ||
    legacy.twinStickMounted ||
    legacy.dualMoveMounted ||
    legacy.aimJoy !== undefined
  ) {
    throw new Error('legacy one-hand path changed: ' + JSON.stringify(legacy));
  }

  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  await browser.close();
  console.log('control modes + dual-move multitouch browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
