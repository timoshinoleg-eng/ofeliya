/**
 * Juice driver contract — game-feel движок забега (порт партии 3, main-only).
 *
 * Juice не тестируется в браузере локально (нет Chrome), поэтому его
 * поведение покрыто здесь на фейковой сцене: governor-скейлинг тряски,
 * hitStop-дип timeScale + восстановление, жизненный цикл damagePopup,
 * rewardReveal, squashAndStretch, impactZoom, reset.
 *
 * Важно: время в тест инжектится явно (Juice.update(t)) — в игре группа
 * качается на собственных часах tween.js (см. шапку Juice.ts), а не на
 * времени сцены Phaser. И качается ШАГАМИ по ~25 мс, как реальные кадры:
 * твин, стартовавший из цепочки внутри одного прохода group.update,
 * впервые применяется только на следующем проходе — одиночный прыжок
 * на +400 мс оставил бы chained-recover на один кадр позади (семантика
 * tween.js, не баг Juice; в игре кадры идут каждые ≤50 мс).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-juice-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`juice-driver: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const approx = (actual, expected, eps, message) =>
  assert(Math.abs(actual - expected) <= eps, `${message}: expected ~${expected}, got ${actual}`);

function makeScene() {
  const texts = [];
  const scene = {
    time: { timeScale: 1 },
    physics: { world: { timeScale: 1 } },
    cameras: {
      main: {
        shakes: [],
        zooms: [],
        shake(duration, intensity) {
          this.shakes.push([duration, intensity]);
        },
        setZoom(z) {
          this.zooms.push(z);
        },
      },
    },
    add: {
      text(x, y, str) {
        const t = {
          x,
          y,
          str,
          alpha: 1,
          destroyed: false,
          setOrigin() {
            return t;
          },
          setDepth() {
            return t;
          },
          setY(v) {
            t.y = v;
            return t;
          },
          setAlpha(v) {
            t.alpha = v;
            return t;
          },
          destroy() {
            t.destroyed = true;
          },
        };
        texts.push(t);
        return t;
      },
    },
    _texts: texts,
  };
  return scene;
}

function makeTarget() {
  return {
    scaleX: 1,
    scaleY: 1,
    alpha: 1,
    setScale(s) {
      this.scaleX = s;
      this.scaleY = s;
      return this;
    },
    setAlpha(a) {
      this.alpha = a;
      return this;
    },
  };
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/Juice.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const { Juice } = require(join(temp, 'Juice.js'));

  /** Качать группу шагами, как кадры (см. шапку файла про chained-твины). */
  function pump(juice, tFrom, tTo, stepMs = 25) {
    for (let t = tFrom + stepMs; t <= tTo; t += stepMs) juice.update(t);
    juice.update(tTo);
  }

  // --- screenShake: governor scaling (0.55 profile) ---
  const scene = makeScene();
  const juice = new Juice(scene, { intensityScale: () => 0.55 });
  juice.screenShake(100, 0.5);
  eq(scene.cameras.main.shakes.length, 1, 'one shake call');
  approx(scene.cameras.main.shakes[0][1], 0.275, 1e-9, 'shake intensity scaled by governor');
  eq(scene.cameras.main.shakes[0][0], 100, 'shake duration passthrough');
  juice.screenShake(0, 0.5);
  juice.screenShake(100, 0);
  eq(scene.cameras.main.shakes.length, 1, 'zero duration/intensity: no shake');

  // --- screenShake: intensity 0 disables ---
  const quietScene = makeScene();
  const quiet = new Juice(quietScene, { intensityScale: () => 0 });
  quiet.screenShake(100, 0.5);
  eq(quietScene.cameras.main.shakes.length, 0, 'zero governor: no shake');

  // --- hitStop: dip + hold + recovery, both clocks ---
  const t0 = performance.now();
  juice.hitStop(200); // dip 110ms, hold 90ms, recovery 150ms
  pump(juice, t0, t0 + 60);
  assert(scene.time.timeScale < 1 && scene.time.timeScale > 0.06, `mid-dip timescale dipped, got ${scene.time.timeScale}`);
  assert(scene.physics.world.timeScale === scene.time.timeScale, 'world timescale tracks scene timescale');
  pump(juice, t0 + 60, t0 + 150);
  approx(scene.time.timeScale, 0.06, 0.02, 'hold phase at floor');
  pump(juice, t0 + 150, t0 + 400);
  eq(scene.time.timeScale, 1, 'recovered to 1');
  eq(scene.physics.world.timeScale, 1, 'world recovered to 1');

  // --- hitStop: restart replaces the previous dip ---
  juice.hitStop(200);
  juice.hitStop(200);
  const t3 = performance.now();
  pump(juice, t3, t3 + 400);
  eq(scene.time.timeScale, 1, 'restarted dip still recovers');

  // --- hitStop: non-positive is a no-op ---
  juice.hitStop(0);
  eq(scene.time.timeScale, 1, 'zero hitStop does nothing');

  // --- damagePopup: creates, rises, destroys; intensity 0 skips ---
  const p0 = performance.now();
  juice.damagePopup(10, 20, '42');
  eq(scene._texts.length, 1, 'popup text created');
  eq(scene._texts[0].str, '42', 'popup text content');
  pump(juice, p0, p0 + 800);
  eq(scene._texts[0].destroyed, true, 'popup destroyed after lifetime');
  quiet.damagePopup(10, 20, '42');
  eq(quietScene._texts.length, 0, 'zero governor: no popup');

  // --- rewardReveal: from -> 1 over 430ms ---
  const target = makeTarget();
  const r0 = performance.now();
  juice.rewardReveal(target, { from: 0.52, durationMs: 430 });
  eq(target.scaleX, 0.52, 'reveal starts at from');
  eq(target.alpha, 0, 'reveal starts transparent');
  pump(juice, r0, r0 + 500);
  eq(target.scaleX, 1, 'reveal ends at scale 1');
  eq(target.alpha, 1, 'reveal ends opaque');

  // --- squashAndStretch: stretch then elastic return ---
  const squash = makeTarget();
  const s0 = performance.now();
  juice.squashAndStretch(squash, 1);
  pump(juice, s0, s0 + 110);
  assert(squash.scaleX > 1, `stretch phase widens X, got ${squash.scaleX}`);
  assert(squash.scaleY < 1, `stretch phase narrows Y, got ${squash.scaleY}`);
  pump(juice, s0 + 110, s0 + 400);
  eq(squash.scaleX, 1, 'squash returns to 1');
  eq(squash.scaleY, 1, 'squash returns to 1 (Y)');

  // --- impactZoom: zoom pulse restores to 1 ---
  const z0 = performance.now();
  juice.impactZoom(200, 0.2);
  pump(juice, z0, z0 + 100);
  assert(scene.cameras.main.zooms.some((z) => z > 1), 'zoom pulse above 1 mid-way');
  pump(juice, z0 + 100, z0 + 300);
  eq(scene.cameras.main.zooms[scene.cameras.main.zooms.length - 1], 1, 'zoom restored to 1');

  // --- reset: restores timescales, clears tweens ---
  const d0 = performance.now();
  juice.hitStop(200);
  pump(juice, d0, d0 + 60);
  assert(scene.time.timeScale < 1, 'dip active before reset');
  juice.reset();
  eq(scene.time.timeScale, 1, 'reset restores scene timescale');
  eq(scene.physics.world.timeScale, 1, 'reset restores world timescale');
  juice.update(performance.now() + 500);
  eq(scene.time.timeScale, 1, 'cleared tweens do not re-dip');

  console.log('juice-driver: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
