import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// B2 fix gate: danger telegraphs must be re-stroked above the silhouette
// clearing so the dark pocket cannot mute actionable warnings (runner lanes,
// brute/anomaly radials, boss pressure rings) at density >= 110.

function transpileModule(path) {
  const src = readFileSync(path, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, (id) => {
    if (id.startsWith('.')) {
      const sub = transpileModule(`src/game/${id.slice(2)}.ts`);
      return sub.exports;
    }
    throw new Error(`unexpected import in ${path}: ${id}`);
  });
  return mod;
}

// --- 1. Pure geometry: the echo predicate decides WHICH warnings get echoed ---
const { echoIntersectsPocket, DANGER_ECHO_POOL } = transpileModule('src/game/DangerEcho.ts').exports;

const laneThrough = {
  shape: 'lane', x: -100, y: 0, dirX: 1, dirY: 0, start: 18, end: 154,
  radius: 0, level: 'dangerous', color: 0x8fe8ff,
};
assert.equal(echoIntersectsPocket(laneThrough, 0, 0, 54), true, 'lane crossing the pocket must echo');
assert.equal(
  echoIntersectsPocket({ ...laneThrough, x: -300, dirX: 0, dirY: 1, x2: 0 }, 0, 0, 54),
  false,
  'lane 246px away from the pocket must not echo'
);
const radialEdge = {
  shape: 'radial', x: 120, y: 0, dirX: 0, dirY: 0, start: 0, end: 0,
  radius: 100, level: 'dangerous', color: 0xff9b66,
};
assert.equal(echoIntersectsPocket(radialEdge, 0, 0, 54), true, 'radial ring passing through the pocket edge must echo');
assert.equal(
  echoIntersectsPocket({ ...radialEdge, x: 400, radius: 58 }, 0, 0, 54),
  false,
  'distant radial that never reaches the pocket must not echo'
);
assert.equal(echoIntersectsPocket({ ...radialEdge, radius: Number.NaN }, 0, 0, 54), false, 'NaN radius is inert');

// --- 2. GameScene wires a pooled echo layer ABOVE the clearing, below elites ---
const gameSource = readFileSync('src/scenes/GameScene.ts', 'utf8');
const gameAst = ts.createSourceFile('GameScene.ts', gameSource, ts.ScriptTarget.Latest, true);
const gameClass = gameAst.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'GameScene');
assert.ok(gameClass, 'GameScene class found');

const updateMethod = gameClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(gameAst) === 'update')?.getText(gameAst);
assert.ok(updateMethod, 'update() found');
assert.match(updateMethod, /visualEnemyDensity\s*>=\s*110[\s\S]*?getDangerEcho/, 'echo layer is gated by the same density band as the clearing');
const poolCreate = gameClass.members
  .map(n => n.getText(gameAst))
  .find(t => /telegraphEchoPool/.test(t) && /setDepth\(11\.5\)/.test(t));
assert.ok(poolCreate, 'pooled echo Graphics at depth 11.5 (above clearing 11, below elite markers 12)');
assert.match(updateMethod, /telegraphEchoPool/, 'update() drives the echo pool');
assert.match(updateMethod, /DANGER_ECHO_POOL|echoCount\s*<\s*4/, 'echo count is capped by the pool size');

// --- 3. Enemy exposes a danger-echo descriptor for every actionable warning grammar ---
const enemySource = readFileSync('src/game/Enemy.ts', 'utf8');
const enemyAst = ts.createSourceFile('Enemy.ts', enemySource, ts.ScriptTarget.Latest, true);
const enemyClass = enemyAst.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Enemy');
const echoMethod = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'getDangerEcho')?.getText(enemyAst);
assert.ok(echoMethod, 'Enemy.getDangerEcho() exists');
assert.match(echoMethod, /'windup'/, 'runner/brute windups echo');
assert.match(echoMethod, /COLORS\.cyan/, 'runner lane keeps the cyan dangerous grammar');
assert.match(echoMethod, /COLORS\.orange/, 'brute radial keeps the orange dangerous grammar');
assert.match(echoMethod, /bossAttackState\s*===\s*'telegraph'/, 'boss pressure telegraph echoes');
assert.match(echoMethod, /'critical'/, 'boss echo keeps the critical level');
assert.match(echoMethod, /anomalyAttackState\s*===\s*'telegraph'/, 'anomaly telegraphs echo');
assert.match(echoMethod, /COLORS\.purple/, 'anomaly echo keeps the purple grammar');

// --- 4. Boss aura reads the single authoritative phase getter (B4) ---
const auraMethod = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'updatePrimeAura')?.getText(enemyAst);
assert.ok(auraMethod, 'updatePrimeAura() found');
assert.match(auraMethod, /this\.getPhaseMode\(\)/, 'world aura derives its phase from the authoritative getPhaseMode()');
assert.match(auraMethod, /phaseTransitionPulse/, 'world aura renders a phase-transition pulse');

console.log(`danger echo: geometry ${DANGER_ECHO_POOL}-pool layer above clearing; runner/brute/boss/anomaly grammars echo; aura on single getter PASS`);
