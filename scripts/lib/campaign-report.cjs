'use strict';
// Autonomous Campaign Harness — run report generator.
//
// Input:  a run directory (run.json + timeline.ndjson + screenshots), or a
//         parent directory of run directories (series mode: one subdir per
//         run, each with its own run.json — see §6.2 of the harness design).
// Output: validated run.json + single-file index.html (no build step, no
//         external dependencies: no CDN, no external images or fonts;
//         charts are inline SVG; screenshots are relative paths).
//
// Usage:
//   node scripts/lib/campaign-report.cjs --input <run-dir> --out <dir>
//   node scripts/lib/campaign-report.cjs --fixture
//     Materialises the fixture runs from campaign-report-fixture.json and
//     generates a report into /tmp/campaign-report-test/ (self-checked).
//
// Exit codes: 0 — report generated (even when the run verdict is FAIL; this
// is a reporting tool, not a gate), 1 — validation or I/O error,
// 2 — usage error.
//
// Zero dependencies: node:fs, node:path, node:zlib only.
//
// Design references (ofeliya-autonomous-campaign-harness-design-2026-11-18):
//   §6.3 run.json schema, §6.4 timeline markers, §6.5 HTML report.
//   Divergences from §6 are listed in the header of renderHtml() and in the
//   track-D handoff; the design doc itself is owned by the coordinator.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SCHEMA_VERSION = 1;
const FIXTURE_OUT_DIR = '/tmp/campaign-report-test';
const MAX_TIMELINE_ROWS = 500;
const DIAGNOSIS_WINDOW_MS = 10000;
const SCREENSHOT_WIDTH = 195;
const SCREENSHOT_HEIGHT = 422;

// Invariant catalog: names from §4.2–§4.4 and the §6.3 example. `expected`
// is the human-readable contract; unknown ids render with a generic text.
const INVARIANT_CATALOG = {
  finiteNumbers: {
    label: 'Finite numbers',
    expected: 'hp, maxHp, xp, coordinates, velocities, timers, score all finite',
  },
  waveProgressing: {
    label: 'Wave progressing',
    expected: 'waveId / aliveCount change within the watchdog interval',
  },
  saveValid: {
    label: 'Save valid',
    expected: 'localStorage save is valid JSON and passes migration round-trip',
  },
  listenerBaseline: {
    label: 'Listener baseline',
    expected: 'no listener / timer / tween growth after teardown vs baseline',
  },
  scoreContract: {
    label: 'Score contract',
    expected: 'score payload accepted by the local trusted validator',
  },
  stageOrder: {
    label: 'Stage order',
    expected: 'bloodstream → immune-prime → heart → cardiac-titan; stageOrder / stageId / difficultyId / runSeed agree',
  },
  monotonicCounters: {
    label: 'Monotonic counters',
    expected: 'kills, timeMs, hostCellsInfected never decrease',
  },
  bossDefeatCount: {
    label: 'Boss defeat count',
    expected: 'bossesDefeated increases by exactly 1 per transition',
  },
  cleanupAfterTransition: {
    label: 'Cleanup after transition',
    expected: 'old enemies, bullets, gems, timers, telegraphs inactive; wave.boss === null; no dangling transition token',
  },
  legendaryCap: {
    label: 'Legendary cap',
    expected: '≤ 2 legendaries per run, ≤ 1 random legendary before the first boss',
  },
  runResultConsistent: {
    label: 'Run result consistent',
    expected: 'RunState and runResult agree; rulesetVersion / campaignVersion / stage clear times valid',
  },
  noStuckInput: {
    label: 'No stuck input',
    expected: 'no modal, milestone, timer or input listener active after victory; input not stuck after reset',
  },
  heapGrowth: {
    label: 'Heap growth',
    expected: 'usedJSHeapSize growth < 15% vs the first run of the series',
  },
  noPageErrors: {
    label: 'No page errors',
    expected: 'zero pageerror / unhandledrejection / NaN in console over the series',
  },
  bossZeroHpVictory: {
    label: 'Boss 0 HP → victory',
    expected: 'boss at 0 HP always triggers the victory transition',
  },
  stateHashAdvancing: {
    label: 'State hash advancing',
    expected: 'stateHash changes while gameplay is active',
  },
  saveAfterResult: {
    label: 'Save after result',
    expected: 'save is committed only after the campaign result is final',
  },
};

const STAGE_COLORS = {
  bloodstream: '#8e2f3c',
  'immune-prime': '#6d4a9e',
  heart: '#b03a2e',
  'cardiac-titan': '#c9972b',
  menu: '#5a5a5a',
  unknown: '#3a3a3a',
};

const DIFFICULTIES = ['easy', 'standard', 'strained'];
const RUN_STATUSES = ['passed', 'failed', 'flaky', 'aborted', 'timeout'];

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMs(ms) {
  if (!isFiniteNumber(ms)) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatDuration(ms) {
  if (!isFiniteNumber(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${(seconds / 60).toFixed(1)} min`;
}

// ---------------------------------------------------------------------------
// §6.3 validation
// ---------------------------------------------------------------------------

// Validates one run.json object against the §6.3 schema. Returns
// { errors: string[], warnings: string[] }. Errors fail the report;
// warnings are rendered in the HTML footer.
function validateRun(run, label) {
  const errors = [];
  const warnings = [];
  const at = (field) => `${label}.${field}`;

  if (!isPlainObject(run)) return { errors: [`${label}: run.json is not an object`], warnings };

  const required = [
    'schemaVersion', 'project', 'commit', 'browser', 'renderer', 'viewport',
    'run', 'contract', 'result', 'lastTransition', 'stateHash', 'inputHash',
    'invariants', 'diagnostics', 'failure', 'artifacts',
  ];
  for (const field of required) {
    if (!(field in run)) errors.push(`${at(field)}: missing required field`);
  }

  if ('schemaVersion' in run && run.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`${at('schemaVersion')}: expected ${SCHEMA_VERSION}, got ${JSON.stringify(run.schemaVersion)}`);
  }
  if ('project' in run && (typeof run.project !== 'string' || !run.project)) {
    errors.push(`${at('project')}: expected a non-empty string`);
  }
  if ('commit' in run && (typeof run.commit !== 'string' || !/^[0-9a-f]{40}$/.test(run.commit))) {
    errors.push(`${at('commit')}: expected a 40-char git SHA`);
  }
  for (const field of ['browser', 'renderer']) {
    if (field in run && (typeof run[field] !== 'string' || !run[field])) {
      errors.push(`${at(field)}: expected a non-empty string`);
    }
  }
  if ('viewport' in run) {
    const v = run.viewport;
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n) && n > 0)) {
      errors.push(`${at('viewport')}: expected [width, height] of positive integers`);
    }
  }

  if ('run' in run) {
    const r = run.run;
    if (!isPlainObject(r)) {
      errors.push(`${at('run')}: expected an object`);
    } else {
      for (const field of ['id', 'seed', 'difficulty', 'status']) {
        if (typeof r[field] !== 'string' || !r[field]) {
          errors.push(`${at(`run.${field}`)}: expected a non-empty string`);
        }
      }
      if (typeof r.difficulty === 'string' && !DIFFICULTIES.includes(r.difficulty)) {
        warnings.push(`${at('run.difficulty')}: unknown difficulty ${JSON.stringify(r.difficulty)}`);
      }
      if (typeof r.status === 'string' && !RUN_STATUSES.includes(r.status)) {
        warnings.push(`${at('run.status')}: unknown status ${JSON.stringify(r.status)}`);
      }
      for (const field of ['speed', 'simulatedDurationMs', 'wallDurationMs', 'frames', 'tick', 'simulationTimeMs']) {
        if (field in r && (!isFiniteNumber(r[field]) || r[field] < 0)) {
          errors.push(`${at(`run.${field}`)}: expected a finite number >= 0`);
        }
      }
      if ('speed' in r && r.speed === 0) {
        errors.push(`${at('run.speed')}: expected a number > 0`);
      }
    }
  }

  if ('contract' in run) {
    const c = run.contract;
    if (!isPlainObject(c)) {
      errors.push(`${at('contract')}: expected an object`);
    } else {
      for (const field of ['rulesetVersion', 'campaignVersion', 'scoreValidation']) {
        if (typeof c[field] !== 'string' || !c[field]) {
          errors.push(`${at(`contract.${field}`)}: expected a non-empty string`);
        }
      }
      if ('completionStage' in c && c.completionStage !== null && typeof c.completionStage !== 'string') {
        errors.push(`${at('contract.completionStage')}: expected a string or null`);
      }
    }
  }

  if ('result' in run) {
    const res = run.result;
    if (!isPlainObject(res)) {
      errors.push(`${at('result')}: expected an object`);
    } else {
      for (const field of ['stage', 'phase', 'boss', 'terminal']) {
        if (typeof res[field] !== 'string' || !res[field]) {
          errors.push(`${at(`result.${field}`)}: expected a non-empty string`);
        }
      }
      if ('bossPhase' in res && !isFiniteNumber(res.bossPhase)) {
        errors.push(`${at('result.bossPhase')}: expected a finite number`);
      }
      if ('playerHp' in res && !isFiniteNumber(res.playerHp)) {
        errors.push(`${at('result.playerHp')}: expected a finite number`);
      }
    }
  }

  if ('lastTransition' in run) {
    const t = run.lastTransition;
    if (t !== null) {
      if (!isPlainObject(t)) {
        errors.push(`${at('lastTransition')}: expected an object or null`);
      } else {
        for (const field of ['from', 'to']) {
          if (typeof t[field] !== 'string' || !t[field]) {
            errors.push(`${at(`lastTransition.${field}`)}: expected a non-empty string`);
          }
        }
        if (!isFiniteNumber(t.atMs) || t.atMs < 0) {
          errors.push(`${at('lastTransition.atMs')}: expected a finite number >= 0`);
        }
      }
    }
  }

  for (const field of ['stateHash', 'inputHash']) {
    if (field in run) {
      if (typeof run[field] !== 'string' || !run[field]) {
        errors.push(`${at(field)}: expected a non-empty string`);
      } else if (!run[field].startsWith('sha256:')) {
        warnings.push(`${at(field)}: expected a "sha256:..." hash`);
      }
    }
  }

  if ('invariants' in run) {
    const inv = run.invariants;
    if (!isPlainObject(inv)) {
      errors.push(`${at('invariants')}: expected an object`);
    } else {
      for (const [id, value] of Object.entries(inv)) {
        if (typeof value === 'boolean') continue;
        if (isPlainObject(value) && typeof value.passed === 'boolean') continue;
        errors.push(`${at(`invariants.${id}`)}: expected a boolean or { passed, expected?, actual?, firstFailAt? }`);
      }
    }
  }

  if ('diagnostics' in run && !isPlainObject(run.diagnostics)) {
    errors.push(`${at('diagnostics')}: expected an object`);
  }

  if ('failure' in run) {
    const f = run.failure;
    if (f !== null && !isPlainObject(f)) {
      errors.push(`${at('failure')}: expected an object or null`);
    } else if (isPlainObject(f)) {
      for (const field of ['code', 'message']) {
        if (typeof f[field] !== 'string' || !f[field]) {
          warnings.push(`${at(`failure.${field}`)}: expected a non-empty string`);
        }
      }
    }
  }

  if ('artifacts' in run) {
    const a = run.artifacts;
    if (!isPlainObject(a)) {
      errors.push(`${at('artifacts')}: expected an object`);
    } else {
      for (const [key, value] of Object.entries(a)) {
        if (typeof value !== 'string' || !value) {
          errors.push(`${at(`artifacts.${key}`)}: expected a non-empty string path`);
        }
      }
    }
  }

  return { errors, warnings };
}

function loadJsonFile(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${label} (${file}): ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in ${label} (${file}): ${err.message}`);
  }
}

// Parses timeline.ndjson (§6.4): one JSON object per line.
function loadTimeline(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    fail(`cannot read ${label} (${file}): ${err.message}`);
  }
  const entries = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      fail(`invalid JSON in ${label} (${file}:${i + 1}): ${err.message}`);
    }
  }
  entries.sort((a, b) => (a.simulationTimeMs || 0) - (b.simulationTimeMs || 0));
  return entries;
}

function collectScreenshots(runDir) {
  const found = [];
  const roots = [runDir, path.join(runDir, 'screenshots')];
  for (const root of roots) {
    let names;
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      if (!/\.png$/i.test(name)) continue;
      const full = path.join(root, name);
      if (fs.statSync(full).isFile()) found.push(full);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Run loading (single-run dir or series parent dir)
// ---------------------------------------------------------------------------

function loadRunDir(runDir, runId) {
  const runPath = path.join(runDir, 'run.json');
  if (!fs.existsSync(runPath)) return null;
  const run = loadJsonFile(runPath, `${runId}/run.json`);
  const { errors, warnings } = validateRun(run, runId);
  if (errors.length > 0) {
    fail(`run.json validation failed for ${runId}:\n  - ${errors.join('\n  - ')}`);
  }
  const timeline = loadTimeline(path.join(runDir, 'timeline.ndjson'), `${runId}/timeline.ndjson`);
  let perf = null;
  const perfPath = path.join(runDir, 'perf.json');
  if (fs.existsSync(perfPath)) perf = loadJsonFile(perfPath, `${runId}/perf.json`);
  return {
    id: runId,
    dir: runDir,
    run,
    timeline,
    perf,
    screenshots: collectScreenshots(runDir),
    warnings,
  };
}

// Discovers runs under `inputDir`: a single run dir (run.json at top level)
// or a series parent dir (one subdir per run, each with run.json).
function discoverRuns(inputDir) {
  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    fail(`input directory not found: ${inputDir}`);
  }
  const direct = loadRunDir(inputDir, path.basename(path.resolve(inputDir)));
  if (direct) return [direct];
  const runs = [];
  for (const name of fs.readdirSync(inputDir).sort()) {
    const sub = path.join(inputDir, name);
    if (!fs.statSync(sub).isDirectory()) continue;
    const loaded = loadRunDir(sub, name);
    if (loaded) runs.push(loaded);
  }
  if (runs.length === 0) {
    fail(`no run.json found in ${inputDir} or its subdirectories`);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Invariants, series stats, timeline model
// ---------------------------------------------------------------------------

// §6.3 stores invariants as booleans; the HTML table (§6.5) needs
// expected/actual and firstFailAt. firstFailAt comes from the first
// INVARIANT_FAIL timeline marker for that id (§6.4); the richer object form
// { passed, expected, actual, firstFailAt } is accepted when the runner
// provides it. Wall time per marker is not part of the §6.4 record, so it is
// derived as gameMs / speed and flagged as estimated (see wallEstimated).
function normalizeInvariants(loaded) {
  const { run, timeline } = loaded;
  const speed = run.run.speed || 1;
  const firstFailById = new Map();
  for (const entry of timeline) {
    if (entry.event !== 'INVARIANT_FAIL') continue;
    const id = entry.invariantId || entry.detail?.invariantId;
    if (!id || firstFailById.has(id)) continue;
    const gameMs = entry.simulationTimeMs;
    firstFailById.set(id, {
      tick: entry.tick ?? null,
      gameMs: isFiniteNumber(gameMs) ? gameMs : null,
      wallMs: isFiniteNumber(entry.wallTimeMs)
        ? entry.wallTimeMs
        : isFiniteNumber(gameMs)
          ? Math.round(gameMs / speed)
          : null,
      wallEstimated: !isFiniteNumber(entry.wallTimeMs),
    });
  }
  const rows = [];
  for (const [id, value] of Object.entries(run.invariants)) {
    const catalog = INVARIANT_CATALOG[id] || { label: id, expected: 'invariant holds' };
    const row = { id, label: catalog.label, expected: catalog.expected, actual: null, passed: true, firstFailAt: null };
    if (typeof value === 'boolean') {
      row.passed = value;
      row.actual = value ? 'holds' : 'violated';
    } else {
      row.passed = value.passed;
      row.expected = value.expected || row.expected;
      row.actual = value.actual != null ? String(value.actual) : value.passed ? 'holds' : 'violated';
      if (isPlainObject(value.firstFailAt)) row.firstFailAt = value.firstFailAt;
    }
    if (!row.passed && !row.firstFailAt && firstFailById.has(id)) {
      row.firstFailAt = firstFailById.get(id);
    }
    // Failure detail from run.failure enriches the matching invariant row.
    if (!row.passed && run.failure && typeof run.failure === 'object') {
      const detail = [run.failure.object, run.failure.field, run.failure.value]
        .filter((part) => part != null && part !== '')
        .join(' ');
      if (detail) row.actual = `${row.actual} — ${detail}`;
    }
    rows.push(row);
  }
  rows.sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    const aTick = a.firstFailAt?.tick ?? Number.POSITIVE_INFINITY;
    const bTick = b.firstFailAt?.tick ?? Number.POSITIVE_INFINITY;
    return aTick - bTick;
  });
  return rows;
}

function computeSeriesStats(runs) {
  const byDifficulty = new Map();
  const bySeed = new Map();
  for (const loaded of runs) {
    const difficulty = loaded.run.run.difficulty;
    const seed = loaded.run.run.seed;
    const passed = loaded.run.run.status === 'passed';
    if (!byDifficulty.has(difficulty)) byDifficulty.set(difficulty, { total: 0, passed: 0 });
    const bucket = byDifficulty.get(difficulty);
    bucket.total += 1;
    if (passed) bucket.passed += 1;
    if (!bySeed.has(seed)) bySeed.set(seed, new Set());
    bySeed.get(seed).add(passed ? 'passed' : 'failed');
  }
  const winRate = {};
  for (const [difficulty, bucket] of [...byDifficulty.entries()].sort()) {
    winRate[difficulty] = {
      passed: bucket.passed,
      total: bucket.total,
      rate: bucket.total > 0 ? bucket.passed / bucket.total : null,
    };
  }
  const anyFailed = runs.some((loaded) => loaded.run.run.status !== 'passed');
  const mixedSeed = [...bySeed.values()].some((outcomes) => outcomes.size > 1);
  const verdict = !anyFailed ? 'PASS' : mixedSeed ? 'FLAKY' : 'FAIL';
  return { winRate, verdict, mixedSeed };
}

// Stage segments for the timeline strip, from STAGE_START / STAGE_CHANGED
// markers, bounded by RUN_START / RUN_END (or the run duration).
function buildStageSegments(loaded) {
  const { run, timeline } = loaded;
  const totalMs = run.run.simulatedDurationMs || timeline[timeline.length - 1]?.simulationTimeMs || 0;
  const segments = [];
  let current = null;
  const close = (endMs) => {
    if (current && endMs > current.startMs) {
      segments.push({ ...current, endMs });
    }
    current = null;
  };
  for (const entry of timeline) {
    const t = entry.simulationTimeMs;
    if (!isFiniteNumber(t)) continue;
    if (entry.event === 'RUN_START' || entry.event === 'STAGE_START') {
      close(t);
      current = { stage: entry.stage || 'unknown', startMs: t };
    } else if (entry.event === 'STAGE_CHANGED') {
      close(t);
      current = { stage: entry.to || entry.stage || 'unknown', startMs: t };
    } else if (entry.event === 'RUN_END') {
      close(t);
    } else if (!current && entry.stage) {
      current = { stage: entry.stage, startMs: t };
    }
  }
  if (current) close(totalMs);
  if (segments.length === 0 && totalMs > 0) {
    segments.push({ stage: run.result.stage || 'unknown', startMs: 0, endMs: totalMs });
  }
  return { segments, totalMs };
}

// Perf samples: timeline `perf` blocks and player/boss hp (§6.4 records),
// plus an optional perf.json { samples: [...] } sidecar.
function collectPerfSeries(loaded) {
  const heap = [];
  const fps = [];
  const playerHp = [];
  const bossHp = [];
  const push = (entry) => {
    const t = entry.simulationTimeMs;
    if (!isFiniteNumber(t)) return;
    const perf = entry.perf || entry;
    if (isFiniteNumber(perf.heapMb)) heap.push([t, perf.heapMb]);
    if (isFiniteNumber(perf.fps)) fps.push([t, perf.fps]);
    if (isPlainObject(entry.player) && isFiniteNumber(entry.player.hp)) {
      const max = isFiniteNumber(entry.player.maxHp) ? entry.player.maxHp : 100;
      playerHp.push([t, (entry.player.hp / max) * 100]);
    } else if (isFiniteNumber(perf.playerHp)) {
      const max = isFiniteNumber(perf.playerMaxHp) ? perf.playerMaxHp : 100;
      playerHp.push([t, (perf.playerHp / max) * 100]);
    }
    if (isPlainObject(entry.boss) && isFiniteNumber(entry.boss.hp)) {
      const max = isFiniteNumber(entry.boss.maxHp) && entry.boss.maxHp > 0 ? entry.boss.maxHp : null;
      if (max) bossHp.push([t, (entry.boss.hp / max) * 100]);
    } else if (isFiniteNumber(perf.bossHp)) {
      const max = isFiniteNumber(perf.bossMaxHp) && perf.bossMaxHp > 0 ? perf.bossMaxHp : null;
      if (max) bossHp.push([t, (perf.bossHp / max) * 100]);
    }
  };
  for (const entry of loaded.timeline) push(entry);
  const sidecar = loaded.perf?.samples;
  if (Array.isArray(sidecar)) {
    for (const sample of sidecar) push(sample);
  }
  const sortUnique = (series) => {
    series.sort((a, b) => a[0] - b[0]);
    return series.filter((point, i) => i === 0 || point[0] !== series[i - 1][0]);
  };
  return {
    heap: sortUnique(heap),
    fps: sortUnique(fps),
    playerHp: sortUnique(playerHp),
    bossHp: sortUnique(bossHp),
  };
}

// ---------------------------------------------------------------------------
// Inline SVG charts (no external dependencies)
// ---------------------------------------------------------------------------

function svgLineChart({ title, yLabel, series, width = 760, height = 180, yMin = 0, yMax = null }) {
  const padLeft = 52;
  const padRight = 12;
  const padTop = 26;
  const padBottom = 26;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return `<div class="chart-empty">${escapeHtml(title)}: no samples</div>`;
  }
  const tMin = Math.min(...allPoints.map((p) => p[0]));
  const tMax = Math.max(...allPoints.map((p) => p[0]));
  const span = Math.max(1, tMax - tMin);
  const maxY = yMax ?? Math.max(...allPoints.map((p) => p[1]), 1);
  const range = Math.max(1e-9, maxY - yMin);
  const x = (t) => padLeft + ((t - tMin) / span) * plotWidth;
  const y = (v) => padTop + plotHeight - ((v - yMin) / range) * plotHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = yMin + fraction * range;
    const gy = y(value);
    const label = value >= 100 ? value.toFixed(0) : value.toFixed(1);
    return `<line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${width - padRight}" y2="${gy.toFixed(1)}" class="grid"/>`
      + `<text x="${padLeft - 6}" y="${(gy + 3).toFixed(1)}" class="axis" text-anchor="end">${label}</text>`;
  }).join('');
  const lines = series.map((s) => {
    if (s.points.length === 0) return '';
    const points = s.points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const dots = s.points.length <= 40
      ? s.points.map(([t, v]) => `<circle cx="${x(t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${s.color}"/>`).join('')
      : '';
    return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="2"/>${dots}`;
  }).join('');
  const legend = series.map((s) => `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${escapeHtml(s.label)}</span>`).join('');
  return `<figure class="chart">
  <figcaption>${escapeHtml(title)} <span class="legend">${legend}</span></figcaption>
  <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    <text x="${padLeft}" y="14" class="axis">${escapeHtml(yLabel)}</text>
    ${grid}
    <line x1="${padLeft}" y1="${padTop + plotHeight}" x2="${width - padRight}" y2="${padTop + plotHeight}" class="axis-line"/>
    <text x="${padLeft}" y="${height - 6}" class="axis">${formatMs(tMin)}</text>
    <text x="${width - padRight}" y="${height - 6}" class="axis" text-anchor="end">${formatMs(tMax)}</text>
    ${lines}
  </svg>
</figure>`;
}

// ---------------------------------------------------------------------------
// Minimal solid-colour PNG writer (fixture screenshots; no dependencies)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function solidPng(width, height, [r, g, b]) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let yPos = 0; yPos < height; yPos++) {
    const rowStart = yPos * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let xPos = 0; xPos < width; xPos++) {
      const i = rowStart + 1 + xPos * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// HTML report (§6.5)
// ---------------------------------------------------------------------------
//
// Notes / divergences from §6 (the design doc is owned by the coordinator;
// this generator implements the corrected behaviour):
//   1. §6.3 stores invariants as booleans, but §6.5 wants expected/actual
//      and firstFailAt. firstFailAt is taken from the first INVARIANT_FAIL
//      timeline marker for that id; the richer object form of an invariant
//      entry is accepted when the runner provides it.
//   2. §6.4 timeline records carry simulationTimeMs but no wall time, so
//      wallMs is derived as gameMs / speed and flagged as estimated
//      (an explicit wallTimeMs on the record is used when present).
//   3. §6.3 has no per-stage result fields, so the series-table stage
//      columns are derived from timeline markers (STAGE_CHANGED /
//      BOSS_DEATH / CAMPAIGN_VICTORY).
//   4. FLAKY verdict: the same seed produced mixed outcomes across the
//      series (a single run is PASS or FAIL only).

function stageOutcomes(loaded) {
  const { run, timeline } = loaded;
  const events = timeline.map((entry) => entry.event);
  const has = (event, predicate) => timeline.some(
    (entry) => entry.event === event && (!predicate || predicate(entry)),
  );
  const reachedHeart = has('STAGE_CHANGED', (e) => e.to === 'heart')
    || timeline.some((e) => e.stage === 'heart');
  const primeDead = has('BOSS_DEATH', (e) => e.boss?.kind === 'immune-prime');
  const titanSpawned = has('BOSS_SPAWN', (e) => e.boss?.kind === 'cardiac-titan');
  const titanDead = has('BOSS_DEATH', (e) => e.boss?.kind === 'cardiac-titan')
    || events.includes('CAMPAIGN_VICTORY');
  const diedAt = run.run.status === 'passed' ? null : run.result.boss;
  const cell = (state) => (state === 'pass' ? '✓' : state === 'fail' ? '✗' : '—');
  const cls = (state) => (state === 'pass' ? 'ok' : state === 'fail' ? 'bad' : 'muted');
  const bloodstream = reachedHeart ? 'pass' : diedAt ? 'fail' : 'na';
  const prime = primeDead ? 'pass' : diedAt === 'immune-prime' ? 'fail' : 'na';
  const heart = titanSpawned || titanDead ? 'pass' : (reachedHeart && diedAt ? 'fail' : 'na');
  const titan = titanDead ? 'pass' : diedAt === 'cardiac-titan' ? 'fail' : 'na';
  return { bloodstream, prime, heart, titan, cell, cls };
}

function markerClass(event) {
  if (event === 'INVARIANT_FAIL') return 'marker-fail';
  if (event === 'RUN_END') return 'marker-end';
  if (event === 'CAMPAIGN_VICTORY') return 'marker-victory';
  if (event.startsWith('BOSS_')) return 'marker-boss';
  if (event.startsWith('STAGE_')) return 'marker-stage';
  if (event === 'WAVE_STALL' || event === 'BOT_STUCK' || event === 'TIMEOUT') return 'marker-warn';
  return 'marker-info';
}

function markerDetail(entry) {
  const parts = [];
  if (entry.waveId != null) parts.push(`wave ${entry.waveId}`);
  if (entry.choiceId) parts.push(entry.choiceId);
  if (entry.invariantId) parts.push(entry.invariantId);
  if (entry.detail) parts.push(entry.detail);
  if (entry.boss && isFiniteNumber(entry.boss.hp) && isFiniteNumber(entry.boss.maxHp)) {
    parts.push(`${entry.boss.kind} ${entry.boss.hp}/${entry.boss.maxHp} HP`);
  }
  if (entry.player && isFiniteNumber(entry.player.hp)) parts.push(`player ${entry.player.hp} HP`);
  if (entry.terminal) parts.push(entry.terminal);
  return parts.join(' · ');
}

function renderTimelineStrip(loaded, segmentsInfo, firstFailMarkerIndex) {
  const { timeline } = loaded;
  const { segments, totalMs } = segmentsInfo;
  if (totalMs <= 0) return '<p class="muted">No timeline data.</p>';
  const segmentHtml = segments.map((segment) => {
    const left = (segment.startMs / totalMs) * 100;
    const width = Math.max(0.5, ((segment.endMs - segment.startMs) / totalMs) * 100);
    const color = STAGE_COLORS[segment.stage] || STAGE_COLORS.unknown;
    return `<div class="strip-segment" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${color}" title="${escapeHtml(segment.stage)} ${formatMs(segment.startMs)}–${formatMs(segment.endMs)}"><span>${escapeHtml(segment.stage)}</span></div>`;
  }).join('');
  const markerHtml = timeline.map((entry, index) => {
    if (!isFiniteNumber(entry.simulationTimeMs)) return '';
    const left = (entry.simulationTimeMs / totalMs) * 100;
    const isFirstFail = index === firstFailMarkerIndex;
    const title = `${entry.event} — ${formatMs(entry.simulationTimeMs)} (tick ${entry.tick ?? '—'})${isFirstFail ? ' — FIRST INVARIANT FAILURE' : ''}`;
    return `<button type="button" class="strip-marker ${markerClass(entry.event)}${isFirstFail ? ' first-fail' : ''}" style="left:${left.toFixed(2)}%" data-marker="${index}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></button>`;
  }).join('');
  return `<div class="strip" role="group" aria-label="Run timeline">
    <div class="strip-track">${segmentHtml}</div>
    <div class="strip-markers">${markerHtml}</div>
  </div>
  <p class="strip-hint">Click a marker to jump to its timeline row. Red flag = first invariant failure.</p>
  <div id="marker-inspector" class="inspector muted">No marker selected.</div>`;
}

function renderTimelineTable(loaded) {
  const { run, timeline } = loaded;
  const speed = run.run.speed || 1;
  const shown = timeline.slice(0, MAX_TIMELINE_ROWS);
  const rows = shown.map((entry, index) => {
    const gameMs = isFiniteNumber(entry.simulationTimeMs) ? entry.simulationTimeMs : null;
    const wallMs = isFiniteNumber(entry.wallTimeMs)
      ? entry.wallTimeMs
      : gameMs !== null ? Math.round(gameMs / speed) : null;
    const wallLabel = wallMs === null ? '—' : `${formatMs(wallMs)}${isFiniteNumber(entry.wallTimeMs) ? '' : ' *'}`;
    return `<tr id="tl-row-${index}" class="${entry.event === 'INVARIANT_FAIL' ? 'row-fail' : ''}">
      <td>${entry.tick ?? '—'}</td>
      <td>${gameMs === null ? '—' : formatMs(gameMs)}</td>
      <td>${wallLabel}</td>
      <td>${escapeHtml(entry.stage || '—')}</td>
      <td>${escapeHtml(entry.phase || '—')}</td>
      <td><strong>${escapeHtml(entry.event || '—')}</strong></td>
      <td>${escapeHtml(markerDetail(entry))}</td>
    </tr>`;
  }).join('');
  const overflow = timeline.length > MAX_TIMELINE_ROWS
    ? `<p class="muted">Showing first ${MAX_TIMELINE_ROWS} of ${timeline.length} markers.</p>` : '';
  const wallNote = timeline.some((entry) => !isFiniteNumber(entry.wallTimeMs))
    ? '<p class="muted">* wallMs estimated as gameMs / speed — timeline records carry simulation time only (§6.4).</p>' : '';
  return `<table class="timeline-table">
    <thead><tr><th>Tick</th><th>Game</th><th>Wall</th><th>Stage</th><th>Phase</th><th>Event</th><th>Detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>${overflow}${wallNote}`;
}

function renderInvariantsTable(invariants) {
  const rows = invariants.map((row) => {
    const firstFail = row.firstFailAt && isFiniteNumber(row.firstFailAt.gameMs)
      ? `${formatMs(row.firstFailAt.gameMs)} game / ${isFiniteNumber(row.firstFailAt.wallMs) ? `${formatMs(row.firstFailAt.wallMs)} wall${row.firstFailAt.wallEstimated ? ' *' : ''}` : '—'} (tick ${row.firstFailAt.tick ?? '—'})`
      : '—';
    return `<tr class="${row.passed ? '' : 'row-fail'}">
      <td><strong>${escapeHtml(row.label)}</strong><br><code>${escapeHtml(row.id)}</code></td>
      <td>${escapeHtml(row.expected)}</td>
      <td>${escapeHtml(row.actual || '—')}</td>
      <td>${escapeHtml(firstFail)}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>Invariant</th><th>Expected</th><th>Actual</th><th>First failure</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderSeriesTable(runs) {
  const rows = runs.map((loaded) => {
    const { run } = loaded;
    const outcomes = stageOutcomes(loaded);
    const passed = run.run.status === 'passed';
    const result = passed ? 'PASS' : run.run.status.toUpperCase();
    return `<tr class="${passed ? '' : 'row-fail'}">
      <td><code>${escapeHtml(run.run.seed)}</code></td>
      <td>${escapeHtml(run.run.difficulty)}</td>
      <td class="${outcomes.cls(outcomes.bloodstream)}">${outcomes.cell(outcomes.bloodstream)}</td>
      <td class="${outcomes.cls(outcomes.prime)}">${outcomes.cell(outcomes.prime)}</td>
      <td class="${outcomes.cls(outcomes.heart)}">${outcomes.cell(outcomes.heart)}</td>
      <td class="${outcomes.cls(outcomes.titan)}">${outcomes.cell(outcomes.titan)}</td>
      <td><strong>${result}</strong><br><span class="muted">${escapeHtml(run.result.terminal || '')}</span></td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>Seed</th><th>Difficulty</th><th>Bloodstream</th><th>IMMUNE PRIME</th><th>Heart</th><th>Titan</th><th>Result</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildDiagnosis(loaded, invariants) {
  const { run, timeline } = loaded;
  const firstFailed = invariants.find((row) => !row.passed) || null;
  if (!firstFailed) return null;
  const failMs = firstFailed.firstFailAt?.gameMs;
  const windowEntries = isFiniteNumber(failMs)
    ? timeline.filter((entry) => isFiniteNumber(entry.simulationTimeMs)
      && Math.abs(entry.simulationTimeMs - failMs) <= DIAGNOSIS_WINDOW_MS)
    : [];
  const failMarker = timeline.find(
    (entry) => entry.event === 'INVARIANT_FAIL' && (entry.invariantId || entry.detail?.invariantId) === firstFailed.id,
  );
  const untilMarker = failMarker?.event || windowEntries[windowEntries.length - 1]?.event || 'RUN_END';
  const inputLog = run.artifacts.inputLog || 'inputs.json';
  const replayCommand = `npm run test:campaign -- --seed ${run.run.seed} --replay ${inputLog} --until ${untilMarker}`;
  const summaryLine = `CAMPAIGN_DIAGNOSIS stage=${run.result.stage} tick=${firstFailed.firstFailAt?.tick ?? run.run.tick} `
    + `invariant=${firstFailed.id} expected="${firstFailed.expected}" actual="${firstFailed.actual || 'violated'}"`;
  return { firstFailed, windowEntries, replayCommand, summaryLine, untilMarker };
}

function renderDiagnosis(loaded, diagnosis, screenshotRelPaths) {
  if (!diagnosis) {
    return `<section class="diagnosis pass"><h2>Diagnosis in 1 minute</h2>
    <p>All invariants held. No failure to diagnose.</p></section>`;
  }
  const { run } = loaded;
  const { firstFailed, windowEntries, replayCommand, summaryLine } = diagnosis;
  const failAt = firstFailed.firstFailAt;
  const windowRows = windowEntries.map((entry) => {
    const offset = isFiniteNumber(failAt?.gameMs) && isFiniteNumber(entry.simulationTimeMs)
      ? `${entry.simulationTimeMs - failAt.gameMs >= 0 ? '+' : ''}${((entry.simulationTimeMs - failAt.gameMs) / 1000).toFixed(1)}s`
      : '—';
    return `<tr class="${entry.event === 'INVARIANT_FAIL' ? 'row-fail' : ''}"><td>${offset}</td><td>${formatMs(entry.simulationTimeMs)}</td><td>${entry.tick ?? '—'}</td><td><strong>${escapeHtml(entry.event)}</strong></td><td>${escapeHtml(markerDetail(entry))}</td></tr>`;
  }).join('');
  const deathShot = screenshotRelPaths.find((shot) => shot.file === run.artifacts.screenshot);
  const deathImg = deathShot
    ? `<figure class="death-shot"><a href="${escapeHtml(deathShot.rel)}"><img src="${escapeHtml(deathShot.rel)}" alt="Failure screenshot"></a><figcaption>${escapeHtml(run.artifacts.screenshot)} — failure frame</figcaption></figure>`
    : '';
  return `<section class="diagnosis fail"><h2>Diagnosis in 1 minute</h2>
  <p><strong>First failed invariant:</strong> ${escapeHtml(firstFailed.label)} (<code>${escapeHtml(firstFailed.id)}</code>)</p>
  <p><strong>First failure at:</strong> ${failAt && isFiniteNumber(failAt.gameMs) ? `${formatMs(failAt.gameMs)} game / ${isFiniteNumber(failAt.wallMs) ? `${formatMs(failAt.wallMs)} wall` : '—'} (tick ${failAt.tick ?? '—'})` : 'unknown — no INVARIANT_FAIL marker in the timeline'} — stage <code>${escapeHtml(run.result.stage)}</code>, phase <code>${escapeHtml(run.result.phase)}</code></p>
  <p><strong>Expected:</strong> ${escapeHtml(firstFailed.expected)}<br><strong>Actual:</strong> ${escapeHtml(firstFailed.actual || 'violated')}</p>
  ${run.failure ? `<p><strong>Failure:</strong> <code>${escapeHtml(run.failure.code || '')}</code> — ${escapeHtml(run.failure.message || '')}</p>` : ''}
  <p><strong>Job summary line:</strong></p>
  <pre><code>${escapeHtml(summaryLine)}</code></pre>
  <p><strong>Replay:</strong></p>
  <pre><code>${escapeHtml(replayCommand)}</code></pre>
  ${deathImg}
  <h3>Context window ±10 s around the first failure</h3>
  <table><thead><tr><th>Offset</th><th>Game</th><th>Tick</th><th>Event</th><th>Detail</th></tr></thead><tbody>${windowRows || '<tr><td colspan="5" class="muted">No timeline entries in the window.</td></tr>'}</tbody></table>
  </section>`;
}

function renderFilmstrip(screenshotRelPaths) {
  if (screenshotRelPaths.length === 0) {
    return '<p class="muted">No screenshots in this run directory.</p>';
  }
  const frames = screenshotRelPaths.map((shot) => `<figure class="frame">
    <a href="${escapeHtml(shot.rel)}"><img src="${escapeHtml(shot.rel)}" alt="${escapeHtml(shot.caption || shot.file)}" loading="lazy"></a>
    <figcaption>${escapeHtml(shot.caption || shot.file)}</figcaption>
  </figure>`).join('');
  return `<div class="filmstrip">${frames}</div>`;
}

function renderHtml({ runs, primary, primaryInvariants, stats, segmentsInfo, perfSeries, diagnosis, screenshotRelPaths, warnings }) {
  const { run } = primary;
  const verdict = stats.verdict;
  const badgeClass = verdict === 'PASS' ? 'badge-pass' : verdict === 'FLAKY' ? 'badge-flaky' : 'badge-fail';
  const winRateHtml = Object.entries(stats.winRate).map(([difficulty, bucket]) => {
    const rate = bucket.rate === null ? '—' : `${(bucket.rate * 100).toFixed(0)}%`;
    return `<span><strong>${escapeHtml(difficulty)}:</strong> ${bucket.passed}/${bucket.total} (${rate})</span>`;
  }).join(' · ') || '<span class="muted">no runs</span>';
  const firstFailMarkerIndex = primary.timeline.findIndex(
    (entry) => entry.event === 'INVARIANT_FAIL'
      && (entry.invariantId || entry.detail?.invariantId) === diagnosis?.firstFailed?.id,
  );
  const heapChart = svgLineChart({
    title: 'Heap over time', yLabel: 'MB',
    series: [{ label: 'usedJSHeapSize', color: '#4bc996', points: perfSeries.heap }],
  });
  const fpsChart = svgLineChart({
    title: 'Frame rate over time', yLabel: 'fps', yMin: 0, yMax: 60,
    series: [{ label: 'fps', color: '#58a6ff', points: perfSeries.fps }],
  });
  const hpChart = svgLineChart({
    title: 'HP over time', yLabel: '% of max HP', yMin: 0, yMax: 100,
    series: [
      { label: 'Player HP', color: '#4bc996', points: perfSeries.playerHp },
      { label: 'Boss HP', color: '#e5534b', points: perfSeries.bossHp },
    ],
  });
  const warningsHtml = warnings.length > 0
    ? `<section><h2>Report warnings</h2><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></section>`
    : '';
  const seriesSection = runs.length > 1
    ? `<section><h2>Series (${runs.length} runs)</h2>${renderSeriesTable(runs)}</section>`
    : `<section><h2>Series</h2>${renderSeriesTable(runs)}</section>`;
  const detailHeading = runs.length > 1
    ? `Run detail — ${escapeHtml(primary.id)} <span class="muted">(first failed run; series table above lists all runs)</span>`
    : `Run detail — ${escapeHtml(primary.id)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Campaign report — ${escapeHtml(run.run.seed)} — OFELIYA</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #0d1117; color: #e6edf3; line-height: 1.5; }
header, section, footer { max-width: 960px; margin: 0 auto; padding: 16px 20px; }
header { border-bottom: 1px solid #30363d; }
h1 { font-size: 1.4rem; margin: 0 0 8px; }
h2 { font-size: 1.15rem; border-bottom: 1px solid #30363d; padding-bottom: 4px; }
h3 { font-size: 1rem; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
pre { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 0.9rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #21262d; vertical-align: top; }
th { color: #8b949e; font-weight: 600; }
tr.row-fail { background: rgba(229, 83, 75, 0.12); }
tr.row-fail:hover, tr.highlight { background: rgba(229, 83, 75, 0.28); }
tr.highlight { outline: 2px solid #e5534b; }
.muted { color: #8b949e; }
.ok { color: #4bc996; font-weight: 700; }
.bad { color: #e5534b; font-weight: 700; }
.badge { display: inline-block; font-size: 1rem; font-weight: 800; letter-spacing: 0.08em; padding: 4px 14px; border-radius: 999px; margin-right: 12px; }
.badge-pass { background: #1f6f43; color: #d6ffe2; }
.badge-fail { background: #8e2f3c; color: #ffdcd7; }
.badge-flaky { background: #8a6d1b; color: #fff3c4; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 20px; color: #8b949e; font-size: 0.9rem; }
.meta strong { color: #e6edf3; }
.diagnosis { border: 1px solid #30363d; border-radius: 8px; margin-top: 16px; }
.diagnosis.fail { border-color: #8e2f3c; }
.diagnosis.pass { border-color: #1f6f43; }
.strip { position: relative; margin: 16px 0 8px; }
.strip-track { position: relative; height: 28px; border-radius: 4px; overflow: hidden; background: #161b22; }
.strip-segment { position: absolute; top: 0; height: 100%; overflow: hidden; white-space: nowrap; }
.strip-segment span { display: inline-block; padding: 3px 6px; font-size: 0.75rem; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
.strip-markers { position: relative; height: 18px; }
.strip-marker { position: absolute; top: 2px; width: 12px; height: 12px; margin-left: -6px; padding: 0; border: 1px solid #0d1117; border-radius: 50%; cursor: pointer; background: #8b949e; }
.strip-marker:hover { transform: scale(1.4); }
.marker-fail { background: #e5534b; }
.marker-end { background: #e5534b; border-radius: 2px; }
.marker-victory { background: #4bc996; }
.marker-boss { background: #d29922; }
.marker-stage { background: #58a6ff; }
.marker-warn { background: #f0883e; }
.marker-info { background: #8b949e; }
.first-fail { outline: 2px solid #ff7b72; outline-offset: 1px; }
.strip-hint { font-size: 0.85rem; color: #8b949e; margin: 4px 0; }
.inspector { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 8px 12px; font-size: 0.9rem; min-height: 2.5em; }
.chart { margin: 16px 0; }
.chart figcaption { font-weight: 600; margin-bottom: 4px; }
.chart svg { width: 100%; height: auto; background: #161b22; border: 1px solid #30363d; border-radius: 6px; }
.chart .grid { stroke: #21262d; stroke-width: 1; }
.chart .axis { fill: #8b949e; font-size: 11px; font-family: ui-monospace, Menlo, Consolas, monospace; }
.chart .axis-line { stroke: #30363d; stroke-width: 1; }
.chart-empty { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; color: #8b949e; margin: 16px 0; }
.legend { font-weight: 400; font-size: 0.85rem; color: #8b949e; margin-left: 8px; }
.legend-item { margin-right: 12px; white-space: nowrap; }
.legend-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.filmstrip { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
.frame { margin: 0; width: 195px; }
.frame img { width: 100%; height: auto; display: block; border: 1px solid #30363d; border-radius: 6px; background: #161b22; }
.frame figcaption { font-size: 0.8rem; color: #8b949e; padding-top: 4px; word-break: break-all; }
.death-shot { margin: 12px 0; max-width: 390px; }
.death-shot img { width: 100%; height: auto; display: block; border: 1px solid #8e2f3c; border-radius: 6px; }
.death-shot figcaption { font-size: 0.85rem; color: #8b949e; padding-top: 4px; }
footer { border-top: 1px solid #30363d; color: #8b949e; font-size: 0.85rem; }
</style>
</head>
<body>
<header>
<h1><span class="badge ${badgeClass}">${verdict}</span>Autonomous Campaign Report</h1>
<div class="meta">
<span><strong>Seed:</strong> <code>${escapeHtml(run.run.seed)}</code></span>
<span><strong>Difficulty:</strong> ${escapeHtml(run.run.difficulty)}</span>
<span><strong>Commit:</strong> <code>${escapeHtml(run.commit.slice(0, 12))}</code></span>
<span><strong>Browser:</strong> ${escapeHtml(run.browser)} / ${escapeHtml(run.renderer)}</span>
<span><strong>Viewport:</strong> ${run.viewport[0]}×${run.viewport[1]}</span>
<span><strong>Simulated:</strong> ${formatDuration(run.run.simulatedDurationMs)}</span>
<span><strong>Wall:</strong> ${formatDuration(run.run.wallDurationMs)}</span>
<span><strong>Speed:</strong> ${run.run.speed}×</span>
</div>
<div class="meta"><span><strong>Win rate:</strong></span>${winRateHtml}</div>
<div class="meta"><span><strong>State hash:</strong> <code>${escapeHtml(run.stateHash)}</code></span>
<span><strong>Input hash:</strong> <code>${escapeHtml(run.inputHash)}</code></span></div>
</header>

<main>
${renderDiagnosis(primary, diagnosis, screenshotRelPaths)}
${seriesSection}
<section><h2>${detailHeading}</h2>
<h3>Timeline</h3>
${renderTimelineStrip(primary, segmentsInfo, firstFailMarkerIndex)}
${renderTimelineTable(primary)}
<h3>Invariants (failed first)</h3>
${renderInvariantsTable(primaryInvariants)}
<h3>Performance</h3>
${heapChart}
${fpsChart}
${hpChart}
<h3>Screenshots</h3>
${renderFilmstrip(screenshotRelPaths)}
</section>
${warningsHtml}
</main>

<footer>
<p>Generated by scripts/lib/campaign-report.cjs — schemaVersion ${SCHEMA_VERSION}, single-file report, no external dependencies (charts are inline SVG, screenshots are relative paths).</p>
<p>Notes: firstFailAt comes from the first INVARIANT_FAIL timeline marker per invariant; wallMs is estimated as gameMs / speed unless the timeline record carries wallTimeMs; series stage columns are derived from timeline markers (STAGE_CHANGED / BOSS_DEATH / CAMPAIGN_VICTORY); FLAKY means the same seed had mixed outcomes across the series.</p>
</footer>

<script>
(function () {
  var inspector = document.getElementById('marker-inspector');
  var rows = document.querySelectorAll('.timeline-table tbody tr');
  var markers = document.querySelectorAll('.strip-marker');
  var timeline = ${JSON.stringify(primary.timeline.map((entry) => ({
    event: entry.event || null,
    tick: entry.tick ?? null,
    simulationTimeMs: entry.simulationTimeMs ?? null,
    stage: entry.stage || null,
    phase: entry.phase || null,
    detail: markerDetail(entry),
  }))).replace(/</g, '\\u003c')};;
  function selectMarker(index) {
    var entry = timeline[index];
    if (!entry) return;
    rows.forEach(function (row) { row.classList.remove('highlight'); });
    var row = document.getElementById('tl-row-' + index);
    if (row) {
      row.classList.add('highlight');
      row.scrollIntoView({ block: 'center' });
    }
    if (inspector) {
      inspector.textContent = (entry.event || '?') + ' — tick ' + (entry.tick ?? '—')
        + ', game ' + (entry.simulationTimeMs != null ? (entry.simulationTimeMs / 1000).toFixed(1) + 's' : '—')
        + ', stage ' + (entry.stage || '—') + ', phase ' + (entry.phase || '—')
        + (entry.detail ? ' — ' + entry.detail : '');
      inspector.classList.remove('muted');
    }
  }
  markers.forEach(function (marker) {
    marker.addEventListener('click', function () {
      selectMarker(Number(marker.getAttribute('data-marker')));
    });
  });
  rows.forEach(function (row, index) {
    row.addEventListener('click', function () { selectMarker(index); });
    row.style.cursor = 'pointer';
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function loadScreenshotCaptions(runDir) {
  const sidecar = path.join(runDir, 'screenshots.json');
  if (!fs.existsSync(sidecar)) return new Map();
  const data = loadJsonFile(sidecar, 'screenshots.json');
  const captions = new Map();
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry && typeof entry.file === 'string' && typeof entry.caption === 'string') {
        captions.set(entry.file, entry.caption);
      }
    }
  }
  return captions;
}

function copyScreenshots(loaded, outDir) {
  const captions = loadScreenshotCaptions(loaded.dir);
  const destDir = path.join(outDir, 'screenshots', loaded.id);
  const copied = [];
  for (const full of loaded.screenshots) {
    const file = path.basename(full);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(full, path.join(destDir, file));
    copied.push({
      file,
      rel: `screenshots/${loaded.id}/${file}`,
      caption: captions.get(file) || file,
    });
  }
  return copied;
}

// Checks the single-file constraint: no external URLs, no external script /
// stylesheet / image references. Returns a list of violations (empty = OK).
function checkHtmlSelfContained(html) {
  const violations = [];
  const checks = [
    // Loopback URLs appear in escaped diagnostic text (page errors from a
    // failed dynamic import against the local dev server) and are not
    // external dependencies of the report.
    [/https?:\/\/(?!(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[\/\s"'<>)]|$))/, 'external http(s) URL'],

    [/<script[^>]+src=/i, 'external <script src>'],
    [/<link[^>]+href=/i, 'external <link href>'],
    [/<img[^>]+src=["']https?:/i, 'external <img src>'],
    [/url\(\s*["']?https?:/i, 'external url() in CSS'],
    [/srcset\s*=/i, 'srcset attribute (external images must stay relative)'],
  ];
  for (const [pattern, description] of checks) {
    if (pattern.test(html)) violations.push(description);
  }
  return violations;
}

function generateReport(inputDir, outDir) {
  const runs = discoverRuns(inputDir);
  const warnings = runs.flatMap((loaded) => loaded.warnings);
  const primary = runs.find((loaded) => loaded.run.run.status !== 'passed') || runs[0];
  const primaryInvariants = normalizeInvariants(primary);
  const stats = computeSeriesStats(runs);
  const segmentsInfo = buildStageSegments(primary);
  const perfSeries = collectPerfSeries(primary);
  const diagnosis = buildDiagnosis(primary, primaryInvariants);

  fs.mkdirSync(outDir, { recursive: true });
  const screenshotRelPaths = copyScreenshots(primary, outDir);
  // Copy the other runs' screenshots too, so the artifact dir is complete.
  for (const loaded of runs) {
    if (loaded !== primary) copyScreenshots(loaded, outDir);
  }

  const html = renderHtml({
    runs,
    primary,
    primaryInvariants,
    stats,
    segmentsInfo,
    perfSeries,
    diagnosis,
    screenshotRelPaths,
    warnings,
  });
  const violations = checkHtmlSelfContained(html);
  if (violations.length > 0) {
    fail(`generated HTML is not self-contained: ${violations.join(', ')}`);
  }

  const runJsonPath = path.join(outDir, 'run.json');
  fs.writeFileSync(runJsonPath, `${JSON.stringify(primary.run, null, 2)}\n`);
  const seriesPath = path.join(outDir, 'series.json');
  fs.writeFileSync(seriesPath, `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    verdict: stats.verdict,
    winRate: stats.winRate,
    runs: runs.map((loaded) => loaded.run),
  }, null, 2)}\n`);
  const htmlPath = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlPath, html);

  return {
    runs,
    primary,
    stats,
    diagnosis,
    warnings,
    paths: { runJson: runJsonPath, series: seriesPath, html: htmlPath },
  };
}

// ---------------------------------------------------------------------------
// Fixture mode (--fixture)
// ---------------------------------------------------------------------------

function materializeFixture(outDir) {
  const fixturePath = path.join(__dirname, 'campaign-report-fixture.json');
  const fixture = loadJsonFile(fixturePath, 'campaign-report-fixture.json');
  if (!Array.isArray(fixture.runs) || fixture.runs.length === 0) {
    fail('fixture file has no runs');
  }
  const inputDir = path.join(outDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  for (const fixtureRun of fixture.runs) {
    const runDir = path.join(inputDir, fixtureRun.id);
    const shotsDir = path.join(runDir, 'screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify(fixtureRun.run, null, 2)}\n`);
    const timelineText = (fixtureRun.timeline || [])
      .map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(path.join(runDir, 'timeline.ndjson'), timelineText ? `${timelineText}\n` : '');
    const captions = [];
    for (const shot of fixtureRun.screenshots || []) {
      fs.writeFileSync(
        path.join(shotsDir, shot.file),
        solidPng(SCREENSHOT_WIDTH, SCREENSHOT_HEIGHT, shot.color || [90, 90, 90]),
      );
      captions.push({ file: shot.file, caption: shot.caption || shot.file });
    }
    fs.writeFileSync(path.join(runDir, 'screenshots.json'), `${JSON.stringify(captions, null, 2)}\n`);
  }
  return inputDir;
}

function runFixtureMode(outDir) {
  const inputDir = materializeFixture(outDir);
  const result = generateReport(inputDir, outDir);
  // Self-checks: outputs exist, parse, and the HTML stays self-contained.
  const html = fs.readFileSync(result.paths.html, 'utf8');
  const violations = checkHtmlSelfContained(html);
  if (violations.length > 0) {
    fail(`fixture HTML is not self-contained: ${violations.join(', ')}`);
  }
  const parsedRun = JSON.parse(fs.readFileSync(result.paths.runJson, 'utf8'));
  const { errors } = validateRun(parsedRun, 'output/run.json');
  if (errors.length > 0) fail(`output run.json failed validation:\n  - ${errors.join('\n  - ')}`);
  const parsedSeries = JSON.parse(fs.readFileSync(result.paths.series, 'utf8'));
  if (!Array.isArray(parsedSeries.runs) || parsedSeries.runs.length !== result.runs.length) {
    fail('output series.json does not list all fixture runs');
  }
  if (!html.includes('Diagnosis in 1 minute') || !html.includes('INVARIANT_FAIL')
    || !html.includes('npm run test:campaign -- --seed')) {
    fail('fixture HTML is missing the diagnosis block');
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  process.stdout.write(`Autonomous Campaign Harness — run report generator.

Usage:
  node scripts/lib/campaign-report.cjs --input <run-dir> --out <dir>
  node scripts/lib/campaign-report.cjs --fixture [--out <dir>]

Options:
  --input <dir>   Run directory (run.json + timeline.ndjson + screenshots),
                  or a parent directory of run directories (series mode).
  --out <dir>     Output directory (run.json + series.json + index.html).
  --fixture       Generate a report from the built-in fixtures
                  (campaign-report-fixture.json) into /tmp/campaign-report-test/.
  --help          Show this help.

The generator exits 0 when the report was written, even if the run verdict
is FAIL — it is a reporting tool, not a gate.
`);
}

function parseArgs(argv) {
  const args = { input: null, out: null, fixture: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') {
      args.input = argv[++i];
      if (!args.input) fail('--input requires a directory');
    } else if (arg === '--out') {
      args.out = argv[++i];
      if (!args.out) fail('--out requires a directory');
    } else if (arg === '--fixture') {
      args.fixture = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function printResultSummary(result) {
  const { primary, stats, diagnosis } = result;
  const { run } = primary;
  const winRate = Object.entries(stats.winRate)
    .map(([difficulty, bucket]) => `${difficulty}=${bucket.passed}/${bucket.total}`)
    .join(' ');
  process.stdout.write(`campaign-report: verdict=${stats.verdict} runs=${result.runs.length} ${winRate}\n`);
  process.stdout.write(`campaign-report: primary=${primary.id} seed=${run.run.seed} difficulty=${run.run.difficulty} status=${run.run.status}\n`);
  if (diagnosis) {
    process.stdout.write(`${diagnosis.summaryLine}\n`);
  } else {
    process.stdout.write(`CAMPAIGN_DIAGNOSIS verdict=PASS seed=${run.run.seed} invariants=all-pass\n`);
  }
  for (const warning of result.warnings) {
    process.stdout.write(`campaign-report: warning: ${warning}\n`);
  }
  process.stdout.write(`campaign-report: wrote ${result.paths.html}\n`);
  process.stdout.write(`campaign-report: wrote ${result.paths.runJson}\n`);
  process.stdout.write(`campaign-report: wrote ${result.paths.series}\n`);
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`campaign-report: ${err.message}\n`);
    return 2;
  }
  if (args.help) {
    printHelp();
    return 0;
  }
  try {
    if (args.fixture) {
      const outDir = path.resolve(args.out || FIXTURE_OUT_DIR);
      const result = runFixtureMode(outDir);
      printResultSummary(result);
      process.stdout.write('campaign-report: fixture self-check PASS\n');
      return 0;
    }
    if (!args.input || !args.out) {
      process.stderr.write('campaign-report: --input and --out are required (or use --fixture)\n');
      return 2;
    }
    const result = generateReport(path.resolve(args.input), path.resolve(args.out));
    printResultSummary(result);
    return 0;
  } catch (err) {
    process.stderr.write(`campaign-report: ${err.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  validateRun,
  loadTimeline,
  normalizeInvariants,
  computeSeriesStats,
  buildStageSegments,
  collectPerfSeries,
  checkHtmlSelfContained,
  generateReport,
  runFixtureMode,
  solidPng,
};
