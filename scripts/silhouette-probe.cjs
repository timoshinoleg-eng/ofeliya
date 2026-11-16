/**
 * I-07 silhouette readability probe (research brief 2026-11-16).
 *
 * Builds a deterministic 200-enemy field around the player, freezes it,
 * and measures two automatic proxies for "can a human find the player":
 *
 *   1. localization contrast — WCAG ratio between the avatar core and the
 *      local background annulus (mean and p90);
 *   2. unique-colour area — pixels near the avatar's own colour vs the
 *      strongest competitor hue in its neighbourhood.
 *
 * Protocol acceptance: baseline at 390×740 on BOTH renderers, and two
 * independent scenario builds per renderer must agree within 10 %.
 * Human criterion (N observers × 5 s) lives in
 * docs/qa/SILHOUETTE_PROTOCOL_2026-11-16.md — this probe is its automatic half.
 *
 * The probe is read-only for the game: it stubs wave spawning for the session,
 * spawns through the public GameScene.spawnEnemy, and pauses the scene before
 * measuring. No src/ changes, no gameplay implications.
 *
 * Env: OFELIYA_BASE_URL (default http://127.0.0.1:5173/), SILHOUETTE_ARTIFACT
 * (default artifacts/silhouette-baseline.json).
 */
'use strict';

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

const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/';
const ARTIFACT = process.env.SILHOUETTE_ARTIFACT || 'artifacts/silhouette-baseline.json';
const VIEWPORT = { width: 390, height: 740 };
const SEED = 20261116;
const ENEMY_TOTAL = 200;
const SETTLE_MS = 300;          // camera settle + glow/clearing drawn; weapon fires at 550 ms
const REPEAT_TOLERANCE = 0.10;  // protocol: two runs agree within 10 %

// Gates locked to the first measured baseline (2026-11-16, main @ 2bd6320,
// 390×740): contrastMean 10.1–10.9, contrastP90 8.9–9.6, uniqueness 1.07–1.08
// across webgl/canvas and repeat runs. ~30 % margin on contrast; uniqueness
// keeps its design floor 1.0 on purpose — the measured margin (≈8 %) is thin
// and IS the finding (feeds I-10 brightness separation), not noise to absorb.
const GATES = {
  contrastMeanMin: 7.0,   // avatar highlight vs local background mean (WCAG ratio)
  contrastP90Min: 6.0,    // vs the brightest decile of the neighbourhood
  uniquenessMin: 1.0,     // avatar colour area must beat every competitor hue
};

// Enemy/decor hues that compete with the avatar for attention. Deliberately
// excludes whites/ivory — the avatar's own core is light, matching those
// would trivially zero the uniqueness metric.
const COMPETITOR_RGBS = [
  [0xff, 0x3e, 0x5f], // danger red
  [0x8f, 0xe8, 0xff], // cyan
  [0xff, 0x9b, 0x66], // orange
  [0x9b, 0x6d, 0xff], // purple
  [0x86, 0xff, 0xaa], // rna green
  [0x7f, 0xff, 0xa1], // state green
  [0xff, 0xd5, 0x6a], // gold
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measureOnce(rendererName, runIndex) {
  const t0 = Date.now();
  const step = (label) => console.log(`[${rendererName}#${runIndex}] +${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`);
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('pageerror', (err) => console.error(`[${rendererName}#${runIndex}] pageerror:`, err.message));
    const url = new URL(BASE_URL);
    url.searchParams.set('renderer', rendererName);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    step('goto');

    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 45000 });
    step('menu active');
    await page.evaluate(() => { window.__game.scene.getScene('Menu').scene.start('Game'); });
    await page.waitForFunction(
      () => window.__game?.scene.isActive('Game') && window.__game.scene.isActive('UI'),
      null,
      { timeout: 45000 }
    );
    step('game active');

    const spawned = await page.evaluate(
      ({ seed, total }) => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        // Neutralize everything that could open the level-up modal or mutate the
        // field during the settle window (auto-fire kills → gems → XP → modal):
        // the snapshot must be pure gameplay, and the field must be only ours.
        gs.wave.update = () => {};   // no director spawns
        gs.tryFire = () => {};       // no weapon fire → no kills → no gems → no XP
        gs.addXp = () => 0;          // belt and braces: levels can never queue
        gs.queuedLevels = 0;
        gs.awaitingChoice = false;
        gs.pendingChoices = [];
        // The wave's own opening enemies are RNG-seeded per run — clearing them
        // makes the field exactly the deterministic layout below.
        gs.enemies.clear(true, true);
        const ui = game.scene.getScene('UI');
        if (ui?.modalOpen) ui.dismissProgressionForStageBoundary();
        const mulberry32 = (a) => () => {
          a |= 0; a = (a + 0x6d2b79f5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const rnd = mulberry32(seed);
        const px = gs.player.x;
        const py = gs.player.y;
        // Composition mirrors late-run density: mostly swarm, runners, brutes, elites.
        const plan = [];
        for (let i = 0; i < 125; i++) plan.push(['swarm', i < 8]);
        for (let i = 0; i < 45; i++) plan.push(['runner', false]);
        for (let i = 0; i < 30; i++) plan.push(['brute', i < 2]);
        let count = 0;
        for (const [kind, elite] of plan) {
          // 65 % uniform ring, 35 % in four fixed density pockets.
          let x; let y;
          if (rnd() < 0.65) {
            const a = rnd() * Math.PI * 2;
            const r = 170 + rnd() * 160;
            x = px + Math.cos(a) * r;
            y = py + Math.sin(a) * r;
          } else {
            const pocket = Math.floor(rnd() * 4);
            const baseA = (Math.PI / 4) + (pocket * Math.PI) / 2;
            const a = baseA + (rnd() - 0.5) * 1.1;
            const r = 200 + rnd() * 90;
            x = px + Math.cos(a) * r;
            y = py + Math.sin(a) * r;
          }
          const enemy = gs.spawnEnemy(kind, x, y, elite);
          if (enemy) count++;
        }
        // Snap the camera exactly onto the player: the follow lerp (0.14) is
        // time-dependent and would put the avatar at a different screen offset
        // on every run — the metric box must be centred deterministically.
        const cam = gs.cameras.main;
        cam.setScroll(px - cam.width / 2, py - cam.height / 2);
        return { count, playerX: px, playerY: py };
      },
      { seed: SEED, total: ENEMY_TOTAL }
    );
    step(`spawned ${spawned.count}/${ENEMY_TOTAL}`);

    await sleep(SETTLE_MS);
    // Freeze through the SceneManager, not the ScenePlugin: plugin.pause()
    // without a key is a silent no-op (measured: isPaused stayed false), and a
    // live sim during the snapshot window made runs diverge by enemy drift.
    await page.evaluate(() => { window.__game.scene.pause('Game'); });
    await sleep(150);

    const metrics = await page.evaluate(
      ({ competitors, boxHalf }) => {
        const game = window.__game;
        const gs = game.scene.getScene('Game');
        const cam = gs.cameras.main;
        const sx = (gs.player.x - cam.worldView.x) * cam.zoom;
        const sy = (gs.player.y - cam.worldView.y) * cam.zoom;
        return new Promise((resolve, reject) => {
          game.renderer.snapshot((snapshot) => {
            try {
              // Phaser renderers disagree on what they hand back: CanvasRenderer
              // gives a canvas, WebGLRenderer gives an HTMLImageElement. Normalize
              // by drawing into a plain 2D canvas either way.
              let src = snapshot;
              if (typeof src.getContext !== 'function') {
                const tmp = document.createElement('canvas');
                tmp.width = src.naturalWidth || src.width;
                tmp.height = src.naturalHeight || src.height;
                tmp.getContext('2d').drawImage(src, 0, 0);
                src = tmp;
              }
              const ctx = src.getContext('2d', { willReadFrequently: true });
              const img = ctx.getImageData(0, 0, src.width, src.height);
            // Crop to the metric box around the player: the localization metric
            // only reads the annulus and the 2*boxHalf square, so 160x160 is
            // the whole universe it needs — no megapixel array crosses evaluate.
            const x0 = Math.max(0, Math.floor(sx - boxHalf));
            const y0 = Math.max(0, Math.floor(sy - boxHalf));
            const cw = Math.min(img.width - x0, boxHalf * 2);
            const ch = Math.min(img.height - y0, boxHalf * 2);
            const crop = new Uint8ClampedArray(cw * ch * 4);
            for (let y = 0; y < ch; y++) {
              crop.set(img.data.subarray((y0 + y) * img.width * 4 + x0 * 4, (y0 + y) * img.width * 4 + (x0 + cw) * 4), y * cw * 4);
            }
            resolve({
              cropW: cw, cropH: ch, cropX: x0, cropY: y0,
              data: Array.from(crop),
              sx, sy, competitors,
            });
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        });
      },
      { competitors: COMPETITOR_RGBS, boxHalf: 80 }
    );

    // Metrics run in Node against the raw pixels returned from the page —
    // one ruler (scripts/lib/silhouette-metrics.cjs) for probe and tests.
    const m = require('./lib/silhouette-metrics.cjs');
    const result = m.playerLocalization(
      metrics.data,
      metrics.cropW,
      metrics.cropH,
      metrics.sx - metrics.cropX,
      metrics.sy - metrics.cropY,
      { innerHalf: 22, ringIn: 40, ringOut: 70, boxHalf: 80, tol: 70, competitorRGBs: metrics.competitors }
    );

    const rendererActual = await page.evaluate(() => {
      const type = window.__game.renderer.type;
      return type === 2 ? 'webgl' : type === 1 ? 'canvas' : String(type);
    });

    return {
      rendererRequested: rendererName,
      rendererActual,
      viewport: VIEWPORT,
      seed: SEED,
      enemiesSpawned: spawned.count,
      playerScreen: { x: Math.round(metrics.sx * 10) / 10, y: Math.round(metrics.sy * 10) / 10 },
      ...result,
    };
  } finally {
    await browser.close();
  }
}

function relDivergence(a, b) {
  return Math.abs(a - b) / Math.max(1e-6, Math.abs(a));
}

async function main() {
  const failures = [];
  const runs = [];
  for (const renderer of ['webgl', 'canvas']) {
    for (let run = 0; run < 2; run++) {
      const r = await measureOnce(renderer, run);
      runs.push(r);
      console.log(
        `[${renderer}#${run}] renderer=${r.rendererActual} enemies=${r.enemiesSpawned} ` +
        `contrastMean=${r.contrastMean?.toFixed(2)} contrastP90=${r.contrastP90?.toFixed(2)} ` +
        `uniqueness=${r.uniqueness?.toFixed(2)} playerArea=${r.playerArea} maxCompetitor=${r.maxCompetitorArea}`
      );
      if (r.enemiesSpawned < ENEMY_TOTAL) {
        failures.push(`${renderer}#${run}: spawned ${r.enemiesSpawned}/${ENEMY_TOTAL}`);
      }
      if (r.rendererActual !== renderer) {
        console.warn(`[${renderer}#${run}] requested ${renderer}, got ${r.rendererActual} (fallback) — recorded, not failed`);
      }
    }
    const [a, b] = runs.slice(-2);
    for (const key of ['contrastMean', 'contrastP90', 'uniqueness', 'playerArea']) {
      const d = relDivergence(a[key], b[key]);
      if (d >= REPEAT_TOLERANCE) failures.push(`${renderer}: repeatability ${key} diverged ${(d * 100).toFixed(1)}% (>= ${REPEAT_TOLERANCE * 100}%)`);
    }
    const latest = runs[runs.length - 1];
    if (latest.contrastMean < GATES.contrastMeanMin) failures.push(`${renderer}: contrastMean ${latest.contrastMean.toFixed(2)} < ${GATES.contrastMeanMin}`);
    if (latest.contrastP90 < GATES.contrastP90Min) failures.push(`${renderer}: contrastP90 ${latest.contrastP90.toFixed(2)} < ${GATES.contrastP90Min}`);
    if (latest.uniqueness < GATES.uniquenessMin) failures.push(`${renderer}: uniqueness ${latest.uniqueness.toFixed(2)} < ${GATES.uniquenessMin}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewport: VIEWPORT,
    seed: SEED,
    enemyTotal: ENEMY_TOTAL,
    settleMs: SETTLE_MS,
    repeatTolerance: REPEAT_TOLERANCE,
    gates: GATES,
    competitorRGBs: COMPETITOR_RGBS,
    runs,
    failures,
  };
  fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
  fs.writeFileSync(ARTIFACT, JSON.stringify(report, null, 2) + '\n');
  console.log(`silhouette-probe: artifact → ${ARTIFACT}`);

  if (failures.length > 0) {
    console.error('silhouette-probe: FAILURES:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('silhouette-probe: OK (200 enemies, both renderers, repeatability <10%, gates pass)');
}

main().catch((err) => {
  console.error('silhouette-probe:', err);
  process.exit(1);
});
