/**
 * QA render-split contract — visibility-only group hiding for the render
 * measurement (no gameplay change).
 *
 * Covers the pure logic (parseQaHide: query parsing, canonical label,
 * formatter hide line) and source contracts on the wiring:
 * - qaHide.ts never reads import.meta.env (gate lives in the caller);
 * - GameScene parses ?qaHide= ONLY inside the existing QA gate block and
 *   applies hiding via visibility only (no destroy, no active flags);
 * - gems are re-hidden every active frame (Gem.activate re-shows);
 * - atmosphere re-hides itself while its QA flag is set;
 * - the UI group hides via setQaHudHidden (persistent HUD elements only;
 *   the level-up modal stays visible — see the v2 contract test);
 * - no new performance.now() call sites in GameScene.
 * Compiles the TS modules with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-qahide-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`qa-render-split: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const setEq = (actual, expected, message) => {
  const a = [...actual].sort().join(',');
  const e = [...expected].sort().join(',');
  assert(a === e, `${message}: expected {${e}}, got {${a}}`);
};

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/qaHide.ts',
      'src/game/qaPerf.ts',
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

  const { parseQaHide, qaHideLabel, QA_HIDE_GROUPS } = require(join(temp, 'qaHide.js'));
  const { formatQaPerfLines, QA_PERF_KEYS } = require(join(temp, 'qaPerf.js'));

  // --- parsing: empty / missing / single / combined ---
  setEq(parseQaHide(''), [], 'empty search hides nothing');
  setEq(parseQaHide('?foo=bar'), [], 'unrelated params hide nothing');
  setEq(parseQaHide('?qaHide='), [], 'empty qaHide hides nothing');
  setEq(parseQaHide('?qaHide=gems'), ['gems'], 'single group');
  setEq(parseQaHide('?qaHide=gems,atmo,ui'), ['gems', 'atmo', 'ui'], 'all groups combined');
  setEq(parseQaHide('qaHide=ui,gems'), ['gems', 'ui'], 'leading ? optional, order irrelevant');
  setEq(parseQaHide('?qaHide=gems&qaHide=ui'), ['gems', 'ui'], 'repeated param merges');
  setEq(parseQaHide('?qaHide=bogus,gems,ATMO'), ['gems', 'atmo'], 'unknown tokens ignored, case-insensitive');
  setEq(parseQaHide('?qaHide= gems , ui '), ['gems', 'ui'], 'whitespace tolerated');
  setEq(parseQaHide('?qaHide=gems,gems'), ['gems'], 'duplicates deduped');
  eq(QA_HIDE_GROUPS.join(','), 'gems,atmo,ui', 'canonical group order');

  // --- label: canonical order, 'none' for the base run ---
  eq(qaHideLabel(new Set()), 'none', 'empty selection labels as none');
  eq(qaHideLabel(new Set(['ui', 'gems'])), 'gems,ui', 'label uses canonical order, not input order');
  eq(qaHideLabel(new Set(['atmo'])), 'atmo', 'single group label');

  // --- formatter: hide line present only when a label is passed ---
  const rows = {};
  for (const key of QA_PERF_KEYS) rows[key] = { avg: 1.5, max: 9.5 };
  const counters = { enemies: 12, bullets: 5, gems: 77, density: 12, tier: 'low' };
  const withHide = formatQaPerfLines(rows, 120, counters, 42.1, null, 'gems,atmo').join('\n');
  assert(withHide.includes('hide: gems,atmo'), 'hide line shown when label passed');
  const withoutHide = formatQaPerfLines(rows, 120, counters, 42.1, null).join('\n');
  assert(!withoutHide.includes('hide:'), 'no hide line without a label (existing behaviour preserved)');
  const noneHide = formatQaPerfLines(rows, 120, counters, 42.1, null, 'none').join('\n');
  assert(noneHide.includes('hide: none'), 'base runs label as hide: none');

  // --- source contract: qaHide.ts is gate-free ---
  const qaHide = readFileSync(resolve('src/game/qaHide.ts'), 'utf8');
  assert(!qaHide.includes('import.meta.env'), 'qaHide.ts never reads import.meta.env (gate lives in caller)');

  // --- source contract: GameScene wiring, all inside the QA gate ---
  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  const gate = "import.meta.env.DEV || import.meta.env.VITE_QA_TOOLS === '1'";
  assert(gameScene.includes(gate), 'GameScene uses the existing QA gate expression');
  const gateIdx = gameScene.indexOf(gate);
  const parseIdx = gameScene.indexOf('parseQaHide(');
  assert(parseIdx > gateIdx, 'qaHide parsing follows the gate expression');
  assert(gameScene.includes('parseQaHide(window.location.search)'), 'hide selection comes from the URL query');
  assert(gameScene.includes("this.qaHide?.has('gems')"), 'gems re-hide is guarded by the parsed selection');
  assert(gameScene.includes('setQaHudHidden(true)'), 'UI group hides via setQaHudHidden (HUD only, modal stays visible)');
  assert(!gameScene.includes("setVisible(false, 'UI')"), 'UI group no longer hides the whole UI scene (modal freeze fixed)');
  assert(gameScene.includes('setQaHidden(true)'), 'atmo group hides via AtmosphereSystem');
  assert(gameScene.includes('this.vignette.setVisible(false)'), 'vignette hides with the atmo group');
  assert(!gameScene.includes('performance.now()'), 'GameScene has no direct performance.now() outside the overlay module');
  // Visibility-only: no destroy/deactivate of hidden objects in the new paths.
  const applyStart = gameScene.indexOf('private applyQaHide');
  const applyEnd = gameScene.indexOf('\n  update(time', applyStart);
  const hideBlock = gameScene.slice(applyStart, applyEnd);
  assert(!hideBlock.includes('.destroy('), 'applyQaHide destroys nothing');
  assert(!hideBlock.includes('setActive(false)'), 'applyQaHide deactivates nothing');

  // --- source contract: atmosphere re-hides itself ---
  const atmo = readFileSync(resolve('src/systems/AtmosphereSystem.ts'), 'utf8');
  assert(atmo.includes('setQaHidden(hidden: boolean)'), 'AtmosphereSystem exposes setQaHidden');
  assert(atmo.includes('if (this.qaHidden) this.hideAllAtmosphere();'), 'atmosphere re-hides at end of update');

  // --- source contract: overlay Text still lives in GameScene, not UI ---
  const qaPerf = readFileSync(resolve('src/game/qaPerf.ts'), 'utf8');
  assert(qaPerf.includes('hideLabel'), 'overlay carries the hide label');
  const overlayCtor = gameScene.indexOf('this.qaPerf = new QaPerfOverlay(');
  assert(overlayCtor >= 0 && gameScene.slice(overlayCtor, overlayCtor + 100).includes('\n        this,'), 'overlay is constructed on the Game scene');

  console.log('qa-render-split: OK (parsing, label, formatter, gated visibility-only wiring)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
