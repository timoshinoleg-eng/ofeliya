const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 360, height: 760 },
  { width: 390, height: 740 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];
const captureDir = path.join(process.cwd(), '.tmp-comprehension-smoke');

async function prepareContext(context, runs) {
  await context.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await context.addInitScript((runCount) => {
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-comprehension-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Comprehension', last_name: 'Smoke' } },
      getViewportSize: async () => ({ width: String(innerWidth), height: String(innerHeight) }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: runCount }));
  }, runs);
}

async function bootGame(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => {
    const game = window.__game;
    const scene = game.scene.getScene('Game');
    scene.events.once('create', () => {
      window.__startupIntroVisible = Boolean(scene.introHint?.active);
      scene.scene.pause('Game');
    });
    game.scene.getScene('Menu').scene.start('Game');
  });
  await page.waitForFunction(() => {
    const game = window.__game;
    if (!game) return false;
    const scene = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');
    return Boolean(scene?.enemyHealth && ui && (game.scene.isActive('Game') || game.scene.isPaused('Game')));
  });
  await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    const ui = game.scene.getScene('UI');
    gs.awaitingChoice = false;
    gs.pendingChoices = [];
    gs.queuedLevels = 0;
    gs.runState.stage.xp = 0;
    gs.runState.stage.xpNext = 1_000_000;
    gs.runState.stage.hp = 1_000_000;
    gs.runState.stage.maxHp = 1_000_000;
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;
    gs.wave.update = () => {};
    for (const enemy of gs.enemies.getChildren()) if (enemy.active) enemy.deactivateForStageReset();
    for (const bullet of gs.bullets.getChildren()) if (bullet.active) bullet.deactivateForStageReset();
    for (const gem of gs.gems.getChildren()) if (gem.active) gem.deactivateForStageReset();
    ui.dismissProgressionForStageBoundary();
    if (game.scene.isPaused('Game')) game.scene.resume('Game');
    game.registry.set('joy', { x: 0, y: 0 });
    gs.physics.world.pause();
    gs.scene.pause('Game');
    ui.rnaPickupTimer?.remove(false);
    ui.rnaPickupTimer = null;
    ui.rnaPickupTotal = 0;
    ui.rnaPickupText.setVisible(false).setText('');
    ui.tweens.killTweensOf(ui.rnaPickupText);
  });
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.mkdirSync(captureDir, { recursive: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 740 },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });
    await prepareContext(context, 0);
    const events = [];
    await context.route('**/api/event', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        try { events.push(JSON.parse(request.postData() || '{}')); } catch {}
      }
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await bootGame(page);

    const setup = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      const hintMessages = [];
      window.__comprehensionHintMessages = hintMessages;
      const showHint = ui.showContextHint.bind(ui);
      ui.showContextHint = (message, duration) => { hintMessages.push(message); showHint(message, duration); };
      const startupIntroVisible = Boolean(window.__startupIntroVisible);
      gs.queuedLevels = 1;
      gs.update(gs.time.now + 16, 16);
      const introGoneAfterMutation = gs.introHint === null;
      const firstMutationPresented = gs.awaitingChoice && gs.pendingChoices.length > 0;
      if (firstMutationPresented) ui.update();
      gs.awaitingChoice = false;
      gs.pendingChoices = [];
      gs.queuedLevels = 0;
      ui.dismissProgressionForStageBoundary();
      gs.physics.world.pause();
      if (!gs.scene.isPaused('Game')) gs.scene.pause('Game');
      const cell = gs.hostCells.cells[0];
      const x = gs.player.x + 80;
      const y = gs.player.y;
      cell.active = true;
      cell.infection = 0;
      cell.interactionId = 100;
      cell.image.setPosition(x, y).setVisible(true).setAlpha(0.78);
      cell.infectionOverlay.setPosition(x, y).setVisible(false).setAlpha(0);
      cell.ring.setVisible(true);
      gs.hostCells.update(gs.time.now, 0, 0);
      const approach = {
        startupIntroVisible,
        introGoneAfterMutation,
        firstMutationPresented,
        introGoneBeforeHostCellTeaching: gs.introHint === null,
        progress: cell.infection,
        hintCount: hintMessages.length,
        hint: ui.contextHintText?.text ?? '',
        rangeVisible: cell.ring.visible,
        rangeCommands: cell.ring.commandBuffer?.length ?? 0,
        runtimeRadius: gs.runState.infectionRadius,
      };
      return { x, y, approach };
    });

    assert.equal(setup.approach.progress, 0, 'approach changed gameplay infection');
    assert.equal(setup.approach.startupIntroVisible, true, 'fresh first run did not show its startup intro');
    assert.equal(setup.approach.introGoneAfterMutation, true, 'first mutation did not clear the startup intro');
    assert.equal(setup.approach.firstMutationPresented, true, 'first-run mutation choice was not presented');
    assert.equal(setup.approach.introGoneBeforeHostCellTeaching, true, 'Host Cell teaching appeared before the startup intro was gone');
    assert.equal(setup.approach.hintCount, 1, 'first-run approach hint missing');
    assert.match(setup.approach.hint, /КЛЕТКА ОРГАНИЗМА/);
    assert.ok(setup.approach.rangeVisible && setup.approach.rangeCommands > 0, 'runtime range boundary is not visible');
    await page.screenshot({ path: path.join(captureDir, 'onboarding-first-host-cell.png') });

    const combat = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const regular = gs.spawnEnemy('swarm', gs.player.x + 120, gs.player.y + 10, false);
      if (!regular) throw new Error('regular enemy pool unavailable');
      regular.xpValue = 0;
      const bullet = gs.bullets.get(gs.player.x, gs.player.y);
      if (!bullet) throw new Error('bullet pool unavailable');
      bullet.fire(gs.time.now, 0, 1, 0);
      gs.onBulletHit(bullet, regular);
      const slot = gs.enemyHealth.slots.find((candidate) => candidate.enemy === regular);
      const regularHpFraction = slot ? slot.enemy.hp / slot.enemy.maxHp : 0;
      const visibleBarsAfterHit = gs.enemyHealth.slots.filter((candidate) => candidate.graphics.visible).length;

      const boss = gs.spawnEnemy('boss', gs.player.x + 170, gs.player.y, false);
      if (!boss) throw new Error('boss pool unavailable');
      boss.takeDamage(1);
      const visibleBarsAfterBossHit = gs.enemyHealth.slots.filter((candidate) => candidate.graphics.visible).length;

      const doomed = gs.spawnEnemy('runner', gs.player.x + 190, gs.player.y + 20, false);
      if (!doomed) throw new Error('runner pool unavailable');
      doomed.xpValue = 0;
      doomed.hp = 1;
      doomed.takeDamage(1);
      const hiddenAfterKill = !gs.enemyHealth.slots.some((candidate) => candidate.enemy === doomed && candidate.graphics.visible);

      for (let i = 0; i < 14; i++) {
        const enemy = gs.spawnEnemy('brute', gs.player.x + 240 + i, gs.player.y + 30, false);
        if (!enemy) continue;
        enemy.xpValue = 0;
        enemy.takeDamage(1);
      }
      const cappedCount = gs.enemyHealth.slots.filter((candidate) => candidate.graphics.visible).length;
      gs.enemyHealth.update(gs.time.now + 2000);
      const expiredCount = gs.enemyHealth.slots.filter((candidate) => candidate.graphics.visible).length;
      const reused = gs.spawnEnemy('swarm', gs.player.x + 260, gs.player.y + 40, false);
      if (!reused) throw new Error('enemy pool unavailable for spawnSerial reuse');
      reused.xpValue = 0;
      reused.hp = reused.maxHp = 100;
      reused.takeDamage(10);
      const staleSlot = gs.enemyHealth.slots.find((candidate) => candidate.enemy === reused);
      if (!staleSlot) throw new Error('health bar missing before Enemy object reuse');
      const oldSpawnSerial = reused.spawnSerial;
      reused.deactivateForStageReset();
      reused.activate(gs, 'runner', gs.player.x + 260, gs.player.y + 40, { elite: false, hpScale: 1, dmgScale: 1 });
      const newSpawnSerial = reused.spawnSerial;
      gs.enemyHealth.update(gs.time.now + 100);
      const staleBarVisibleAfterReuse = staleSlot.graphics.visible;
      const staleSlotStillAssignedAfterReuse = staleSlot.enemy === reused && staleSlot.spawnSerial === oldSpawnSerial;
      return {
        regularHpFraction,
        visibleBarsAfterHit,
        visibleBarsAfterBossHit,
        hiddenAfterKill,
        cappedCount,
        expiredCount,
        oldSpawnSerial,
        newSpawnSerial,
        staleBarVisibleAfterReuse,
        staleSlotStillAssignedAfterReuse,
      };
    });
    assert.ok(combat.regularHpFraction > 0 && combat.regularHpFraction < 1, 'regular enemy health fraction is invalid');
    assert.equal(combat.visibleBarsAfterHit, 1, 'health bar did not appear after damage');
    assert.equal(combat.visibleBarsAfterBossHit, 1, 'boss got a local health bar');
    assert.ok(combat.hiddenAfterKill, 'health bar remained after kill');
    assert.ok(combat.cappedCount <= 10, 'enemy health pool exceeded capacity');
    assert.equal(combat.expiredCount, 0, 'expired enemy bars remained visible');
    assert.notEqual(combat.newSpawnSerial, combat.oldSpawnSerial, 'same Enemy object did not advance spawnSerial on reuse');
    assert.equal(combat.staleBarVisibleAfterReuse, false, 'stale health bar stayed visible after same-object Enemy reuse');
    assert.equal(combat.staleSlotStillAssignedAfterReuse, false, 'old health-bar assignment survived Enemy spawnSerial reuse');

    const rna = await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      const beforeXp = gs.runState.stage.xp;
      const beforeQueued = gs.queuedLevels;
      gs.onGemCollected(2);
      gs.onGemCollected(2);
      const xpDelta = gs.runState.stage.xp - beforeXp;
      const queuedDelta = gs.queuedLevels - beforeQueued;
      const hud = ui.levelText.text;
      gs.trackComprehensionOnce('first_mutation_opened');
      gs.trackComprehensionOnce('first_mutation_opened');
      gs.awaitingChoice = true;
      gs.pendingChoices = [{
        id: 'comprehension-smoke-upgrade', shortName: 'ТЕСТ', name: 'Тестовая мутация',
        desc: 'Урон +1', max: 1, family: 'utility', rarity: 'common', kind: 'upgrade',
        apply() {},
      }];
      gs.chooseUpgrade('comprehension-smoke-upgrade');
      return { xpDelta, queuedDelta, hud, pickupVisibleAfter: false };
    });
    await page.waitForFunction(() => {
      const ui = window.__game.scene.getScene('UI');
      return ui.rnaPickupText.text === '+4 РНК';
    }, null, { timeout: 5000 });
    const pickup = await page.evaluate(() => {
      const ui = window.__game.scene.getScene('UI');
      const pickupBounds = ui.rnaPickupText.getBounds();
      const timerBounds = ui.timerText.getBounds();
      return {
        text: ui.rnaPickupText.text,
        visible: ui.rnaPickupText.visible,
        right: pickupBounds.right,
        timerLeft: timerBounds.left,
        time: ui.time.now,
        timer: Boolean(ui.rnaPickupTimer),
        total: ui.rnaPickupTotal,
        timerDispatched: ui.rnaPickupTimer?.hasDispatched,
        timerElapsed: ui.rnaPickupTimer?.getElapsed?.(),
        timeScale: ui.time.timeScale,
        timePaused: ui.time.paused,
        active: ui.scene.isActive('UI'),
        paused: ui.scene.isPaused('UI'),
      };
    });
    assert.equal(rna.xpDelta, 4, 'RNA pickup did not add XP exactly once per pickup');
    assert.equal(rna.queuedDelta, 0, 'RNA pickup changed the level queue below threshold');
    assert.match(rna.hud, /^РНК\s+\d+\/\d+/);
    assert.equal(pickup.text, '+4 РНК', `aggregated RNA feedback is incorrect: ${JSON.stringify(pickup)}`);
    assert.ok(!pickup.visible || pickup.right <= pickup.timerLeft - 4, `RNA pickup overlaps timer: ${JSON.stringify(pickup)}`);

    const interaction = await page.evaluate(({ x, y }) => {
      const gs = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      const cell = gs.hostCells.cells[0];
      const initialXp = gs.runState.stage.xp;
      const gemCountBefore = gs.gems.getChildren().filter((gem) => gem.active).length;
      const hostCellsBefore = gs.runState.run.hostCellsInfected;
      const enemyA = gs.spawnEnemy('swarm', x + 110, y, false);
      const enemyB = gs.spawnEnemy('runner', x + 230, y, false);
      if (!enemyA || !enemyB) throw new Error('lysis enemy pool unavailable');
      enemyA.xpValue = 0;
      enemyB.xpValue = 0;
      enemyA.hp = enemyA.maxHp = 200;
      enemyB.hp = enemyB.maxHp = 200;
      const ringRadii = [];
      const ring = gs.vfx.ring.bind(gs.vfx);
      gs.vfx.ring = (...args) => { ringRadii.push(args[3]); ring(...args); };

      gs.player.setPosition(x, y);
      cell.interactionId = 100;
      const now = gs.time.now + 100;
      gs.hostCells.update(now, 125, 0);
      const enteredProgress = cell.infection;
      const tutorialHintsBeforeLysis = window.__comprehensionHintMessages.length;

      cell.infection = 0.99;
      gs.hostCells.update(now + 125, 125, 0);
      const firstLysis = {
        inactive: !cell.active,
        enemyADamage: 200 - enemyA.hp,
        enemyBDamage: 200 - enemyB.hp,
        radiusCalls: ringRadii.slice(),
        hostCellsInfected: gs.runState.run.hostCellsInfected - hostCellsBefore,
        gemsSpawned: gs.gems.getChildren().filter((gem) => gem.active).length - gemCountBefore,
      };

      const second = gs.hostCells.cells[1];
      second.active = true;
      second.infection = 0.99;
      second.interactionId = 101;
      second.image.setPosition(x, y).setVisible(true).setAlpha(0.9);
      second.infectionOverlay.setPosition(x, y).setVisible(true).setAlpha(0.9);
      second.ring.setVisible(true);
      gs.hostCells.update(now + 250, 125, 0);
      const secondCellHints = window.__comprehensionHintMessages.length - tutorialHintsBeforeLysis;
      const third = gs.hostCells.cells[2];
      const hintsBeforeThirdCell = window.__comprehensionHintMessages.length;
      third.active = true;
      third.infection = 0;
      third.interactionId = 102;
      third.image.setPosition(x, y).setVisible(true).setAlpha(0.78);
      third.infectionOverlay.setPosition(x, y).setVisible(false).setAlpha(0);
      third.ring.setVisible(true);
      gs.player.setPosition(x, y);
      gs.hostCells.update(now + 375, 125, 0);
      const thirdEnteredProgress = third.infection;
      gs.player.setPosition(x + 100, y);
      gs.hostCells.update(now + 500, 125, 0);
      const exitedProgress = third.infection;
      const exitHint = ui.contextHintText.text;
      const hintsAfterExit = window.__comprehensionHintMessages.length;
      gs.player.setPosition(x, y);
      gs.hostCells.update(now + 625, 125, 0);
      const resumedProgress = third.infection;
      const hintsAfterResume = window.__comprehensionHintMessages.length;
      const xpUnchangedByLysis = gs.runState.stage.xp === initialXp;
      return {
        enteredProgress,
        thirdEnteredProgress,
        exitedProgress,
        resumedProgress,
        firstLysis,
        secondCellHints,
        hintsBeforeThirdCell,
        hintsAfterExit,
        hintsAfterResume,
        exitHint,
        xpUnchangedByLysis,
        secondCompleted: gs.hostCellsCompletedThisRun,
        uiHintText: ui.contextHintText.text,
      };
    }, setup);

    // Capture the three first-run teaching states through the actual reusable UI channel.
    for (const viewport of VIEWPORTS) {
      const matrixContext = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      });
      await prepareContext(matrixContext, 0);
      await matrixContext.route('**/api/event', (route) =>
        route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' })
      );
      const matrixPage = await matrixContext.newPage();
      await bootGame(matrixPage);
      await matrixPage.evaluate(() => {
        const ui = window.__game.scene.getScene('UI');
        ui.update();
        ui.showContextHint('КЛЕТКА ОРГАНИЗМА · ОСТАВАЙСЯ РЯДОМ', 900);
        ui.notifyRnaPickup(1);
      });
      await matrixPage.waitForFunction(() => {
        const ui = window.__game.scene.getScene('UI');
        return ui.rnaPickupText.text === '+1 РНК';
      }, null, { timeout: 5000 });
      const view = await matrixPage.evaluate((size) => {
        const game = window.__game;
        const ui = window.__game.scene.getScene('UI');
        const gameScene = game.scene.getScene('Game');
        const bounds = (object) => {
          const b = object.getBounds();
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        };
        return {
          viewport: size,
          scale: { width: ui.scale.width, height: ui.scale.height },
          rnaLabel: ui.levelText.text,
          rnaBounds: bounds(ui.rnaPickupText),
          hintBounds: bounds(ui.contextHintText),
          timerBounds: bounds(ui.timerText),
          killsBounds: bounds(ui.killsText),
          popupVisible: ui.rnaPickupText.visible,
          gameSize: { width: gameScene.scale.width, height: gameScene.scale.height },
        };
      }, viewport);
      if (view.popupVisible) {
        assert.ok(view.rnaBounds.left >= 0 && view.rnaBounds.right <= viewport.width, `RNA popup clipped at ${viewport.width}x${viewport.height}`);
        assert.ok(view.rnaBounds.right <= viewport.width && view.rnaBounds.top >= 0, `RNA pickup outside viewport at ${viewport.width}x${viewport.height}`);
        assert.ok(view.rnaBounds.right <= view.timerBounds.left || view.rnaBounds.left >= view.timerBounds.right || view.rnaBounds.bottom <= view.timerBounds.top || view.rnaBounds.top >= view.timerBounds.bottom, `RNA pickup overlaps timer at ${viewport.width}x${viewport.height}`);
        assert.ok(view.rnaBounds.right <= view.killsBounds.left || view.rnaBounds.left >= view.killsBounds.right || view.rnaBounds.bottom <= view.killsBounds.top || view.rnaBounds.top >= view.killsBounds.bottom, `RNA pickup overlaps kill counter at ${viewport.width}x${viewport.height}`);
      }
      assert.ok(view.hintBounds.left >= 0 && view.hintBounds.right <= viewport.width, `context hint clipped at ${viewport.width}x${viewport.height}`);
      assert.ok(view.hintBounds.top >= 0 && view.hintBounds.bottom <= viewport.height, `context hint outside viewport at ${viewport.width}x${viewport.height}`);
      await matrixPage.screenshot({ path: path.join(captureDir, `comprehension-${viewport.width}x${viewport.height}.png`) });

      const modal = await matrixPage.evaluate(() => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        const ui = game.scene.getScene('UI');
        gs.awaitingChoice = true;
        gs.pendingChoices = ['dmg', 'rate', 'hp'].map((id) => ({
          id,
          shortName: id.toUpperCase(),
          name: `Тестовая мутация ${id}`,
          desc: 'Проверка мобильной компоновки.',
          max: 1,
          family: 'utility',
          rarity: 'common',
          kind: 'upgrade',
          showProgress: false,
          apply() {},
        }));
        ui.update();
        const texts = [];
        const visit = (object) => {
          if (object.type === 'Text' && object.visible && object.alpha > 0.01) {
            const b = object.getBounds();
            texts.push({ left: b.left, right: b.right, top: b.top, bottom: b.bottom });
          }
          for (const child of object.list || []) visit(child);
        };
        if (ui.modal) visit(ui.modal);
        const cards = ui.modal?.list.filter((object) => object.type === 'Container' && object.visible).length ?? 0;
        return { visible: Boolean(ui.modal?.visible), cards, texts };
      });
      await matrixPage.screenshot({ path: path.join(captureDir, `mutation-${viewport.width}x${viewport.height}.png`) });
      assert.ok(modal.visible, `mutation modal missing at ${viewport.width}x${viewport.height}`);
      assert.equal(modal.cards, 3, `mutation cards missing at ${viewport.width}x${viewport.height}`);
      assert.ok(modal.texts.every((bounds) => bounds.left >= 0 && bounds.right <= viewport.width && bounds.top >= 0 && bounds.bottom <= viewport.height), `mutation text clipped at ${viewport.width}x${viewport.height}: ${JSON.stringify(modal.texts)}`);
      await matrixContext.close();
    }

    assert.ok(interaction.enteredProgress > 0, 'enter did not start infection');
    assert.ok(interaction.exitedProgress > 0 && interaction.exitedProgress < interaction.enteredProgress, 'leaving did not preserve and decay progress');
    assert.ok(interaction.resumedProgress > interaction.exitedProgress, 're-entry did not resume progress');
    assert.ok(interaction.firstLysis.inactive, '100% infection did not lyse immediately');
    assert.equal(interaction.firstLysis.enemyADamage, 26, 'enemy inside lysis radius got wrong damage');
    assert.equal(interaction.firstLysis.enemyBDamage, 0, 'enemy outside lysis radius took damage');
    assert.deepEqual(interaction.firstLysis.radiusCalls.slice(-2), [108, 150], 'lysis inner/outer VFX radii do not match runtime radius');
    assert.equal(interaction.firstLysis.hostCellsInfected, 1, 'host cell completion was double-counted');
    assert.equal(interaction.firstLysis.gemsSpawned, 4, 'lysis RNA gem count changed');
    assert.ok(interaction.xpUnchangedByLysis, 'lysis directly added XP');
    assert.equal(interaction.secondCompleted, 2, 'second Host Cell completion was not counted');
    assert.equal(interaction.secondCellHints, 0, 'second Host Cell repeated tutorial hints');
    assert.ok(interaction.thirdEnteredProgress > 0, 'third Host Cell did not start infection');
    assert.ok(interaction.exitedProgress > 0 && interaction.exitedProgress < interaction.thirdEnteredProgress, 'leaving the third Host Cell did not preserve and decay progress');
    assert.equal(interaction.hintsAfterExit, interaction.hintsBeforeThirdCell + 1, 'first interrupted infection after first lysis did not show its contextual hint');
    assert.match(interaction.exitHint, /ОСЛАБЕВАЕТ/, 'interrupted infection hint did not explain decay');
    assert.ok(interaction.resumedProgress > interaction.exitedProgress, 're-entry did not resume infection progress');
    assert.equal(interaction.hintsAfterResume, interaction.hintsAfterExit, 'resume displayed a textual hint');

    await page.waitForTimeout(250);
    const eventCounts = events.reduce((counts, entry) => {
      counts[entry.event] = (counts[entry.event] || 0) + 1;
      return counts;
    }, {});
    for (const event of [
      'first_enemy_hit', 'first_enemy_kill', 'first_rna_pickup', 'first_mutation_opened',
      'first_mutation_selected', 'host_cell_approached', 'infection_started',
      'infection_interrupted', 'infection_resumed', 'first_lysis',
      'second_host_cell_completed_without_hint',
    ]) {
      assert.equal(eventCounts[event], 1, `${event} count was ${eventCounts[event] ?? 0}, expected one`);
    }
    assert.ok(events.every((entry) => !('x' in (entry.props || {})) && !('y' in (entry.props || {}))), 'comprehension telemetry contains coordinates');
    assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('\n')}`);

    const returning = await browser.newContext({ viewport: { width: 390, height: 740 }, deviceScaleFactor: 1 });
    await prepareContext(returning, 1);
    const returningEvents = [];
    await returning.route('**/api/event', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        try { returningEvents.push(JSON.parse(request.postData() || '{}')); } catch {}
      }
      await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
    });
    const returningPage = await returning.newPage();
    await bootGame(returningPage);
    const returningResult = await returningPage.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const ui = window.__game.scene.getScene('UI');
      let hintCount = 0;
      const showHint = ui.showContextHint.bind(ui);
      ui.showContextHint = (...args) => { hintCount += 1; showHint(...args); };
      const cell = gs.hostCells.cells[0];
      cell.active = true;
      cell.infection = 0;
      cell.image.setPosition(gs.player.x + 80, gs.player.y).setVisible(true);
      cell.infectionOverlay.setVisible(false);
      cell.ring.setVisible(true);
      gs.hostCells.update(gs.time.now, 0, 0);
      const lysis = { x: gs.player.x, y: gs.player.y, radius: 0, damage: 0, rna: 0, interactionId: cell.interactionId };
      gs.onHostCellLysis(lysis);
      gs.onHostCellLysis(lysis);
      return {
        hintCount,
        rangeCommands: cell.ring.commandBuffer?.length ?? 0,
        cellsCompleted: gs.hostCellsCompletedThisRun,
      };
    });
    assert.equal(returningResult.hintCount, 0, 'returning run received Host Cell tutorial copy');
    assert.ok(returningResult.rangeCommands > 0, 'returning run lost actual-radius readability');
    assert.equal(returningResult.cellsCompleted, 2, 'returning-run regression did not complete two Host Cells');
    await returningPage.waitForTimeout(250);
    assert.equal(
      returningEvents.filter((entry) => entry.event === 'second_host_cell_completed_without_hint').length,
      0,
      'returning run emitted first-run-only second Host Cell comprehension event'
    );
    await returning.close();

    const resumeContext = await browser.newContext({ viewport: { width: 390, height: 740 }, deviceScaleFactor: 1 });
    await prepareContext(resumeContext, 0);
    const resumeEvents = [];
    await resumeContext.route('**/api/event', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        try { resumeEvents.push(JSON.parse(request.postData() || '{}')); } catch {}
      }
      await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' });
    });
    const resumePage = await resumeContext.newPage();
    await bootGame(resumePage);
    const resumeFixture = await resumePage.evaluate(() => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      gs.trackComprehensionOnce('first_enemy_hit');
      gs.onHostCellInteraction({
        type: 'approach',
        x: gs.player.x,
        y: gs.player.y,
        radius: gs.runState.infectionRadius,
        progress: 0,
        interactionId: 9001,
      });
      // bootGame widens xpNext to freeze progression; restore the real level-1 value before
      // exercising the production checkpoint validator.
      gs.runState.stage.xp = 0;
      gs.runState.stage.xpNext = 5;
      const saved = gs.saveCheckpointNow();
      const checkpoint = JSON.parse(localStorage.getItem('ofeliya_run_checkpoint_v1') || 'null');
      const presentation = JSON.parse(localStorage.getItem('ofeliya_comprehension_v1') || 'null');
      return { saved, checkpoint, presentation };
    });
    assert.equal(resumeFixture.saved, true, 'first-run checkpoint was not saved for resume regression');
    assert.ok(resumeFixture.checkpoint, 'resume regression checkpoint missing');
    assert.equal(resumeFixture.presentation?.runSeed, resumeFixture.checkpoint.runSeed, 'presentation state is not bound to checkpoint seed');
    assert.ok(resumeFixture.presentation?.events?.includes('first_enemy_hit'), 'first-hit telemetry guard was not persisted');
    assert.ok(resumeFixture.presentation?.hostCellHints?.includes('approach'), 'Host Cell hint guard was not persisted');
    await resumePage.waitForTimeout(250);
    const firstHitBeforeResume = resumeEvents.filter((entry) => entry.event === 'first_enemy_hit').length;
    const approachBeforeResume = resumeEvents.filter((entry) => entry.event === 'host_cell_approached').length;

    await resumePage.evaluate((checkpoint) => {
      const game = window.__game;
      if (game.scene.isActive('UI') || game.scene.isPaused('UI')) game.scene.stop('UI');
      if (game.scene.isActive('Game') || game.scene.isPaused('Game')) game.scene.stop('Game');
      game.registry.set('runCheckpointResume', checkpoint);
      game.scene.start('Game');
    }, resumeFixture.checkpoint);
    await resumePage.waitForFunction(() => {
      const game = window.__game;
      if (!game) return false;
      const gs = game.scene.getScene('Game');
      const ui = game.scene.getScene('UI');
      return Boolean(gs?.enemyHealth && ui && (game.scene.isActive('Game') || game.scene.isPaused('Game')));
    }, null, { timeout: 15000 });
    const resumedFirstRun = await resumePage.evaluate(() => {
      const game = window.__game;
      const gs = game.scene.getScene('Game');
      const ui = game.scene.getScene('UI');
      let hintCount = 0;
      const showHint = ui.showContextHint.bind(ui);
      ui.showContextHint = (...args) => { hintCount += 1; showHint(...args); };
      gs.trackComprehensionOnce('first_enemy_hit');
      gs.onHostCellInteraction({
        type: 'approach',
        x: gs.player.x,
        y: gs.player.y,
        radius: gs.runState.infectionRadius,
        progress: 0,
        interactionId: 9002,
      });
      gs.onHostCellInteraction({
        type: 'enter',
        x: gs.player.x,
        y: gs.player.y,
        radius: gs.runState.infectionRadius,
        progress: 0.1,
        interactionId: 9002,
      });
      return {
        resumed: gs.resumed,
        firstRunComprehension: gs.firstRunComprehension,
        firstHitRemembered: gs.comprehensionEventsSent.has('first_enemy_hit'),
        approachRemembered: gs.hostCellHintEventsShown.has('approach'),
        enterRemembered: gs.hostCellHintEventsShown.has('enter'),
        hintCount,
      };
    });
    await resumePage.waitForTimeout(250);
    assert.equal(resumedFirstRun.resumed, true, 'checkpoint regression did not resume the run');
    assert.equal(resumedFirstRun.firstRunComprehension, true, 'first-run teaching was disabled by checkpoint resume');
    assert.equal(resumedFirstRun.firstHitRemembered, true, 'first-hit dedupe state was not restored');
    assert.equal(resumedFirstRun.approachRemembered, true, 'shown Host Cell hint was not restored');
    assert.equal(resumedFirstRun.enterRemembered, true, 'unseen first-run Host Cell teaching did not remain eligible after resume');
    assert.equal(resumedFirstRun.hintCount, 1, 'resume should suppress the shown approach hint and show only the unseen enter hint');
    assert.equal(resumeEvents.filter((entry) => entry.event === 'first_enemy_hit').length, firstHitBeforeResume, 'resume duplicated first_enemy_hit telemetry');
    assert.equal(resumeEvents.filter((entry) => entry.event === 'host_cell_approached').length, approachBeforeResume, 'resume duplicated host_cell_approached telemetry');

    const hintedSecondCellSaved = await resumePage.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      gs.runState.recordHostCellInfected();
      gs.hostCellsCompletedThisRun = 1;
      const cell = gs.hostCells.cells[1];
      cell.active = true;
      cell.infection = 0.4;
      cell.spawnedAt = gs.time.now;
      cell.image.setPosition(gs.player.x + 90, gs.player.y).setVisible(true);
      cell.infectionOverlay.setVisible(true);
      cell.ring.setVisible(true);
      gs.hostCellHintEventsShown.delete('exit');
      gs.onHostCellInteraction({
        type: 'exit',
        x: cell.image.x,
        y: cell.image.y,
        radius: gs.runState.infectionRadius,
        progress: 0.4,
        interactionId: cell.interactionId,
        slotIndex: 1,
      });
      const saved = gs.saveCheckpointNow();
      const presentation = JSON.parse(localStorage.getItem('ofeliya_comprehension_v1') || 'null');
      return { saved, presentation };
    });
    assert.equal(hintedSecondCellSaved.saved, true, 'second-cell contextual-hint checkpoint was not saved');
    assert.ok(hintedSecondCellSaved.presentation?.hostCellSlotsWithHint?.includes(1), 'shown second-cell hint was not persisted against its active slot');
    const hintedSecondCheckpoint = await resumePage.evaluate(() =>
      JSON.parse(localStorage.getItem('ofeliya_run_checkpoint_v1') || 'null')
    );
    await resumePage.evaluate((checkpoint) => {
      const game = window.__game;
      if (game.scene.isActive('UI') || game.scene.isPaused('UI')) game.scene.stop('UI');
      if (game.scene.isActive('Game') || game.scene.isPaused('Game')) game.scene.stop('Game');
      game.registry.set('runCheckpointResume', checkpoint);
      game.scene.start('Game');
    }, hintedSecondCheckpoint);
    await resumePage.waitForFunction(() => {
      const game = window.__game;
      return Boolean(game?.scene.getScene('Game')?.enemyHealth && game.scene.isActive('Game'));
    }, null, { timeout: 15000 });
    const hintSurvivedCellRestore = await resumePage.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      const cell = gs.hostCells.cells[1];
      const before = {
        slots: [...gs.hostCellSlotsWithHint],
        completed: gs.hostCellsCompletedThisRun,
        hinted: [...gs.hostCellHintEventsShown],
      };
      gs.onHostCellLysis({
        x: cell.image.x,
        y: cell.image.y,
        radius: 0,
        damage: 0,
        rna: 0,
        interactionId: cell.interactionId,
        slotIndex: 1,
      });
      return {
        ok: !gs.comprehensionEventsSent.has('second_host_cell_completed_without_hint'),
        before,
        after: [...gs.hostCellSlotsWithHint],
      };
    });
    assert.equal(hintSurvivedCellRestore.ok, true, `a second-cell hint shown before resume was forgotten and misreported as absent: ${JSON.stringify(hintSurvivedCellRestore)}`);
    await resumeContext.close();

    await context.close();
    console.log(`gameplay comprehension browser smoke: ok (${VIEWPORTS.map(({ width, height }) => `${width}x${height}`).join(', ')})`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
