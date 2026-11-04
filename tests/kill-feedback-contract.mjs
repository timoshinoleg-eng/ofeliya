/**
 * A3 kill-feedback contract — juice without color.
 *
 * 1. The whole flash/pop stack fits the ~150 ms window: JUICE.killFlashMs
 *    is compiled from src/game/config.ts (not copied literals) and must be
 *    > 0 and <= 150; the pop actually overshoots (killFlashPop > 1).
 * 2. The sound channel is procedural-only: 'kill' is a SfxName with a
 *    throttle and a fallback blip, but references no audio file — no
 *    unverified sample enters the repository, and load() must guard a
 *    missing MANIFEST entry instead of fetching (no 404 spam per kill).
 * 3. The visual channel is luminance-only: killFlash uses white on the
 *    pooled ADD-blend decoration, no new particle emitter.
 * 4. The seam is the single kill path: onEnemyDied calls killFeedback for
 *    every kill; the helper respects reduced motion, plays the blip, and
 *    contains no hit-stop — hit-stop stays elite/boss-only (exactly one
 *    hitStop call inside onEnemyDied, after the elite/boss branch).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-kill-feedback-'));
const require = createRequire(import.meta.url);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
const read = (rel) => readFileSync(resolve(rel), 'utf8');
const slice = (src, from, to) => {
  const start = src.indexOf(from);
  assert(start >= 0, `slice start not found: ${from}`);
  const end = to ? src.indexOf(to, start) : src.length;
  assert(end > start, `slice end not found: ${to}`);
  return src.slice(start, end);
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/config.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { JUICE } = require(join(temp, 'game', 'config.js'));

  // 1. Stack fits the ~150 ms window; the pop overshoots.
  assert(Number.isFinite(JUICE.killFlashMs) && JUICE.killFlashMs > 0 && JUICE.killFlashMs <= 150,
    `JUICE.killFlashMs must be in (0, 150], got ${JUICE.killFlashMs}`);
  assert(JUICE.killFlashPop > 1, `JUICE.killFlashPop must overshoot 1, got ${JUICE.killFlashPop}`);
  assert(JUICE.killFlashAlpha > 0 && JUICE.killFlashAlpha < 1,
    `JUICE.killFlashAlpha must be in (0, 1), got ${JUICE.killFlashAlpha}`);

  const sfx = read('src/systems/Sfx.ts');
  const mix = read('src/systems/audioMixMath.ts');
  const vfx = read('src/systems/VfxSystem.ts');
  const scene = read('src/scenes/GameScene.ts');

  // 2. Procedural-only kill sound: name + throttle + fallback, no sample file.
  assert(/'kill'/.test(sfx), "SfxName must include 'kill'");
  assert(/kill:\s*\d+/.test(sfx), 'THROTTLE_MS must throttle kill');
  assert(/case 'kill':/.test(sfx), "fallback must define a 'kill' blip");
  assert(!/kill\.(ogg|mp3|wav)/.test(sfx), 'kill must reference no audio sample file');
  assert(sfx.includes('if (!entry) return Promise.resolve(null);'),
    'load() must guard a missing MANIFEST entry instead of fetching');
  assert(/kill:\s*0\.16/.test(mix), 'SFX_ROLE_GAINS must index kill for SfxName completeness');

  // 3. Luminance-only flash on the pooled decoration, no new emitter.
  const flash = slice(vfx, 'killFlash(', 'setCombatDensity');
  assert(flash.includes('JUICE.killFlashMs'), 'killFlash must run on JUICE.killFlashMs');
  assert(flash.includes('COLORS.white'), 'killFlash must be white (luminance channel only)');
  assert(flash.includes('acquireDecoration'), 'killFlash must reuse the pooled decoration');
  assert(!flash.includes('particles('), 'killFlash must not create a new particle emitter');

  // 4. Single kill seam; helper respects reduced motion, plays the blip, no hit-stop.
  const died = slice(scene, 'onEnemyDied(e: Enemy)', 'private killFeedback');
  assert(died.includes('this.killFeedback(e);'), 'onEnemyDied must call killFeedback');
  const hitStopAt = died.indexOf('this.hitStop(');
  const eliteBranchAt = died.indexOf('if (e.isElite || e.isBoss)');
  assert(hitStopAt > 0 && eliteBranchAt > 0 && eliteBranchAt < hitStopAt,
    'onEnemyDied hit-stop must sit inside the elite/boss branch only');
  assert(died.indexOf('this.hitStop(', hitStopAt + 1) === -1,
    'onEnemyDied must contain exactly one hitStop call (elite/boss only)');
  const helper = slice(scene, 'private killFeedback', 'private triggerVolatileElite');
  assert(helper.includes('prefersReducedMotion()'), 'killFeedback must respect reduced motion');
  assert(helper.includes('killFlash'), 'killFeedback must fire the flash');
  assert(helper.includes("Sfx.play('kill')"), 'killFeedback must play the kill blip');
  assert(!helper.includes('hitStop'), 'killFeedback must not hit-stop (normal kills never freeze)');

  console.log('kill-feedback: contract OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
