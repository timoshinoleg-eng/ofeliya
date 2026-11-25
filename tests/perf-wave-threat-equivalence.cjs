// Compare the production director against the exact pre-change source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const filename = path.resolve('src/game/WaveDirector.ts');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'phaser') return { Math: {
    Clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    Linear: (a, b, t) => a + (b - a) * t,
  } };
  return originalLoad.call(this, name, ...args);
};
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, file);
function load(source) {
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText, filename);
  return mod.exports.WaveDirector;
}
const baseline = load(execFileSync('git', ['show', 'b738ec9c691d10c3af7a5ef3d5bf4e17abb95ae4:src/game/WaveDirector.ts'], { encoding: 'utf8' }));
const optimized = load(fs.readFileSync(filename, 'utf8'));

function run(Director, size, mode, seed) {
  let state = seed, scans = 0, draws = 0;
  const random = () => { draws++; state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const live = Array.from({ length: size }, (_, i) => ({ active: true, isBoss: i === 0 && mode === 'boss', isElite: i === 1 && mode === 'elite', kind: 'swarm' }));
  const log = [];
  const enemies = { countActive: () => live.filter(e => e.active).length, getChildren: () => { scans++; return live; } };
  const stage = { durationMs: 10000, waves: { normalEnemyCap: 260 } };
  const difficulty = { normalEnemyCapBonus: 0, threatCapStart: size + 0.5, threatCapEnd: size + 2 };
  const scene = { runState: { stage: { timeMs: 5000 } }, cameras: { main: { width: 390, height: 740, midPoint: { x: 3, y: 5 } } },
    spawnEnemy(kind, x, y, elite) {
      log.push([kind, x, y, elite]);
      if (mode === 'deactivate' && live[0]) live[0].active = false;
      if (mode === 'failure') return null;
      const enemy = { active: true, isBoss: kind === 'boss', isElite: elite, kind };
      live.push(enemy); return enemy;
    } };
  const director = new Director(scene, enemies, stage, difficulty, random, random);
  for (let i = 0; i < 12; i++) {
    scene.runState.stage.timeMs = (i * 997) % 10000;
    director.spawn(['brute', 'runner', 'swarm', 'boss'][Math.floor(random() * 4)], i === 5 && mode === 'elite');
  }
  director.fireWaveEvent([{ kind: 'brute', x: 2, y: 4 }, { kind: 'swarm', x: 5, y: 8 }]);
  return { log, draws, live, snapshot: director.snapshot(), scans };
}
for (const size of [5, 10, 260]) for (const mode of ['normal', 'failure', 'deactivate', 'elite', 'boss']) for (let seed = 1; seed <= 20; seed++) {
  const before = run(baseline, size, mode, seed);
  const after = run(optimized, size, mode, seed);
  assert.deepEqual({ ...after, scans: 0 }, { ...before, scans: 0 }, `${size}/${mode}/${seed}`);
  assert.ok(after.scans <= before.scans);
}
const before = run(baseline, 10, 'normal', 7), after = run(optimized, 10, 'normal', 7);
assert.ok(after.scans < before.scans, `expected fewer scans: ${before.scans} -> ${after.scans}`);
console.log(`wave threat equivalence: 300 scenarios passed; representative scans ${before.scans} -> ${after.scans}`);
