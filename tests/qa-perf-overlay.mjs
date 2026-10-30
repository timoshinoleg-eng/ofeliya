/**
 * QA perf overlay contract — measurement-only diagnostic (no gameplay change).
 *
 * Covers the pure logic (QaPerfStats window average + session max, formatter
 * labels incl. measured-vs-derived honesty) and the production gate as a
 * source contract on GameScene.ts:
 * - the overlay is constructed only behind the existing QA gate expression
 *   (dev or VITE_QA_TOOLS=1, same as main.ts);
 * - every probe call site in GameScene is guarded by `if (this.qaPerf)`;
 * - qaPerf.ts itself never reads import.meta.env (gate lives in the caller);
 * - exactly one Text object is created (in the overlay constructor).
 * Compiles the TS module with tsc like the other node-side contract tests.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(resolve('.'), '.tmp-ofeliya-qaperf-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`qa-perf-overlay: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const near = (actual, expected, eps, message) =>
  assert(Math.abs(actual - expected) <= eps, `${message}: expected ~${expected}, got ${actual}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
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

  const { QaPerfStats, formatQaPerfLines, QA_PERF_KEYS } = require(join(temp, 'qaPerf.js'));

  // --- stats: window average, session max survives eviction ---
  const stats = new QaPerfStats(3);
  stats.record(10);
  stats.record(20);
  stats.record(30);
  near(stats.avg(), 20, 1e-9, 'avg of 10/20/30');
  eq(stats.max(), 30, 'session max after 3 samples');
  stats.record(40); // evicts 10
  near(stats.avg(), 30, 1e-9, 'avg after eviction (20+30+40)/3');
  eq(stats.max(), 40, 'session max after eviction');
  stats.record(5); // evicts 20; session max must NOT drop
  eq(stats.max(), 40, 'session max survives low samples');
  near(stats.avg(), 25, 1e-9, 'avg after second eviction (30+40+5)/3');
  eq(stats.sampleCount, 3, 'window capped at size');
  eq(stats.frameCount, 5, 'frameCount counts all records');

  // --- stats: invalid input ignored ---
  const bad = new QaPerfStats(4);
  bad.record(NaN);
  bad.record(-1);
  bad.record(Infinity);
  eq(bad.sampleCount, 0, 'NaN/negative/Infinity ignored');
  eq(bad.avg(), 0, 'avg of empty window is 0');
  eq(bad.max(), 0, 'max of empty window is 0');

  // --- stats: begin/end pairing via overlay is covered by key set ---
  assert(QA_PERF_KEYS.includes('frame'), 'keys include frame');
  assert(QA_PERF_KEYS.includes('render'), 'keys include render');
  assert(QA_PERF_KEYS.includes('physics'), 'keys include physics');
  assert(QA_PERF_KEYS.includes('other'), 'keys include derived other');
  assert(QA_PERF_KEYS.includes('tryFire'), 'keys include tryFire');
  assert(QA_PERF_KEYS.includes('atmosphere'), 'keys include atmosphere');
  eq(QA_PERF_KEYS.length, 13, '13 measured/derived rows');

  // --- formatter: rows, honesty labels, worst line ---
  const rows = {};
  for (const key of QA_PERF_KEYS) rows[key] = { avg: 1.5, max: 9.5 };
  rows.frame = { avg: 16.7, max: 42.1 };
  const counters = { enemies: 203, bullets: 87, gems: 154, density: 203, tier: 'balanced' };
  const worst = { enemies: 210, bullets: 140, gems: 180, density: 210, tier: 'low' };
  const lines = formatQaPerfLines(rows, 120, 60, counters, 42.1, worst);
  const text = lines.join('\n');
  assert(text.includes('frame 16.7/42.1'), 'frame row formatted');
  assert(text.includes('render 1.5/9.5 (measured)'), 'render labelled measured');
  assert(text.includes('physics 1.5/9.5 (measured)'), 'physics labelled measured');
  assert(text.includes('other 1.5/9.5 (derived: frame-physics-update-render)'), 'other labelled derived with formula');
  assert(text.includes('E 203 B 87 G 154 | density 203 | tier balanced'), 'counters row');
  assert(text.includes('worst 42.1ms @ E210 B140 G180'), 'worst-frame row with counters');
  const noWorst = formatQaPerfLines(rows, 0, 0, counters, 0, null).join('\n');
  assert(!noWorst.includes('worst'), 'no worst line before any frame');

  // --- source contract: gate + guarded probes in GameScene.ts ---
  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  const gate = "import.meta.env.DEV || import.meta.env.VITE_QA_TOOLS === '1'";
  assert(gameScene.includes(gate), 'GameScene uses the existing QA gate expression');
  const gateIdx = gameScene.indexOf(gate);
  const constructIdx = gameScene.indexOf('new QaPerfOverlay');
  assert(constructIdx > gateIdx, 'overlay construction follows the gate expression');
  assert(constructIdx - gateIdx < 600, 'overlay construction is inside the gated block');
  for (const line of gameScene.split('\n')) {
    if (/qaPerf\.(begin|end|beginUpdate|endUpdate)\(/.test(line)) {
      assert(line.includes('if (this.qaPerf)'), `unguarded probe call site: ${line.trim()}`);
    }
  }
  assert(!gameScene.includes('performance.now()'), 'GameScene has no direct performance.now() outside the overlay module');

  // --- source contract: qaPerf.ts owns the gate-free, single-Text design ---
  const qaPerf = readFileSync(resolve('src/game/qaPerf.ts'), 'utf8');
  assert(!qaPerf.includes('import.meta.env'), 'qaPerf.ts never reads import.meta.env (gate lives in caller)');
  eq((qaPerf.match(/\.text\(\s*8,\s*8/g) || []).length, 1, 'exactly one Text object is created');
  assert(qaPerf.includes('>= 250'), 'text refresh throttled to ~4 Hz');
  assert(qaPerf.includes('setText'), 'single Text object is reused via setText');
  assert(qaPerf.includes("'prerender'") && qaPerf.includes("'postrender'"), 'render measured via game render events');
  assert(qaPerf.includes("'preupdate'") && qaPerf.includes("'update'"), 'physics measured via scene update events');

  console.log('qa-perf-overlay: OK (stats, formatter, gate + guarded probes)');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
