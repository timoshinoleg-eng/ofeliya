// Biological hit/death feedback smoke (adapted from PR #183, commit 0e3269c).
// Contract assertions + paired screenshot evidence. In IMPACT_TOLERANCE=baseline mode
// contract failures are recorded, not thrown, so the pre-change build still yields
// comparable before/after captures.
// Env: OFELIYA_BASE_URL (default http://127.0.0.1:4175/), OFELIYA_IMPACT_DIR (output),
//       IMPACT_TOLERANCE=baseline|strict (default strict), OFELIYA_IMPACT_VIDEO=1 (record webm).
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const browserDriver = () => {
  const { chromium } = require('playwright');
  return { chromium, executablePath: chromium.executablePath() };
};

const BASE = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:4175/';
const OUT = process.env.OFELIYA_IMPACT_DIR || path.resolve('artifacts/biological-impact');
const TOLERANCE = process.env.IMPACT_TOLERANCE === 'baseline' ? 'baseline' : 'strict';
fs.mkdirSync(OUT, { recursive: true });

// Synchronize with real Phaser renders, rather than a fixed screenshot delay.
async function renderedPose(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
    const game = window.__game; let frames = 0;
    const timer = setTimeout(() => { game.events.off('postrender', render); reject(Error('pose render timeout')); }, 5000);
    function render() { if (++frames < 2) return; clearTimeout(timer); game.events.off('postrender', render); resolve(); }
    game.events.on('postrender', render);
  }));
}
// Decode actual screenshot pixels with the browser's native PNG decoder. No
// transitive pngjs dependency or absolute device-specific white-pixel threshold.
async function heroWhitePixels(page, image) {
  return page.evaluate(async data => {
    const game = window.__game, p = window.__impactFixture.gs.player;
    const cam = window.__impactFixture.gs.cameras.main;
    const point = cam.matrix.transformPoint(p.x - cam.scrollX, p.y - cam.scrollY);
    const rect = game.canvas.getBoundingClientRect();
    const img = new Image(); img.src = data; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
    const ratio = img.width / innerWidth;
    const cx = rect.left + point.x * rect.width / game.scale.width;
    const cy = rect.top + point.y * rect.height / game.scale.height;
    let white = 0;
    for (let y = Math.max(0, Math.floor((cy - 32) * ratio)); y < Math.min(img.height, (cy + 32) * ratio); y++)
      for (let x = Math.max(0, Math.floor((cx - 32) * ratio)); x < Math.min(img.width, (cx + 32) * ratio); x++) {
        const i = (y * img.width + x) * 4;
        if (pixels[i] > 235 && pixels[i + 1] > 235 && pixels[i + 2] > 235 && pixels[i + 3] > 200) white++;
      }
    return white;
  }, 'data:image/png;base64,' + image.toString('base64'));
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--enable-webgl', '--use-angle=swiftshader'],
  });
  const results = [];
  try {
    // WebGL is included to exercise the QA override; environments without software GL
    // document the canvas fallback instead of failing the cell.
    const cells = [
      { renderer: 'canvas', tier: 'full' },
      { renderer: 'canvas', tier: 'reduced' },
      { renderer: 'webgl', tier: 'full' },
    ];
    for (const { renderer, tier } of cells) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 740 },
        deviceScaleFactor: 2,
        ...(process.env.OFELIYA_IMPACT_VIDEO === '1' && renderer === 'canvas' && tier === 'full'
          ? { recordVideo: { dir: OUT, size: { width: 390, height: 740 } } }
          : {}),
      });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const local = url.origin === new URL(BASE).origin;
        return !local || url.pathname.startsWith('/api/')
          ? route.fulfill({ contentType: 'application/json', body: '{}' }) : route.continue();
      });
      await context.addInitScript(
        (tier) => {
          localStorage.setItem('ofeliya_performance_tier', tier);
          localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1, tutorialDone: true }));
        },
        tier
      );
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${BASE}?renderer=${renderer}`);
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
      await page.evaluate(() => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        // Freeze progression before starting; retain real object preUpdate/tween/physics lifecycle.
        gs.update = () => {};
        game.scene.getScene('Menu').scene.start('Game');
      });
      await page.waitForFunction(() => window.__game.scene.isActive('UI'));
      const result = await page.evaluate(({ renderer, tier }) => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        const ui = game.scene.getScene('UI');
        gs.scene.pause();
        ui.hideModal();
        if (ui.onboardingContainer) ui.onboardingContainer.setVisible(false);
        ui.onboardingArmed = false;
        gs.enemies.getChildren().forEach((e) => e.deactivateForStageReset());
        gs.bullets.getChildren().forEach((b) => b.disableBody(true, true));
        gs.hostCells.resetStage();
        gs.player.setPosition(700, 700);
        gs.cameras.main.stopFollow();
        gs.cameras.main.centerOn(730, 730);
        const enemy = gs.enemies.getChildren()[0];
        enemy.activate(gs, 'swarm', 780, 760, { elite: false, hpScale: 1, dmgScale: 1 });
        enemy.nextRoleActionAt = enemy.nextBossAttackAt = Infinity;
        const soft = [];
        const fail = (condition, message) => {
          if (!condition) soft.push(message);
        };
        const actualType = game.renderer.type;
        fail(actualType === 1 || actualType === 2, 'unknown renderer type ' + actualType);
        fail(
          renderer !== 'canvas' || actualType === 1,
          `canvas cell rendered as type ${actualType}`
        );
        fail(
          renderer !== 'webgl' || actualType === 2,
          `webgl cell rendered as type ${actualType}`
        );
        const geometry = (s) => {
          s.body.updateFromGameObject();
          return [
            s.width, s.height, s.displayWidth, s.displayHeight, s.body.width, s.body.height,
            s.body.center.x - s.x, s.body.center.y - s.y,
          ];
        };
        // Use an exact fixture epoch: fractional Phaser timestamps can round
        // (sampleTime + 180) - sampleTime below 180 and select the prior pose.
        const sampleTime = Math.floor(gs.time.now);
        gs.time.now = sampleTime;
        gs.player.preUpdate(600, 0);
        enemy.preUpdate(600, 0);
        const before = { player: geometry(gs.player), enemy: geometry(enemy) };
        const hp = enemy.hp;
        const killCount = gs.runState.stage.kills;
        gs.player.markHurt(sampleTime, 1, 0);
        const iframe = gs.player.hurtUntil;
        const damage = enemy.takeDamage(1, 130, 0);
        const directions = { player: gs.player.biologicalHitDirection, enemy: enemy.biologicalHitDirection };
        const phases = [];
        for (const elapsed of [0, 60, 90, 120, 179, 180]) {
          gs.time.now = sampleTime + elapsed;
          gs.player.preUpdate(600, 0);
          enemy.preUpdate(600, 0);
          const after = { player: geometry(gs.player), enemy: geometry(enemy) };
          fail(JSON.stringify(before) === JSON.stringify(after), `body/display changed at ${elapsed}`);
          phases.push({
            elapsed,
            player: gs.player.frame.name,
            enemy: enemy.frame.name,
            playerAtlas: gs.player.texture.key,
            enemyAtlas: enemy.texture.key,
          });
        }
        fail(damage === 1 && enemy.hp === hp - 1, 'damage contract');
        fail(gs.player.hurtUntil === iframe, 'iframe changed');
        fail(
          phases[0].enemyAtlas === 'bio-hit-immune-antibody' && phases[0].playerAtlas === 'bio-hit-virus-player',
          'hit not selected'
        );
        fail(
          phases[5].enemyAtlas === 'bio-cycle-immune-antibody' && phases[5].playerAtlas === 'bio-cycle-virus-player',
          'idle not recovered'
        );
        for (const phase of phases.slice(0, 5)) {
          const pose = tier === 'reduced' ? (phase.elapsed < 90 ? 0 : 2) : Math.floor(phase.elapsed / 60);
          fail(
            phase.player === `hit-${directions.player}-${pose}` && phase.enemy === `hit-${directions.enemy}-${pose}`,
            `wrong tier pose at ${phase.elapsed}`
          );
        }
        gs.time.now = sampleTime;
        enemy.takeDamage(99999, 130, 0);
        fail(!enemy.active && !enemy.body.enable, 'death delayed body disable');
        fail(gs.runState.stage.kills === killCount + 1, 'death changed kill accounting');
        const ghost = gs.vfx.biologicalGhosts ? gs.vfx.biologicalGhosts[0] : undefined;
        fail(!!ghost && ghost.active && !ghost.image.body, 'nonphysical ghost missing');
        const snapshot = ghost
          ? { x: ghost.image.x, y: ghost.image.y, texture: ghost.image.texture.key, frame: ghost.image.frame.name }
          : null;
        if (ghost) {
          enemy.activate(gs, 'runner', 1200, 1300, { elite: false, hpScale: 1, dmgScale: 1 });
          fail(ghost.image.x === snapshot.x && ghost.image.y === snapshot.y, 'ghost retained pooled enemy');
          enemy.deactivateForStageReset();
          enemy.activate(gs, 'swarm', 780, 760, { elite: false, hpScale: 1, dmgScale: 1 });
          enemy.preUpdate(600, 0);
          fail(enemy.texture.key === 'bio-cycle-immune-antibody', 'recycled hit leaked');
        }
        window.__impactFixture = { gs, enemy, ui };
        const label = document.createElement('div');
        label.textContent = `${renderer}/${tier} actual=${actualType === 2 ? 'webgl' : 'canvas'} · controlled muted fixture · no phone/FPS claim`;
        Object.assign(label.style, {
          position: 'fixed', bottom: '12px', left: '8px', right: '8px', padding: '8px',
          background: '#05101ee0', color: '#def', font: '11px sans-serif', zIndex: '9999',
        });
        document.body.append(label);
        return { renderer, tier, actualType, phases, before, damage, iframe, snapshot, contractFailures: soft };
      }, { renderer, tier });
      await page.evaluate(() => { const { gs, enemy } = window.__impactFixture; gs.player.clearTint(); enemy.clearTint(); });
      await renderedPose(page);
      const idleImage = await page.screenshot({ path: path.join(OUT, `${renderer}-${tier}-idle.png`) });
      const idleWhite = await heroWhitePixels(page, idleImage);
      await page.evaluate(() => {
        const { gs, enemy } = window.__impactFixture;
        gs.player.markHurt(gs.time.now, 1, 0);
        enemy.takeDamage(1, 130, 0);
        gs.player.preUpdate(600, 0);
        enemy.preUpdate(600, 0);
      });
      await renderedPose(page);
      const impactImage = await page.screenshot({ path: path.join(OUT, `${renderer}-${tier}-impact.png`) });
      const hitWhite = await heroWhitePixels(page, impactImage);
      result.heroFlashPixels = { idle: idleWhite, hit: hitWhite };
      if (renderer === 'webgl') assert.ok(hitWhite > idleWhite, `actual ${renderer} hero hit flash must increase white pixels: ${idleWhite} -> ${hitWhite}`);
      await page.evaluate(() => {
        const { gs, enemy } = window.__impactFixture;
        enemy.takeDamage(99999);
        gs.scene.resume();
      });
      await page.waitForFunction(() =>
        !window.__impactFixture.gs.vfx.biologicalGhosts ||
        window.__impactFixture.gs.vfx.biologicalGhosts.every((g) => !g.active)
      );
      result.ghostsReleased = true;
      if (process.env.OFELIYA_IMPACT_VIDEO === '1' && renderer === 'canvas' && tier === 'full') {
        await page.evaluate(() => {
          const { gs, enemy } = window.__impactFixture;
          let count = 0;
          // Cosmetic tint cleanup normally belongs to Game.update, which this fixture freezes.
          gs.update = () => {
            if (gs.time.now >= gs.player.hurtUntil && gs.player.tintFill) gs.player.clearTint();
          };
          gs.time.addEvent({
            delay: 2000, repeat: 9,
            callback: () => {
              enemy.activate(gs, 'swarm', 780, 760, { elite: false, hpScale: 1, dmgScale: 1, speedScale: 0 });
              gs.player.markHurt(gs.time.now, Math.cos(count), Math.sin(count));
              enemy.takeDamage(1, Math.cos(count) * 130, Math.sin(count) * 130);
              count++;
              gs.time.delayedCall(700, () => enemy.takeDamage(99999));
            },
          });
        });
        await page.waitForTimeout(20500);
      }
      await page.evaluate(() => window.__game.scene.stop('Game'));
      await page.waitForFunction(
        () => window.__impactFixture.gs.vfx.destroyed &&
          (!window.__impactFixture.gs.vfx.biologicalGhosts || window.__impactFixture.gs.vfx.biologicalGhosts.length === 0)
      );
      result.shutdownDestroyed = true;
      result.pageErrors = errors;
      await context.close();
      results.push(result);
    }
    fs.writeFileSync(path.join(OUT, 'impact-evidence.json'), JSON.stringify({ base: BASE, tolerance: TOLERANCE, results }, null, 2));
    const failures = results.flatMap((r) => r.contractFailures.map((f) => `${r.renderer}/${r.tier}: ${f}`));
    if (TOLERANCE === 'strict' && (failures.length || results.some((r) => r.pageErrors.length))) {
      console.error('FAILURES:\n' + failures.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(
        `biological impact: ${results.length} cells captured; ${failures.length} contract deviations (${TOLERANCE}); see impact-evidence.json`
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
