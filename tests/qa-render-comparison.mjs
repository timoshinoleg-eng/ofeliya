/**
 * Contract test for manually started QA-only A/B/A comparison of GEMS / ATMO / UI.
 * Compiles the pure controller and perf formatter, then checks completed pairs,
 * partial persistence on player death, original-state restoration and GameScene wiring.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-qa-render-compare-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`qa-render-comparison: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const near = (actual, expected, message) =>
  assert(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
const setEq = (actual, expected, message) =>
  eq([...actual].sort().join(','), [...expected].sort().join(','), message);

class MemoryStorage {
  values = new Map();
  setItem(key, value) {
    this.values.set(key, value);
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/qaHide.ts',
      'src/game/qaRenderComparison.ts',
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

  const {
    QaRenderComparison,
    QA_RENDER_COMPARE_PHASE_FRAMES,
    QA_RENDER_COMPARE_REPEATS,
    QA_RENDER_COMPARE_STORAGE_KEY,
    QA_RENDER_COMPARE_WARMUP_FRAMES,
    formatQaRenderComparisonReport,
    isQaRenderComparisonEnabled,
  } = require(join(temp, 'qaRenderComparison.js'));
  const { formatQaPerfLines, QA_PERF_KEYS } = require(join(temp, 'qaPerf.js'));

  eq(isQaRenderComparisonEnabled('?qaCompare=render'), true, 'QA query enables manual comparison controls');
  eq(isQaRenderComparisonEnabled('?qaCompare=1'), false, 'other query values do not enable comparison');
  eq(isQaRenderComparisonEnabled('?qaHide=gems'), false, 'manual hide query remains independent');

  // Full run: nine 1-frame phases, A/B/A for each group; only one group flips at a time.
  const storage = new MemoryStorage();
  const applied = [];
  const labels = [];
  const original = new Set(['ui']);
  const defaultSetup = new QaRenderComparison(new Set(), { applyHidden() {} }).snapshot();
  eq(defaultSetup.phaseFrames, QA_RENDER_COMPARE_PHASE_FRAMES, 'default measured window size is recorded');
  eq(defaultSetup.repeats, QA_RENDER_COMPARE_REPEATS, 'default repeat count is recorded');
  eq(defaultSetup.warmupFrames, QA_RENDER_COMPARE_WARMUP_FRAMES, 'default discarded warmup is recorded');
  eq(defaultSetup.plannedPhases, 27, 'default setup plans three A/B/A repeats per visibility group');

  const comparison = new QaRenderComparison(original, {
    phaseFrames: 1,
    initialWarmupFrames: 0,
    repeats: 1,
    warmupFrames: 0,
    storage,
    applyHidden: (selection) => applied.push([...selection].sort().join(',')),
    onLabel: (label) => labels.push(label),
  });
  const renderMs = [10, 5, 14, 20, 21, 22, 30, 31, 32];
  for (let i = 0; i < renderMs.length; i++) {
    comparison.record({
      frameMs: renderMs[i] + 4,
      renderMs: renderMs[i],
      counters: { enemies: 10 + i, bullets: 2 + i, gems: 3, density: 10, tier: 'balanced' },
    });
  }
  const complete = comparison.snapshot();
  eq(complete.status, 'complete', 'all planned phases complete automatically');
  eq(complete.schemaVersion, 2, 'expanded comparison report has a new schema version');
  eq(complete.stopReason, 'completed', 'completed run records its reason');
  eq(complete.phases.length, 9, 'all nine A/B/A windows are recorded');
  assert(complete.phases.every((phase) => phase.complete && phase.frames === 1), 'each completed phase has its expected sample');
  eq(complete.persistence, 'saved', 'successful storage is reported');
  eq(applied.at(-1), 'ui', 'completion restores the original hidden groups');
  eq(complete.phases[0].hiddenGroups.join(','), 'ui', 'first baseline uses original state');
  eq(complete.phases[1].hiddenGroups.join(','), 'gems,ui', 'GEMS phase flips only GEMS');
  eq(complete.phases[4].hiddenGroups.join(','), 'atmo,ui', 'ATMO phase flips only ATMO');
  eq(complete.phases[7].hiddenGroups.join(','), '', 'UI phase flips only UI');
  const gemsPair = complete.comparisons.find((pair) => pair.group === 'gems');
  assert(gemsPair, 'complete GEMS pair is present');
  eq(gemsPair.repeatCount, 1, 'pair reports its configured number of repeats');
  eq(gemsPair.baselineWindows, 2, 'pair combines before and after baseline windows');
  eq(gemsPair.oppositeWindows, 1, 'pair records the flipped window count');
  near(gemsPair.baselineRenderAvgMs, 12, 'GEMS baseline averages before/after control windows');
  near(gemsPair.oppositeRenderAvgMs, 5, 'GEMS opposite render average is recorded');
  near(gemsPair.renderDeltaMs, -7, 'GEMS render delta is computed, not presented as FPS');
  near(gemsPair.baselineFrameMaxMs, 18, 'GEMS baseline frame maximum combines both control windows');
  near(gemsPair.oppositeFrameP95Ms, 9, 'single-sample opposite p95 is recorded');
  near(gemsPair.frameP95DeltaMs, -9, 'paired p95 frame delta is computed');
  near(complete.phases[0].frameMaxMs, 14, 'per-window frame maximum is recorded');
  near(complete.phases[0].frameP95Ms, 14, 'per-window frame p95 is recorded');
  eq(complete.phases[0].counters.enemiesAvg, 10, 'per-window object counts are retained');
  eq(complete.phases[0].counters.densityMax, 10, 'density maximum is retained');
  const saved = JSON.parse(storage.getItem(QA_RENDER_COMPARE_STORAGE_KEY));
  eq(saved.status, 'complete', 'completed result survives in localStorage');
  eq(saved.comparisons.length, 3, 'stored result has three group comparisons');
  const report = formatQaRenderComparisonReport(complete);
  eq(JSON.parse(report).status, 'complete', 'clipboard report is valid snapshot JSON');
  assert(report.includes('"renderDeltaMs": -7'), 'clipboard report includes the A/B render delta');
  assert(report.includes('"frameP95DeltaMs": -9'), 'clipboard report includes the p95 frame delta');
  assert(labels.some((label) => label.includes('complete 9/9 saved')), 'overlay label announces completion and persistence');

  // Two repeats per group; discard two deliberately slow warmup samples per window.
  const repeated = new QaRenderComparison(new Set(), {
    phaseFrames: 20,
    initialWarmupFrames: 0,
    repeats: 2,
    warmupFrames: 2,
    applyHidden() {},
  });
  for (let phaseIndex = 0; phaseIndex < 18; phaseIndex += 1) {
    for (let warmupIndex = 0; warmupIndex < 2; warmupIndex += 1) {
      repeated.record({
        frameMs: 9000 + warmupIndex,
        renderMs: 8000 + warmupIndex,
        counters: { enemies: 999, bullets: 999, gems: 999, density: 999, tier: 'warmup' },
      });
    }
    for (let frame = 1; frame <= 20; frame += 1) {
      repeated.record({
        frameMs: phaseIndex * 100 + frame,
        renderMs: phaseIndex * 10 + frame,
        counters: { enemies: 20, bullets: 4, gems: 2, density: 20, tier: 'measured' },
      });
    }
  }
  const repeatedResult = repeated.snapshot();
  eq(repeatedResult.status, 'complete', 'all repeated windows complete');
  eq(repeatedResult.phases.length, 18, 'two repeats create six windows for each of three groups');
  assert(repeatedResult.phases.every((phase) => phase.complete && phase.frames === 20 && phase.warmupFrames === 2), 'each window separately records discarded warmup and measured frames');
  eq(repeatedResult.phases[0].repeatIndex, 1, 'first window identifies the first repeat');
  eq(repeatedResult.phases[9].repeatIndex, 2, 'second round identifies the second repeat');
  near(repeatedResult.phases[0].frameP95Ms, 19, 'phase p95 uses nearest-rank percentile of measured samples');
  near(repeatedResult.phases[0].frameMaxMs, 20, 'phase maximum excludes slow warmup samples');
  near(repeatedResult.phases[0].counters.enemiesAvg, 20, 'warmup counters do not enter measured summaries');
  const repeatedGems = repeatedResult.comparisons.find((pair) => pair.group === 'gems');
  assert(repeatedGems, 'repeated GEMS pair is present');
  eq(repeatedGems.baselineWindows, 4, 'repeated pair combines all four control windows');
  eq(repeatedGems.oppositeWindows, 2, 'repeated pair combines both flipped windows');
  eq(repeatedGems.baselineFrames, 80, 'baseline sample count excludes all warmup frames');
  eq(repeatedGems.oppositeFrames, 40, 'opposite sample count excludes all warmup frames');
  near(repeatedGems.baselineFrameMaxMs, 1120, 'aggregated baseline maximum uses every repeated window');
  near(repeatedGems.oppositeFrameMaxMs, 1020, 'aggregated opposite maximum uses every repeated window');
  near(repeatedGems.baselineFrameP95Ms, 1116, 'aggregated baseline p95 uses all raw measured samples');
  near(repeatedGems.oppositeFrameP95Ms, 1018, 'aggregated opposite p95 uses all raw measured samples');
  near(repeatedGems.frameP95DeltaMs, -98, 'repeated p95 difference is opposite minus baseline');

  // Death: retain both finished windows and the in-progress partial window before restoring.
  const deathStorage = new MemoryStorage();
  const deathApplied = [];
  const interrupted = new QaRenderComparison(new Set(['atmo']), {
    phaseFrames: 3,
    initialWarmupFrames: 0,
    repeats: 1,
    warmupFrames: 0,
    storage: deathStorage,
    applyHidden: (selection) => deathApplied.push([...selection].sort().join(',')),
  });
  for (const value of [11, 12, 13, 21, 22]) {
    interrupted.record({
      frameMs: value + 3,
      renderMs: value,
      counters: { enemies: value, bullets: 4, gems: 2, density: value, tier: 'low' },
    });
  }
  interrupted.finish('player-death');
  const partial = JSON.parse(deathStorage.getItem(QA_RENDER_COMPARE_STORAGE_KEY));
  eq(partial.status, 'interrupted', 'death marks the comparison partial');
  eq(partial.stopReason, 'player-death', 'death reason is persisted');
  eq(partial.phases.length, 2, 'completed and current partial phases both survive');
  eq(partial.phases[0].complete, true, 'finished baseline remains complete');
  eq(partial.phases[1].complete, false, 'current phase is marked partial');
  eq(partial.phases[1].frames, 2, 'partial phase retains its samples');
  eq(partial.comparisons.find((pair) => pair.group === 'gems').oppositeFrames, 2, 'partial A/B comparison remains usable');
  eq(deathApplied.at(-1), 'atmo', 'death restores the original visibility selection');

  // A manual toggle also stops safely; a broken storage environment never crashes the game.
  const unavailable = new QaRenderComparison(new Set(), {
    phaseFrames: 2,
    initialWarmupFrames: 0,
    repeats: 1,
    warmupFrames: 0,
    storage: { setItem() { throw new Error('storage disabled'); } },
    applyHidden() {},
  });
  eq(unavailable.snapshot().persistence, 'unavailable', 'storage failures are surfaced');
  unavailable.record({ frameMs: 20, renderMs: 4, counters: { enemies: 1, bullets: 0, gems: 0, density: 1, tier: 'low' } });
  unavailable.finish('manual-stop');
  eq(unavailable.snapshot().stopReason, 'manual-stop', 'manual cancellation keeps its reason');
  assert(unavailable.snapshot().phases[0].frames === 1, 'manual stop keeps the partial phase in memory');

  const warmupStop = new QaRenderComparison(new Set(), {
    phaseFrames: 2,
    initialWarmupFrames: 0,
    repeats: 1,
    warmupFrames: 3,
    applyHidden() {},
  });
  for (const frameMs of [500, 600]) {
    warmupStop.record({ frameMs, renderMs: frameMs / 2, counters: { enemies: 1, bullets: 0, gems: 0, density: 1, tier: 'warmup' } });
  }
  warmupStop.finish('manual-stop');
  const warmupPartial = warmupStop.snapshot().phases[0];
  eq(warmupPartial.warmupFrames, 2, 'interrupted warmup reports discarded samples');
  eq(warmupPartial.frames, 0, 'warmup samples are not counted as measured frames');
  eq(warmupPartial.frameAvgMs, null, 'warmup-only windows have no measured average');

  const rows = {};
  for (const key of QA_PERF_KEYS) rows[key] = { avg: 1, max: 2 };
  const lines = formatQaPerfLines(rows, 120, { enemies: 1, bullets: 0, gems: 0, density: 1, tier: 'low' }, 2, null, 'none', '3/9 atmo flip 30/120 saved');
  assert(lines.some((line) => line.includes('compare: 3/9 atmo flip')), 'overlay exposes comparison progress');

  // Source wiring: the URL only exposes controls; a tap starts the run using the live hide selection.
  // Samples still come from real rendered frames; death/manual stop persist and restore settings.
  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8').replace(/\r\n/g, '\n');
  const qaPerf = readFileSync(resolve('src/game/qaPerf.ts'), 'utf8');
  const gate = "if (import.meta.env.DEV || import.meta.env.VITE_QA_TOOLS === '1')";
  const gateIdx = gameScene.indexOf(gate);
  const compareIdx = gameScene.indexOf('isQaRenderComparisonEnabled(window.location.search)');
  assert(gateIdx >= 0 && compareIdx > gateIdx, 'comparison query is read only after the existing QA gate');
  assert(gameScene.includes('this.createQaRenderComparisonControls();'), 'manual comparison and report controls are created for an opted-in QA session');
  const startupEndIdx = gameScene.indexOf('// QA fixed mutation-choice states', compareIdx);
  assert(startupEndIdx > compareIdx, 'comparison setup precedes fixed QA fixtures');
  assert(!gameScene.slice(compareIdx, startupEndIdx).includes('new QaRenderComparison('), 'QA query does not auto-start the comparison');
  assert(gameScene.includes("button.on('pointerup', () => this.startQaRenderComparison());"), 'explicit button tap starts the comparison');
  assert(gameScene.includes('new QaRenderComparison(new Set(this.qaHide)'), 'manual start snapshots the current visibility selection');
  assert(gameScene.includes('this.createQaRenderReportButton();'), 'copy-report control remains available alongside manual start');
  assert(gameScene.includes('formatQaRenderComparisonReport(snapshot)'), 'button copies the live comparison snapshot');
  assert(gameScene.includes('if (navigator.clipboard?.writeText)'), 'clipboard API is attempted first');
  assert(gameScene.includes("document.execCommand('copy')"), 'embedded-WebView clipboard fallback is available');
  assert(gameScene.includes('this.qaComparison?.record({ ...sample, visibilityState: document.visibilityState })'), 'measured samples and visibility feed the controller');
  assert(gameScene.includes('compareEnabled ? (sample) =>'), 'extra per-frame sampling is opt-in');
  assert(gameScene.includes('this.qaComparison?.finish(!win && this.runState.stage.hp <= 0 ? \'player-death\' : \'run-ended\')'), 'run finish saves partial data before the result is built');
  assert(gameScene.includes("this.qaComparison?.finish('manual-stop')"), 'manual group toggles stop and restore the comparison');
  assert(gameScene.includes("this.qaComparison?.finish('run-ended');\n    this.saveCheckpointNow();"), 'leaving to menu saves partial data and restores settings');
  assert(gameScene.includes('this.applyQaHideSelection(selection)'), 'selection application has a restoration path');
  assert(qaPerf.includes('this.onFrameSample?.({ frameMs, renderMs, counters })'), 'overlay forwards measured frame and render durations');
  assert(!qaPerf.includes('import.meta.env'), 'comparison module remains gate-free; caller owns the QA gate');

  console.log('qa-render-comparison: OK (A/B/A, counters, restore, death persistence, manual stop, report copy, QA gate)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
