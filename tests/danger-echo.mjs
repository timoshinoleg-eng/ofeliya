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
// Critical boss warnings must win priority over older role windups when the
// four-slot pool is saturated. A restarted Scene must never reuse dead Graphics.
assert.match(updateMethod, /for\s*\(let priority = 0; priority < 2 && echoCount < DANGER_ECHO_POOL/, 'critical danger priority pass exists');
assert.match(updateMethod, /echo\.level !== 'critical'/, 'critical boss warnings are selected first');
// Mutation-hardening (review P3-5): these three asserts must fail when the
// priority is inverted, the pool cap is lifted, or the echo drifts from the
// original telegraph animation.
assert.match(updateMethod, /wantCritical\s*=\s*priority\s*===\s*0/, 'pass 0 is the critical pass');
assert.match(updateMethod, /wantCritical\s*\?\s*echo\.level !== 'critical'\s*:\s*echo\.level === 'critical'/, 'priority filter direction is exact');
assert.match(updateMethod, /while \(echoCount < DANGER_ECHO_POOL\)/, 'per-slot scan is pool-capped on every pick');
assert.match(updateMethod, /bestDistSq/, 'selection compares distance to the pocket, not pool order');
assert.match(updateMethod, /this\.echoTaken\[echoCount\] = bestEnemy/, 'picked enemies are excluded from later slots');
assert.match(updateMethod, /enemy\.getDangerEcho\(time\)/, 'echo motion is sampled at the current frame time');
assert.match(updateMethod, /setScale\(bestEcho\.scale \?\? 1\)/, 'echo slot replays the original countdown scale');
assert.match(updateMethod, /setAlpha\(bestEcho\.alpha \?\? 1\)/, 'echo slot replays the original countdown alpha');
const createMethod = gameClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(gameAst) === 'create')?.getText(gameAst);
assert.ok(createMethod, 'create() found');
assert.match(createMethod, /this\.telegraphEchoPool\s*=\s*\[\]/, 'restart invalidates stale graphics from prior Scene lifecycle');

// --- 3. Enemy exposes a danger-echo descriptor for every actionable warning grammar ---
const enemySource = readFileSync('src/game/Enemy.ts', 'utf8');
const enemyAst = ts.createSourceFile('Enemy.ts', enemySource, ts.ScriptTarget.Latest, true);
const enemyClass = enemyAst.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Enemy');
const echoMethod = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'getDangerEcho')?.getText(enemyAst);
assert.ok(echoMethod, 'Enemy.getDangerEcho() exists');
assert.match(echoMethod, /getDangerEcho\(now: number\)/, 'echo motion is sampled at frame time');
assert.match(echoMethod, /'windup'/, 'runner/brute windups echo');
assert.match(echoMethod, /COLORS\.cyan/, 'runner lane keeps the cyan dangerous grammar');
assert.match(echoMethod, /COLORS\.orange/, 'brute radial keeps the orange dangerous grammar');
assert.match(echoMethod, /bossAttackState\s*===\s*'telegraph'/, 'boss pressure telegraph echoes');
assert.match(echoMethod, /'critical'/, 'boss echo keeps the critical level');
assert.match(echoMethod, /anomalyAttackState\s*===\s*'telegraph'/, 'anomaly telegraphs echo');
assert.match(echoMethod, /COLORS\.purple/, 'anomaly echo keeps the purple grammar');
// Motion parity with the depth-8 originals (review P3-1): role warnings pulse,
// boss/anomaly warnings count down; geometry comes from the same helpers the
// original telegraph drawers use (review P3-6), and the descriptor is filled
// into a reusable scratch — no per-frame allocation (review P3-6 comment fix).
assert.match(echoMethod, /combatTelegraphPulse\('dangerous', now\)/, 'role echo mirrors the live pulse of updateRoleTelegraph');
assert.match(echoMethod, /combatTelegraphCountdown\('critical', progress\)/, 'boss echo mirrors the original countdown squeeze');
assert.match(echoMethod, /combatTelegraphCountdown\('dangerous', progress\)/, 'anomaly echo mirrors the original countdown squeeze');
assert.match(echoMethod, /dangerEchoScratch/, 'descriptor is reused, not allocated per call');
const roleDraw = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'drawRoleTelegraph')?.getText(enemyAst);
assert.match(roleDraw, /this\.roleLaneStart\(\)/, 'original runner lane reads the same lane geometry as the echo');
assert.match(roleDraw, /this\.roleRadialRadius\(\)/, 'original brute radial reads the same radius as the echo');
const anomalyDraw = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'drawAnomalyTelegraph')?.getText(enemyAst);
assert.match(anomalyDraw, /this\.anomalyLaneStart\(\)/, 'original anomaly lane reads the same lane geometry as the echo');
// P3-4: pooled enemies reactivated without a stage reset must not carry a
// stale phase into the first aura update (spurious ceremony flash).
const activateMethod = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'activate')?.getText(enemyAst);
assert.match(activateMethod, /primePhaseLast = 'armored'/, 'activate() resets the remembered phase');
assert.match(activateMethod, /primePhaseTransitionAt = -1/, 'activate() resets the transition timestamp');

// --- 4. Boss aura reads the single authoritative phase getter (B4) ---
const auraMethod = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'updatePrimeAura')?.getText(enemyAst);
assert.ok(auraMethod, 'updatePrimeAura() found');
assert.match(auraMethod, /this\.getPhaseMode\(\)/, 'world aura derives its phase from the authoritative getPhaseMode()');
assert.match(auraMethod, /phaseTransitionPulse/, 'world aura renders a phase-transition pulse');

console.log(`danger echo: geometry ${DANGER_ECHO_POOL}-pool layer above clearing; runner/brute/boss/anomaly grammars echo; aura on single getter PASS`);
