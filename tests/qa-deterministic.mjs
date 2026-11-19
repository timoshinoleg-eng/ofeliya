/**
 * QA deterministic-mode contract — the Juice hit-stop dip is skipped while
 * the autonomous harness drives the game with synthetic stepping.
 *
 * Background (review §6.1, docs/reviews/autonomous-campaign-harness-
 * implementation-2026-11-18.md): Juice.hitStop presses scene.time.timeScale
 * / world.timeScale from wall-clock tween.js tweens. In a stepped run the dip
 * spans a fixed wall-time amount regardless of frame-pump speed, so 1x vs 4x
 * stepping legs (scripts/time-parity-smoke.cjs) and campaign replay diverge.
 * Fix: a module-level flag (src/game/qaDeterministic.ts) raised by the
 * harness on enterSteppedMode() and cleared on resume(); Juice.hitStop
 * early-returns while the flag is set. The hard GameScene.hitStop() freeze
 * (scene-time) stays — deterministic on its own. Production: the harness
 * module is eliminated from bundles (check-harness-absent.mjs), so the flag
 * is never raised and behaviour is unchanged.
 *
 * Covers: pure flag semantics (tsc-compiled) + source contracts on wiring
 * (Juice guard placement, harness set/clear points, gate-free flag module).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-qadet-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`qa-deterministic: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/qaDeterministic.ts',
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
    { stdio: 'inherit' },
  );

  const { setQaDeterministic, isQaDeterministic } = require(join(temp, 'qaDeterministic.js'));

  // --- flag semantics: default off, settable, clearable ---
  eq(isQaDeterministic(), false, 'flag defaults to false (production default)');
  setQaDeterministic(true);
  eq(isQaDeterministic(), true, 'flag raised by harness');
  setQaDeterministic(false);
  eq(isQaDeterministic(), false, 'flag cleared on resume');
  setQaDeterministic(1);
  eq(isQaDeterministic(), true, 'non-boolean truthy coerced');
  setQaDeterministic(0);
  eq(isQaDeterministic(), false, 'non-boolean falsy coerced');
  setQaDeterministic(false);

  // --- source contract: the flag module is gate-free ---
  const qaDet = readFileSync(resolve('src/game/qaDeterministic.ts'), 'utf8');
  assert(!qaDet.includes('import.meta.env'), 'qaDeterministic.ts never reads import.meta.env (gate lives in caller)');

  // --- source contract: Juice guards the dip, before touching scene.time ---
  const juice = readFileSync(resolve('src/game/Juice.ts'), 'utf8');
  assert(juice.includes("import { isQaDeterministic } from './qaDeterministic';"), 'Juice imports the flag');
  const hitStopIdx = juice.indexOf('hitStop(ms: number): void {');
  assert(hitStopIdx > 0, 'Juice.hitStop exists');
  const guardIdx = juice.indexOf('if (isQaDeterministic()) return;', hitStopIdx);
  assert(guardIdx > hitStopIdx, 'guard lives inside hitStop()');
  const dipIdx = juice.indexOf('scene.time', hitStopIdx);
  assert(dipIdx > guardIdx, 'guard precedes any scene.time access in hitStop');
  // The hard GameScene freeze must NOT be gated away (it is scene-time based).
  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  assert(
    gameScene.includes('this.juice.hitStop(ms)') && !gameScene.includes('isQaDeterministic'),
    'GameScene keeps calling juice.hitStop unconditionally (hard freeze untouched)',
  );

  // --- source contract: harness raises on enterSteppedMode, clears on resume ---
  const harness = readFileSync(resolve('src/test-support/installAutonomousHarness.ts'), 'utf8');
  assert(
    harness.includes("import { setQaDeterministic } from '../game/qaDeterministic';"),
    'harness imports the flag setter',
  );
  const enterIdx = harness.indexOf('function enterSteppedMode(): void {');
  const raiseIdx = harness.indexOf('setQaDeterministic(true);');
  const clearIdx = harness.indexOf('setQaDeterministic(false);');
  assert(enterIdx > 0 && raiseIdx > enterIdx, 'flag raised inside enterSteppedMode()');
  assert(clearIdx > enterIdx, 'flag cleared on resume() path');
  assert(raiseIdx < clearIdx, 'raise precedes clear in source order');

  console.log('qa-deterministic: OK (flag semantics, Juice guard, harness wiring)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
