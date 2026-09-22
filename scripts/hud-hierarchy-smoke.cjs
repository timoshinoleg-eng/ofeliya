const fs = require('fs');
const path = require('path');

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

// Defaults to the same dev-server origin the other browser gates use.
const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A1-A11 viewports (the ladder named by the HUD slice) plus two optional capture sizes.
const ASSERT_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 600 },
  { width: 390, height: 740 },
  { width: 412, height: 915 },
];
const SHOT_ONLY_VIEWPORTS = [
  { width: 360, height: 760 },
  { width: 390, height: 844 },
];
const KILL_VALUES = [0, 99, 999, 2142, 5560, 99999];
const RESULT_BUTTONS = ['ЕЩЁ ОДИН ЦИКЛ', 'БРОСИТЬ ВЫЗОВ', 'В МЕНЮ'];

// Pinned HUD geometry contract - mirrors `src/ui/hudTokens.ts` (SLICE-HUD-01R).
const HUD = {
  plateTop: 5,
  plateHeight: 90,
  platePad: 6,
  xpX: 12,
  xpY: 12,
  xpH: 10,
  xpPadX: 12,
  xpReserveRight: 168,
  timerY: 28,
  killsY: 9,
  killsPadX: 16,
  hpY: 54,
  hpH: 12,
  hpTextY: 56,
  bossLabelY: 72,
  bossBarY: 82,
  bossBarH: 11,
  hpPad: 156,
  hpMaxW: 200,
  bossPad: 32,
  bossMaxW: 280,
  type: { timer: 24, level: 15, kills: 14, hp: 12, boss: 13, combo: 18 },
  plateAlphaMin: 0.45,
  plateAlphaMax: 0.5,
  hit: { primary: 44, secondary: 24, secondaryH: 44 },
  pauseRight: 52,
  pauseY: 65,
  pauseW: 34,
  pauseH: 30,
  pauseFill: 0x141a2e,
  pauseFillAlpha: 0.92,
  pauseStroke: 0x8fe8ff,
  pauseStrokeAlpha: 0.72,
  mutePadX: 16,
  muteY: 54,
};

const round1 = (value) => Math.round(value * 10) / 10;

function expectedMetrics(W) {
  const xpW = W - HUD.xpPadX - HUD.xpReserveRight;
  const hpW = Math.min(W - HUD.hpPad, HUD.hpMaxW);
  const bossW = Math.min(W - HUD.bossPad, HUD.bossMaxW);
  return {
    xpX: HUD.xpPadX,
    xpW,
    xpH: HUD.xpH,
    hpX: W / 2 - hpW / 2,
    hpW,
    bossX: W / 2 - bossW / 2,
    bossW,
  };
}

function expectedPauseZone(W) {
  const cx = W - HUD.pauseRight;
  const half = HUD.hit.primary / 2;
  return { l: cx - half, r: cx + half, t: HUD.pauseY - half, b: HUD.pauseY + half, w: HUD.hit.primary, h: HUD.hit.primary };
}

function expectedMuteZone(W) {
  return {
    l: W - HUD.mutePadX - 14,
    r: W - HUD.mutePadX + 10,
    t: HUD.muteY - 14,
    b: HUD.muteY - 14 + HUD.hit.secondaryH,
    w: HUD.hit.secondary,
    h: HUD.hit.secondaryH,
  };
}

function makeCheck(failures) {
  return (ok, message) => { if (!ok) failures.push(message); };
}

const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
const rectsDisjoint = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
const insideRect = (inner, outer, eps = 0) =>
  inner.l >= outer.l - eps && inner.r <= outer.r + eps && inner.t >= outer.t - eps && inner.b <= outer.b + eps;

async function readHud(page) {
  return page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const W = window.__game.scale.width;
    const H = window.__game.scale.height;
    const bounds = (o) => {
      const bb = o.getBounds();
      return { l: bb.left, r: bb.right, t: bb.top, b: bb.bottom };
    };
    const zone = (o) => {
      const ha = o.input.hitArea;
      return {
        l: o.x - o.displayOriginX + ha.x,
        t: o.y - o.displayOriginY + ha.y,
        r: o.x - o.displayOriginX + ha.x + ha.width,
        b: o.y - o.displayOriginY + ha.y + ha.height,
        w: ha.width,
        h: ha.height,
      };
    };
    const plate = ui.hudBackdrop.getBounds();
    return {
      W,
      H,
      metrics: ui.hudMetrics(W),
      plate: { l: plate.left, r: plate.right, t: plate.top, b: plate.bottom, fillAlpha: ui.hudBackdrop.fillAlpha, displayHeight: ui.hudBackdrop.displayHeight, displayWidth: ui.hudBackdrop.displayWidth },
      kills: bounds(ui.killsText),
      timer: bounds(ui.timerText),
      level: bounds(ui.levelText),
      hpText: bounds(ui.hpText),
      bossLabel: bounds(ui.bossLabel),
      muteText: bounds(ui.muteText),
      sizes: {
        timer: parseFloat(String(ui.timerText.style.fontSize)) || 0,
        level: parseFloat(String(ui.levelText.style.fontSize)) || 0,
        kills: parseFloat(String(ui.killsText.style.fontSize)) || 0,
        hp: parseFloat(String(ui.hpText.style.fontSize)) || 0,
        boss: parseFloat(String(ui.bossLabel.style.fontSize)) || 0,
        combo: parseFloat(String(ui.comboText.style.fontSize)) || 0,
      },
      pauseRect: { x: ui.pauseHit.x, y: ui.pauseHit.y, w: ui.pauseHit.width, h: ui.pauseHit.height, bounds: bounds(ui.pauseHit) },
      pauseVisual: {
        fillColor: ui.pauseHit.fillColor,
        fillAlpha: ui.pauseHit.fillAlpha,
        isStroked: ui.pauseHit.isStroked,
        strokeColor: ui.pauseHit.strokeColor,
        strokeAlpha: ui.pauseHit.strokeAlpha,
      },
      pauseZone: zone(ui.pauseHit),
      muteZone: zone(ui.muteText),
      drawn: {
        xp: Array.isArray(ui.xpBack.commandBuffer) ? ui.xpBack.commandBuffer.length : 0,
        hp: Array.isArray(ui.hpBack.commandBuffer) ? ui.hpBack.commandBuffer.length : 0,
        boss: Array.isArray(ui.bossBack.commandBuffer) ? ui.bossBack.commandBuffer.length : 0,
      },
      visible: {
        bossLabel: ui.bossLabel.visible,
        combo: ui.comboText.visible,
      },
      killsAlpha: ui.killsText.alpha,
    };
  });
}

function assertHud(size, c, pauseZone, muteZone) {
  const failures = [];
  const check = makeCheck(failures);
  const W = size.width;
  const exp = expectedMetrics(W);
  const plate = { l: HUD.platePad, r: W - HUD.platePad, t: HUD.plateTop, b: HUD.plateTop + HUD.plateHeight };

  // A11 + A4 plate
  check(near(c.plate.displayHeight, HUD.plateHeight, 0.01), `A11 plate displayHeight ${c.plate.displayHeight} != ${HUD.plateHeight}`);
  check(near(c.plate.l, plate.l, 0.5) && near(c.plate.r, plate.r, 0.5) && near(c.plate.t, plate.t, 0.5) && near(c.plate.b, plate.b, 0.5), `A4 plate bounds ${JSON.stringify(c.plate)} != ${JSON.stringify(plate)}`);

  // A5 plate contrast
  check(c.plate.fillAlpha >= HUD.plateAlphaMin && c.plate.fillAlpha <= HUD.plateAlphaMax, `A5 plate fillAlpha ${c.plate.fillAlpha} not in [${HUD.plateAlphaMin}, ${HUD.plateAlphaMax}]`);

  // A6 bar metrics
  for (const key of ['xpX', 'xpW', 'xpH', 'hpX', 'hpW', 'bossX', 'bossW']) {
    check(near(c.metrics[key], exp[key], 0.5), `A6 metrics.${key} ${c.metrics[key]} != ${exp[key]}`);
  }
  check(c.drawn.xp > 0 && c.drawn.hp > 0, `A6 HUD bars not drawn (xp=${c.drawn.xp}, hp=${c.drawn.hp})`);

  // A7 type floors
  check(c.sizes.timer >= HUD.type.timer, `A7 timer ${c.sizes.timer} < ${HUD.type.timer}`);
  check(c.sizes.level >= HUD.type.level, `A7 level ${c.sizes.level} < ${HUD.type.level}`);
  check(c.sizes.kills >= HUD.type.kills, `A7 kills ${c.sizes.kills} < ${HUD.type.kills}`);
  check(c.sizes.hp >= HUD.type.hp, `A7 hp ${c.sizes.hp} < ${HUD.type.hp}`);
  check(c.sizes.boss >= HUD.type.boss, `A7 boss ${c.sizes.boss} < ${HUD.type.boss}`);
  check(c.sizes.combo >= HUD.type.combo, `A7 combo ${c.sizes.combo} < ${HUD.type.combo}`);

  // A8 hit areas (sizes + resolved screen zones)
  check(c.pauseZone.w >= HUD.hit.primary && c.pauseZone.h >= HUD.hit.primary, `A8 pause hit ${c.pauseZone.w}x${c.pauseZone.h} < ${HUD.hit.primary}`);
  check(c.muteZone.w >= HUD.hit.secondary && c.muteZone.h >= HUD.hit.secondaryH, `A8 mute hit ${c.muteZone.w}x${c.muteZone.h} < ${HUD.hit.secondary}x${HUD.hit.secondaryH}`);
  const pz = expectedPauseZone(W);
  const mz = expectedMuteZone(W);
  for (const key of ['l', 'r', 't', 'b']) {
    check(near(c.pauseZone[key], pz[key], 1), `A8 pause zone.${key} ${c.pauseZone[key]} != ${pz[key]}`);
    check(near(c.muteZone[key], mz[key], 1), `A8 mute zone.${key} ${c.muteZone[key]} != ${mz[key]}`);
  }

  // A9 zone relations + plate containment
  check(insideRect({ l: c.pauseZone.l, r: c.pauseZone.r, t: c.pauseZone.t, b: c.pauseZone.b }, plate, 0.5), `A9 pause zone outside plate ${JSON.stringify(c.pauseZone)}`);
  check(c.pauseZone.r <= c.muteZone.l + 1, `A9 pause.right ${c.pauseZone.r} > mute.left ${c.muteZone.l} + 1`);
  check(c.muteZone.r <= plate.r + 1, `A9 mute.right ${c.muteZone.r} > plate.right ${plate.r}`);

  // A10 pause visual recipe preserved
  check(near(c.pauseRect.w, HUD.pauseW, 0.01) && near(c.pauseRect.h, HUD.pauseH, 0.01), `A10 pause visual ${c.pauseRect.w}x${c.pauseRect.h} != ${HUD.pauseW}x${HUD.pauseH}`);
  check(c.pauseVisual.fillColor === HUD.pauseFill, `A10 pause fill ${c.pauseVisual.fillColor} != ${HUD.pauseFill}`);
  check(near(c.pauseVisual.fillAlpha, HUD.pauseFillAlpha, 0.001), `A10 pause fillAlpha ${c.pauseVisual.fillAlpha} != ${HUD.pauseFillAlpha}`);
  check(c.pauseVisual.isStroked === true, 'A10 pause not stroked');
  check(c.pauseVisual.strokeColor === HUD.pauseStroke, `A10 pause stroke ${c.pauseVisual.strokeColor} != ${HUD.pauseStroke}`);
  check(near(c.pauseVisual.strokeAlpha, HUD.pauseStrokeAlpha, 0.001), `A10 pause strokeAlpha ${c.pauseVisual.strokeAlpha} != ${HUD.pauseStrokeAlpha}`);

  // A1/A2/A3/A4 per kill value
  const xpBar = { l: c.metrics.xpX, r: c.metrics.xpX + c.metrics.xpW, t: HUD.xpY, b: HUD.xpY + HUD.xpH };
  const hpBar = { l: c.metrics.hpX, r: c.metrics.hpX + c.metrics.hpW, t: HUD.hpY, b: HUD.hpY + HUD.hpH };
  const bossBar = { l: c.metrics.bossX, r: c.metrics.bossX + c.metrics.bossW, t: HUD.bossBarY, b: HUD.bossBarY + HUD.bossBarH };
  const pauseRect = { l: c.pauseRect.x - HUD.pauseW / 2, r: c.pauseRect.x + HUD.pauseW / 2, t: c.pauseRect.y - HUD.pauseH / 2, b: c.pauseRect.y + HUD.pauseH / 2 };

  for (const value of c.killSamples) {
    const kills = value.bounds;
    check(rectsDisjoint(kills, c.timer), `A1 kills ${value.kills} ${JSON.stringify(kills)} overlaps timer ${JSON.stringify(c.timer)}`);
    check(kills.l >= xpBar.r + 3, `A2 kills ${value.kills} left ${kills.l} < xp.right ${xpBar.r} + 3`);
    check(xpBar.r <= kills.l, `A2 xp.right ${xpBar.r} > kills.left ${kills.l}`);
  }
  check(c.level.r <= c.timer.l - 8, `A2 level.right ${c.level.r} > timer.left ${c.timer.l} - 8`);
  check(rectsDisjoint(c.hpText, c.bossLabel), `A3 hpText ${JSON.stringify(c.hpText)} overlaps bossLabel ${JSON.stringify(c.bossLabel)}`);
  check(rectsDisjoint(hpBar, pauseRect), `A3 HP bar ${JSON.stringify(hpBar)} overlaps pause rect ${JSON.stringify(pauseRect)}`);

  for (const [name, rect] of [
    ['kills', c.killSamples[c.killSamples.length - 1].bounds],
    ['timer', c.timer],
    ['level', c.level],
    ['hpText', c.hpText],
    ['bossLabel', c.bossLabel],
    ['muteText', c.muteText],
    ['xpBar', xpBar],
    ['hpBar', hpBar],
    ['bossBar', bossBar],
    ['pauseRect', pauseRect],
  ]) {
    check(insideRect(rect, plate, 1), `A4 ${name} ${JSON.stringify(rect)} outside plate ${JSON.stringify(plate)}`);
  }

  if (failures.length) {
    throw new Error(`HUD hierarchy contract failed at ${W}x${size.height}: ${JSON.stringify(failures)}`);
  }
}

async function contextFor(browser, size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ width, height }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    sessionStorage.clear();
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-hud-hierarchy',
      initDataUnsafe: {
        user: { id: 42, first_name: 'QA', last_name: 'HUD' },
        start_param: 'sz1_s_2n9c_26_4_9_l',
      },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      shareMaxContent: async () => {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, size);
  return ctx;
}

async function bootFrozen(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 45000 });
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'), null, { timeout: 45000 });
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    gs.awaitingChoice = false;
    gs.pendingChoices = [];
    gs.queuedLevels = 0;
    gs.wave.update = () => {};
    gs.runState.stage.xp = 0;
    gs.runState.stage.xpNext = 1_000_000;
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;
    for (const enemy of gs.enemies.getChildren()) if (enemy.active) enemy.disableBody?.(true, true);
    ui.dismissProgressionForStageBoundary();
    window.__game.registry.set('joy', { x: 0, y: 0 });
  });
  await sleep(220);
}

async function setKills(page, kills) {
  await page.evaluate((value) => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.run.kills = value;
  }, kills);
  await sleep(110);
}

async function hudContract(page) {
  const base = await readHud(page);
  const killSamples = [];
  for (const kills of KILL_VALUES) {
    await setKills(page, kills);
    const sample = await readHud(page);
    killSamples.push({ kills, bounds: sample.kills });
  }
  await setKills(page, 0);
  return { ...base, killSamples };
}

async function shoot(page, captureDir, name) {
  await page.locator('#game').screenshot({ path: path.join(captureDir, name) });
}

async function modalContract(page) {
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.queuedLevels = 1;
  });
  await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen === true, null, { timeout: 15000 });
  await sleep(160);
  return page.evaluate(() => {
    const ui = window.__game.scene.getScene('UI');
    const W = window.__game.scale.width;
    const H = window.__game.scale.height;
    const flat = [];
    const visit = (obj) => { flat.push(obj); if (Array.isArray(obj?.list)) obj.list.forEach(visit); };
    if (ui.modal) visit(ui.modal);
    const texts = [];
    for (const obj of flat) {
      if (typeof obj.text !== 'string' || obj.visible === false) continue;
      const bb = obj.getBounds();
      texts.push({ text: obj.text, l: bb.left, r: bb.right, t: bb.top, b: bb.bottom });
    }
    return { W, H, hasModal: Boolean(ui.modal), texts };
  });
}

async function resultContract(page) {
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    ui.dismissProgressionForStageBoundary();
    gs.runState.run.timeMs = 130000;
    gs.runState.run.kills = 90;
    gs.runState.run.hostCellsInfected = 5;
    gs.runState.stage.level = 10;
    gs.runState.run.comboBest = 24;
    gs.finish(false);
  });
  await page.waitForFunction(() => {
    const ui = window.__game.scene.getScene('UI');
    return Boolean(ui.children.list.find((obj) => obj?.name === 'ofeliya-result'));
  }, null, { timeout: 15000 });
  await sleep(160);
  return page.evaluate((buttonLabels) => {
    const ui = window.__game.scene.getScene('UI');
    const W = window.__game.scale.width;
    const H = window.__game.scale.height;
    const container = ui.children.list.find((obj) => obj?.name === 'ofeliya-result');
    const texts = container.list.filter((obj) => typeof obj.text === 'string');
    const visible = texts.filter((obj) => obj.visible !== false && (obj.alpha ?? 1) > 0.01 && typeof obj.getBounds === 'function');
    const overflow = visible
      .map((obj) => ({ text: obj.text, bounds: obj.getBounds() }))
      .filter(({ bounds }) => bounds.left < 1 || bounds.right > W - 1 || bounds.top < 1 || bounds.bottom > H - 1)
      .map(({ text, bounds }) => ({ text, left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom }));
    const buttons = buttonLabels.map((label) => {
      const text = texts.find((obj) => obj.text === label);
      const bg = text && container.list.find((obj) => obj !== text && obj.input?.enabled && Math.abs((obj.y ?? -9999) - text.y) < 1 && typeof obj.getBounds === 'function');
      const tb = text?.getBounds?.();
      const bb = bg?.getBounds?.();
      return { label, ok: !!tb && !!bb && tb.left >= bb.left + 4 && tb.right <= bb.right - 4 && tb.top >= bb.top + 1 && tb.bottom <= bb.bottom - 1 };
    });
    return { W, H, overflow, buttons };
  }, RESULT_BUTTONS);
}

function assertContainment(kind, label, contract) {
  const failures = [];
  const margin = 1;
  if (kind === 'modal') {
    if (!contract.hasModal) failures.push('mutation modal did not open');
    for (const t of contract.texts) {
      if (t.l < margin || t.r > contract.W - margin || t.t < margin || t.b > contract.H - margin) {
        failures.push(`modal text outside viewport: ${JSON.stringify(t)}`);
      }
    }
  } else {
    for (const o of contract.overflow) failures.push(`result overflow: ${JSON.stringify(o)}`);
    for (const b of contract.buttons) if (!b.ok) failures.push(`result button padding failed: ${b.label}`);
  }
  if (failures.length) {
    throw new Error(`${kind} containment failed at ${label}: ${JSON.stringify(failures)}`);
  }
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const captureDir = process.platform === 'win32'
    ? path.join(process.cwd(), '.tmp-browser-smoke')
    : '/tmp/browser-smoke';
  fs.mkdirSync(captureDir, { recursive: true });

  const pageErrors = [];
  const label = (s) => `${s.width}x${s.height}`;

  // Warm the dev server (first request pays Vite dependency pre-bundling).
  {
    const ctx = await contextFor(browser, { width: 360, height: 640 });
    const page = await ctx.newPage();
    await bootFrozen(page);
    await ctx.close();
  }

  for (const size of ASSERT_VIEWPORTS) {
    const ctx = await contextFor(browser, size);
    const page = await ctx.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${label(size)}: ${String(error)}`));
    await bootFrozen(page);

    const contract = await hudContract(page);
    assertHud(size, contract, expectedPauseZone(size.width), expectedMuteZone(size.width));

    if (size.width === 320 && size.height === 568) {
      await shoot(page, captureDir, '05-hud-320x568.png');
      await setKills(page, 5560);
      await shoot(page, captureDir, '05-hud-320x568-kills-5560.png');
      await setKills(page, 0);

      // boss active + low HP
      await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        gs.runState.stage.hp = 1_000_000;
        gs.runState.stage.maxHp = 1_000_000;
        const boss = gs.spawnEnemy('boss', gs.player.x + 120, gs.player.y, false);
        gs.wave.boss = boss;
      });
      await page.waitForFunction(() => window.__game.scene.getScene('UI').bossLabel.visible === true, null, { timeout: 15000 });
      await sleep(1500);
      const bossState = await readHud(page);
      const bossFailures = [];
      const bc = makeCheck(bossFailures);
      bc(bossState.visible.bossLabel === true, 'boss label not visible');
      bc(bossState.drawn.boss > 0, 'boss bar not drawn');
      bc(near(bossState.killsAlpha, 1, 0.001), `A12 HUD alpha not restored after boss reveal: ${bossState.killsAlpha}`);
      bc(near(bossState.metrics.bossW, Math.min(size.width - HUD.bossPad, HUD.bossMaxW), 0.5), `boss width ${bossState.metrics.bossW}`);
      await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        gs.runState.stage.hp = 40;
        gs.runState.stage.maxHp = 1000;
      });
      await sleep(160);
      await shoot(page, captureDir, '05-hud-320x568-boss.png');
      await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        gs.wave.boss = null;
      });
      await sleep(160);
      if (bossFailures.length) throw new Error(`boss HUD contract failed at ${label(size)}: ${JSON.stringify(bossFailures)}`);

      // pause overlay capture (real pointerup path)
      await page.evaluate(() => window.__game.scene.getScene('UI').pauseHit.emit('pointerup'));
      await page.waitForFunction(() => window.__game.scene.getScene('UI').manualPaused === true, null, { timeout: 8000 });
      await sleep(160);
      await shoot(page, captureDir, '05-hud-320x568-paused.png');
    }

    if (size.width === 360 && size.height === 600) {
      await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        gs.runState.stage.combo = 24;
      });
      await sleep(160);
      const comboState = await readHud(page);
      if (comboState.visible.combo !== true) throw new Error('combo not visible at 360x600');
      await shoot(page, captureDir, '05-hud-360x600.png');
    }

    if (size.width === 390 && size.height === 740) {
      await page.evaluate(() => {
        const gs = window.__game.scene.getScene('Game');
        gs.runState.stage.combo = 0;
      });
      await sleep(140);
      await shoot(page, captureDir, '05-hud-390x740.png');
    }

    if (size.width === 412 && size.height === 915) {
      await shoot(page, captureDir, '05-hud-412x915.png');
    }

    if ((size.width === 360 && size.height === 600) || (size.width === 390 && size.height === 740)) {
      const modal = await modalContract(page);
      assertContainment('modal', label(size), modal);
      const result = await resultContract(page);
      assertContainment('result', label(size), result);
    }

    await ctx.close();
  }

  for (const size of SHOT_ONLY_VIEWPORTS) {
    const ctx = await contextFor(browser, size);
    const page = await ctx.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${label(size)}: ${String(error)}`));
    await bootFrozen(page);
    await readHud(page);
    await shoot(page, captureDir, `05-hud-${label(size)}.png`);
    await ctx.close();
  }

  await browser.close();
  if (pageErrors.length) throw new Error('page errors: ' + pageErrors.join(' | '));
  console.log(
    `hud hierarchy contract: ok (${[...ASSERT_VIEWPORTS, ...SHOT_ONLY_VIEWPORTS].map((s) => `${s.width}x${s.height}`).join(', ')}; kills ${KILL_VALUES.join('/')})`
  );
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});