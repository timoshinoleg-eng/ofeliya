import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(resolve('.'), '.tmp-qa-methodology-'));
writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}');
try {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'),
    'src/game/qaHide.ts', 'src/game/qaRenderComparison.ts', '--target', 'ES2020',
    '--module', 'commonjs', '--moduleResolution', 'node', '--outDir', dir, '--skipLibCheck'], { stdio: 'inherit' });
  const { QaRenderComparison, QA_RENDER_COMPARE_STORAGE_KEY, QA_RENDER_COMPARE_PREVIOUS_KEY,
    readSavedQaRenderComparison } = createRequire(import.meta.url)(join(dir, 'qaRenderComparison.js'));
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
  const base = { enemies: 100, bullets: 10, gems: 25, density: 100, tier: 'full' };
  let now = 0;
  const q = new QaRenderComparison(new Set(), { applyHidden() {}, storage, phaseFrames: 4,
    warmupFrames: 0, initialWarmupFrames: 0, repeats: 1, now: () => now,
    metadata: { renderer: 'webgl', dpr: 3, canvas: { width: 384, height: 723 } } });
  for (const [i, tier] of ['full', 'full', 'balanced', 'low'].entries()) {
    now += 10;
    q.record({ frameMs: i === 2 ? 116911 : 10, renderMs: 4, counters: { ...base, tier, enemies: 100 + i }, visibilityState: 'visible' });
  }
  let phase = q.snapshot().phases[0];
  assert.deepEqual(phase.counters.tiers, ['full', 'balanced', 'low']);
  assert.equal(phase.counters.tierChanged, true);
  assert.deepEqual(phase.counters.tierTransitions, [
    { frame: 3, from: 'full', to: 'balanced' }, { frame: 4, from: 'balanced', to: 'low' },
  ]);
  assert.equal(phase.counters.enemiesMin, 100);
  assert.equal(phase.counters.enemiesMax, 103);
  assert.deepEqual(phase.longFrames, [{ frame: 3, ms: 116911, visibilityState: 'visible' }]);
  assert.equal(phase.longFrameCount, 1);
  assert.equal(phase.longMs, 116911);
  assert.equal(phase.frameMaxMs, 116911);
  assert.equal(phase.frameP50Ms, 10);
  assert.equal(phase.frameAvgMs, 29235.25);
  assert.equal(phase.frameP95Ms, 116911);
  for (let i = 0; i < 8; i++) q.record({ frameMs: 10, renderMs: 4, counters: { ...base, tier: 'low' }, visibilityState: 'visible' });
  const pair = q.snapshot().comparisons[0];
  assert.equal(pair.comparable, false);
  assert.equal(pair.renderDeltaMs, null);
  assert.equal(pair.repeatCount, 1);
  assert.equal(q.snapshot().metadata.renderer, 'webgl');

  const other = new QaRenderComparison(new Set(), { applyHidden() {}, storage, phaseFrames: 1,
    warmupFrames: 0, initialWarmupFrames: 0, repeats: 1, now: () => now });
  assert.equal(JSON.parse(storage.getItem(QA_RENDER_COMPARE_PREVIOUS_KEY)).status, 'running');
  assert.ok(readSavedQaRenderComparison(storage));
  other.record({ frameMs: 10, renderMs: 4, counters: base, visibilityState: 'visible' });
  now = 100; other.noteVisibility('hidden', now);
  now = 350; other.noteVisibility('visible', now);
  other.record({ frameMs: 11, renderMs: 5, counters: { ...base, density: 200 }, visibilityState: 'visible' });
  other.finish('player-death');
  const saved = JSON.parse(storage.getItem(QA_RENDER_COMPARE_STORAGE_KEY));
  assert.equal(saved.status, 'interrupted');
  assert.equal(saved.phases[1].hiddenMs, 250);
  assert.equal(saved.comparisons[0].comparable, false);
  assert.equal(saved.comparisons[0].renderDeltaMs, null);

  now = 0;
  const hidden = new QaRenderComparison(new Set(), { applyHidden() {}, phaseFrames: 2,
    warmupFrames: 0, initialWarmupFrames: 0, repeats: 1, now: () => now });
  now = 10; hidden.noteVisibility('hidden', now);
  hidden.record({ frameMs: 116911, renderMs: 4, counters: base, visibilityState: 'hidden' });
  now = 35; hidden.noteVisibility('visible', now);
  hidden.record({ frameMs: 10, renderMs: 4, counters: base, visibilityState: 'visible' });
  assert.equal(hidden.snapshot().phases[0].hiddenMs, 25);
  assert.deepEqual(hidden.snapshot().phases[0].longFrames, [{ frame: 1, ms: 116911, visibilityState: 'hidden' }]);

  const disjoint = new QaRenderComparison(new Set(), { applyHidden() {}, phaseFrames: 1,
    warmupFrames: 0, initialWarmupFrames: 0, repeats: 1 });
  for (const density of [100, 200, 100]) disjoint.record({ frameMs: 10, renderMs: 4, counters: { ...base, density } });
  const disjointPair = disjoint.snapshot().comparisons[0];
  assert.equal(disjointPair.comparable, false);
  assert.ok(disjointPair.incomparableReasons.includes('density-ranges-do-not-overlap'));
  assert.equal(disjointPair.renderDeltaMs, null);

  const plan = new QaRenderComparison(new Set(), { applyHidden() {}, phaseFrames: 1, warmupFrames: 0, initialWarmupFrames: 0, repeats: 2 });
  for (let i = 0; i < 18; i++) plan.record({ frameMs: 10, renderMs: 4, counters: base });
  assert.deepEqual(plan.snapshot().phases.map((p) => p.group), ['gems','gems','gems','atmo','atmo','atmo','ui','ui','ui','gems','gems','gems','atmo','atmo','atmo','ui','ui','ui']);
  const partialRepeats = new QaRenderComparison(new Set(), { applyHidden() {}, phaseFrames: 1, warmupFrames: 0, initialWarmupFrames: 0, repeats: 3 });
  for (let i = 0; i < 9; i++) partialRepeats.record({ frameMs: 10, renderMs: 4, counters: base });
  partialRepeats.finish('player-death');
  assert.ok(partialRepeats.snapshot().comparisons.every((pair) => pair.repeatCount === 1));
  const warming = new QaRenderComparison(new Set(), { applyHidden() {}, phaseFrames: 1, warmupFrames: 0, initialWarmupFrames: 300, repeats: 1 });
  for (let i = 0; i < 300; i++) warming.record({ frameMs: 10, renderMs: 4, counters: base });
  assert.equal(warming.snapshot().phases.length, 0);
  warming.record({ frameMs: 10, renderMs: 4, counters: base });
  assert.equal(warming.snapshot().phases.length, 1);
  console.log('PASS mixed tier, long frames, visibility, report retention, round robin and warmup');
} finally { rmSync(dir, { recursive: true, force: true }); }
