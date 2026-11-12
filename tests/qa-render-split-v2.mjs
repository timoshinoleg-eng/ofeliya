/**
 * QA render-split v2 contract — in-fight toggle buttons, modal-safe UI
 * hiding, fps removal, overlay readability.
 *
 * Covers the pure logic (toggleQaHide: initial state from ?qaHide=, flip
 * on/off, canonical label) and source contracts on the wiring:
 * - toggle buttons are created ONLY inside the existing QA gate in
 *   GameScene.create, live in GameScene (not UIScene), and flip groups via
 *   toggleQaHideGroup (pointerdown, no reload);
 * - the overlay label follows toggles live via setHideLabel;
 * - the overlay Text moved below the HUD band (y 103) and the fps figure
 *   is gone from the header;
 * - ui-hide goes through setQaHudHidden (persistent HUD only): the method
 *   body never references the level-up modal, and UIScene.update guards
 *   re-showing combo/boss with qaHudHidden;
 * - gems un-hide restores only active pooled gems (inactive ones stay
 *   invisible); vignette restore uses its recorded normal visibility;
 * - atmosphere un-hide restores the hide-time visibility snapshot;
 * - prod-cost wording is honest: 'negligible, not measured', not 'zero'.
 * Compiles the TS modules with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-qahide-v2-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`qa-render-split-v2: ${message}`);
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

  const { parseQaHide, qaHideLabel, toggleQaHide } = require(join(temp, 'qaHide.js'));
  const { formatQaPerfLines, QA_PERF_KEYS } = require(join(temp, 'qaPerf.js'));

  // --- toggle: add / remove / from an initial ?qaHide= state ---
  setEq(toggleQaHide(new Set(), 'gems'), ['gems'], 'toggle on from empty');
  setEq(toggleQaHide(new Set(['gems']), 'gems'), [], 'toggle off returns to empty');
  const initial = parseQaHide('?qaHide=gems,ui');
  const afterAtmo = toggleQaHide(initial, 'atmo');
  setEq(afterAtmo, ['gems', 'atmo', 'ui'], 'toggle adds a third group to the initial state');
  setEq(initial, ['gems', 'ui'], 'toggle never mutates its input set');
  const afterUiOff = toggleQaHide(afterAtmo, 'ui');
  setEq(afterUiOff, ['gems', 'atmo'], 'toggle off removes exactly one group');
  eq(qaHideLabel(afterAtmo), 'gems,atmo,ui', 'label follows toggles in canonical order');
  eq(qaHideLabel(afterUiOff), 'gems,atmo', 'label drops the toggled-off group');

  // --- formatter: no fps, short derived note, hide line still works ---
  const rows = {};
  for (const key of QA_PERF_KEYS) rows[key] = { avg: 1.5, max: 9.5 };
  const counters = { enemies: 12, bullets: 5, gems: 77, density: 12, tier: 'low' };
  const text = formatQaPerfLines(rows, 120, counters, 42.1, null, 'gems').join('\n');
  assert(!text.includes('fps'), 'header carries no fps figure (removed as misleading)');
  assert(text.includes('QA PERF avg/max ms (120f)'), 'header keeps frame count, ms only');
  assert(text.includes('other 1.5/9.5 (derived)'), 'other row uses the short derived note');
  assert(!text.includes('frame-physics-update-render'), 'long derived formula no longer in the row (narrow-screen fit)');
  assert(text.includes('hide: gems'), 'hide line still shown when a label is passed');

  // --- source contract: buttons live in GameScene, inside the QA gate ---
  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  const uiScene = readFileSync(resolve('src/scenes/UIScene.ts'), 'utf8');
  const qaPerf = readFileSync(resolve('src/game/qaPerf.ts'), 'utf8');
  const atmo = readFileSync(resolve('src/systems/AtmosphereSystem.ts'), 'utf8');
  const gate = "import.meta.env.DEV || import.meta.env.VITE_QA_TOOLS === '1'";
  const gateIdx = gameScene.indexOf(gate);
  const buttonsIdx = gameScene.indexOf('this.createQaToggleButtons()');
  assert(buttonsIdx > gateIdx, 'toggle buttons are created inside the QA gate block');
  assert(gameScene.includes('toggleQaHideGroup(group)'), 'buttons flip groups via toggleQaHideGroup');
  assert(gameScene.includes("btn.on('pointerdown'"), 'buttons toggle on tap (pointerdown)');
  assert(!uiScene.includes('qaToggleButtons'), 'buttons do not live in UIScene (ui-hide cannot hide them)');
  assert(!uiScene.includes('toggleQaHideGroup'), 'toggle logic does not live in UIScene');
  assert(qaPerf.includes('setHideLabel(label: string)'), 'overlay exposes setHideLabel for live label updates');
  assert(gameScene.includes('this.qaPerf?.setHideLabel(qaHideLabel(this.qaHide))'), 'applied selection refreshes the overlay label');
  assert(qaPerf.includes('.text(8, 103,'), 'overlay moved below the HUD band (plate top 5 + height 90 + margin)');

  // --- source contract: modal-safe UI hiding ---
  assert(gameScene.includes('setQaHudHidden'), 'ui-hide goes through setQaHudHidden, not the scene flag');
  assert(uiScene.includes('public qaHudHidden = false'), 'UI scene carries the qaHudHidden flag');
  const methodStart = uiScene.indexOf('public setQaHudHidden');
  assert(methodStart > 0, 'UIScene exposes setQaHudHidden');
  const methodWindow = uiScene.slice(methodStart, methodStart + 2000);
  assert(!methodWindow.includes('this.modal'), 'setQaHudHidden never touches the level-up modal');
  assert(uiScene.includes('!this.qaHudHidden && showCombo'), 'combo re-show is guarded by qaHudHidden');
  assert(uiScene.includes('boss && !this.qaHudHidden'), 'boss bars re-show is guarded by qaHudHidden');
  assert(uiScene.includes('setQaHudHidden(true)') === false, 'UIScene itself never forces the hide on (GameScene owns it)');

  // --- source contract: restores are state-correct ---
  assert(gameScene.includes('else if (gem.active) gem.setVisible(true)'), 'gems un-hide restores only active pooled gems');
  assert(gameScene.includes('vignetteNormalVisible'), 'vignette restore uses its recorded normal visibility');
  assert(atmo.includes('qaHiddenVisible'), 'atmosphere records hide-time visibility for restore');
  assert(atmo.includes('if (hidden && !this.qaHidden)'), 'atmosphere records only on the hide transition, not every re-hide');

  // --- source contract: honest prod-cost wording ---
  assert(gameScene.includes('negligible, not measured'), 'prod-cost wording is negligible/not-measured, not zero');
  assert(!gameScene.includes('no hot-path cost'), 'old zero-cost claim is gone from GameScene');

  console.log('qa-render-split-v2: OK (toggle, live label, modal-safe ui-hide, no fps, overlay position, restores)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
