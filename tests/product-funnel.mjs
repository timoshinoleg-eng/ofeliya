#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(repo, 'scripts', 'analyze-product-funnel.mjs');
const temp = mkdtempSync(join(tmpdir(), 'ofeliya-product-funnel-'));
const chain = [
  'host_cell_approached',
  'infection_started',
  'first_lysis',
  'second_host_cell_completed_without_hint',
];
const runs = [
  { platform: 'max', actor: 'ACTOR_PRIVATE_1', id: 'sameSeedRunA', firstRun: true, start: 0, lysis: 0, reversed: true },
  { platform: 'max', actor: 'ACTOR_PRIVATE_1', id: 'sameSeedRunB', firstRun: true, start: 0, lysis: 1000 },
  { platform: 'telegram', actor: 'ACTOR_PRIVATE_2', id: 'sameSeedRunA', firstRun: true, start: 0, lysis: 2000 },
  { platform: 'max', actor: 'ACTOR_PRIVATE_3', id: 'fourthRunId', firstRun: true, start: 0, lysis: 3000 },
];
const rows = [];
function row(platform, actor, event, props, ts) {
  return { platform, actor, event, props, ts };
}
for (const run of runs) {
  const times = [run.start, run.start, run.start, run.lysis, run.lysis];
  const names = ['run_start', ...chain];
  const emitted = names.map((event, index) => row(run.platform, run.actor, event, {
    analyticsRunId: run.id,
    runTimeMs: times[index],
    firstRun: run.firstRun,
    release: 'test-release',
  }, run.reversed ? 1000 - index : index));
  if (run.reversed) emitted.reverse(); // receipt order opposes gameplay order
  rows.push(...emitted);
  if (run.id === 'sameSeedRunA' && run.platform === 'max') {
    rows.push(row(run.platform, run.actor, 'first_lysis', {
      analyticsRunId: run.id, runTimeMs: run.lysis, firstRun: run.firstRun, release: 'test-release',
    }, 9999)); // duplicate delivery must not duplicate the event or run
  }
}

// Same context except for missing run_start: partial delivery must stay unanchored/unknown.
const noStart = { platform: 'max', actor: 'ACTOR_PRIVATE_NO_START', id: 'missingStartRun', firstRun: false };
for (const event of chain) rows.push(row(noStart.platform, noStart.actor, event, {
  analyticsRunId: noStart.id, runTimeMs: 10, firstRun: noStart.firstRun, release: 'test-release',
}, 500));
// A start-anchored partial chain has unobserved later milestones, not a comprehension failure.
const partial = { platform: 'max', actor: 'ACTOR_PRIVATE_PARTIAL', id: 'partialRunId', firstRun: true };
rows.push(row(partial.platform, partial.actor, 'run_start', { analyticsRunId: partial.id, runTimeMs: 0, firstRun: true, release: 'test-release' }, 1));
rows.push(row(partial.platform, partial.actor, chain[0], { analyticsRunId: partial.id, runTimeMs: 0, firstRun: true, release: 'test-release' }, 2));
rows.push(row('max', 'ACTOR_PRIVATE_LEGACY', chain[0], { source: 'old' }, 3));
rows.push(row('max', 'ACTOR_PRIVATE_MISSING_FIRST_RUN', chain[1], { analyticsRunId: 'missingFlagRun', runTimeMs: 5, release: 'test-release' }, 4));
rows.push(row('max', 'ACTOR_PRIVATE_MALFORMED', chain[2], { analyticsRunId: 'bad', runTimeMs: -1, firstRun: 'yes', release: 7 }, 5));
rows.push(row('max', 'ACTOR_PRIVATE_PARTIAL_CONTEXT', chain[0], { runTimeMs: 25, firstRun: true, release: 'test-release' }, 6));
const returning = { platform: 'max', actor: 'ACTOR_PRIVATE_RETURNING', id: 'returningRun', firstRun: false };
rows.push(row(returning.platform, returning.actor, 'run_start', { analyticsRunId: returning.id, runTimeMs: 0, firstRun: false, release: 'test-release' }, 7));
for (const event of chain) rows.push(row(returning.platform, returning.actor, event, {
  analyticsRunId: returning.id, runTimeMs: 5000, firstRun: false, release: 'test-release',
}, 8));

function report(name, store) {
  const dir = join(temp, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'store.json');
  writeFileSync(path, JSON.stringify(store));
  const result = spawnSync(process.execPath, [cli, path], { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `CLI failed for ${name}: ${result.stderr}`);
  return result.stdout;
}

try {
  const output = report('full', { analyticsEvents: rows });
  assert.match(output, /Comprehension telemetry \(observed events, not a measure of understanding\):/);
  assert.match(output, /contextual runs=8/);
  assert.match(output, /legacy\/partial uncorrelated rows=2/);
  assert.match(output, /malformed-context rows=1/);
  assert.match(output, /Rows with missing firstRun metadata: 1/);
  assert.match(output, /Run sequencing: order uses runTimeMs \(equal times allowed\), never receipt timestamps/);
  assert.match(output, /All contextual runs \(approach → lysis; second-cell step is first-run-only\): run_start observed=6; missing run_start=2/);
  assert.match(output, /observed ordered through first_lysis: 5\/6/);
  assert.match(output, /fully observed approach-to-lysis chain: 5\/6/);
  assert.match(output, /median first-lysis game time from run_start: 2000 ms \(n=5 runs/);
  assert.match(output, /Eligible first-run subset \(four-step chain\): run_start observed=5/);
  assert.match(output, /observed ordered through second_host_cell_completed_without_hint: 4\/5/);
  assert.match(output, /fully observed four-step chain: 4\/5/);
  assert.match(output, /median first-lysis game time from run_start: 1500 ms \(n=4 runs/);
  assert.match(output, /First observed infection_interrupted: contextual runs=0/);
  for (const privateValue of ['ACTOR_PRIVATE_', 'sameSeedRunA', 'sameSeedRunB', 'missingStartRun', 'partialRunId']) {
    assert.ok(!output.includes(privateValue), `CLI leaked private identifier fragment ${privateValue}`);
  }

  const zero = report('zero', { analyticsEvents: [
    row('max', 'ZERO_PRIVATE_ACTOR', 'run_start', { analyticsRunId: 'zeroRuntimeRun', runTimeMs: 0, firstRun: true, release: 'x' }, 100),
    row('max', 'ZERO_PRIVATE_ACTOR', 'first_lysis', { analyticsRunId: 'zeroRuntimeRun', runTimeMs: 0, firstRun: true, release: 'x' }, 1),
  ] });
  assert.match(zero, /median first-lysis game time from run_start: 0 ms \(n=1 runs/);
  assert.ok(!zero.includes('ZERO_PRIVATE_ACTOR'));

  const legacy = report('legacy', { analyticsEvents: [row('max', 'OLD_PRIVATE_ACTOR', chain[0], {}, 1)] });
  assert.match(legacy, /contextual runs=0; legacy\/partial uncorrelated rows=1/);
  assert.match(legacy, /All contextual runs \(approach → lysis; second-cell step is first-run-only\): run_start observed=0; missing run_start=0/);
  assert.ok(!legacy.includes('OLD_PRIVATE_ACTOR'));

  const empty = report('empty', { analyticsEvents: [] });
  assert.match(empty, /Comprehension rows=0; contextual runs=0; legacy\/partial uncorrelated rows=0; malformed-context rows=0/);
  assert.match(empty, /observed ordered through first_lysis: 0\/0/);

  const anchoredCohort = [];
  for (let index = 0; index < 10; index += 1) {
    const actor = `START_ONLY_PRIVATE_${index}`;
    const id = `startOnlyRun${index}`;
    anchoredCohort.push(row('max', actor, 'run_start', {
      analyticsRunId: id, runTimeMs: 0, firstRun: true, release: 'test-release',
    }, 100 - index));
    if (index === 0) {
      for (const event of chain) anchoredCohort.push(row('max', actor, event, {
        analyticsRunId: id, runTimeMs: 0, firstRun: true, release: 'test-release',
      }, index));
    }
  }
  const startsOnly = report('starts-only-denominator', { analyticsEvents: anchoredCohort });
  assert.match(startsOnly, /contextual runs=10/);
  assert.match(startsOnly, /All contextual runs \(approach → lysis; second-cell step is first-run-only\): run_start observed=10; missing run_start=0/);
  assert.match(startsOnly, /fully observed approach-to-lysis chain: 1\/10/);
  assert.match(startsOnly, /Eligible first-run subset \(four-step chain\): run_start observed=10/);
  assert.match(startsOnly, /Eligible first-run subset \(four-step chain\):[\s\S]*?fully observed four-step chain: 1\/10/);
  assert.ok(!startsOnly.includes('START_ONLY_PRIVATE_'));

  const nullStore = report('null-root', null);
  assert.match(nullStore, /Comprehension rows=0; contextual runs=0/);
  console.log('product funnel comprehension report CLI: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
