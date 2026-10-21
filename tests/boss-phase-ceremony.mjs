import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// B4 ceremony gate + P3 HUD dim gate:
//  - phase transitions (armored -> recovery/broken) get a short, deterministic
//    pulse on BOTH the world aura (Enemy) and the HUD boss bar (UIScene);
//  - the world aura reads the single authoritative Enemy.getPhaseMode();
//  - bossFrame participates in setHudCinematicAlpha like every other boss HUD part.

function transpileModule(path) {
  const src = readFileSync(path, 'utf8');
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', outputText)(mod, mod.exports);
  return mod;
}

// --- 1. Transition envelope: deterministic, bounded, zero outside the window ---
const { phaseTransitionPulse, BOSS_PHASE_TRANSITION_MS } = transpileModule('src/game/BossPhaseCeremony.ts').exports;
assert.equal(BOSS_PHASE_TRANSITION_MS, 420);
assert.equal(phaseTransitionPulse(0), 0, 'no pulse before a transition is registered');
assert.equal(phaseTransitionPulse(-5), 0);
assert.equal(phaseTransitionPulse(Number.NaN), 0);
assert.equal(phaseTransitionPulse(BOSS_PHASE_TRANSITION_MS), 0, 'pulse fully decays inside one window');
assert.equal(phaseTransitionPulse(BOSS_PHASE_TRANSITION_MS * 3), 0);
assert.ok(Math.abs(phaseTransitionPulse(105) - 0.5625) < 1e-9, 'ease-out quad at quarter window');
assert.ok(phaseTransitionPulse(30) > 0.8, 'strong flash right after the transition');
assert.ok(phaseTransitionPulse(200) < phaseTransitionPulse(100), 'monotone decay');

// --- 2. UIScene: extracted boss-identity frame draws phase tint + transition pulse ---
const source = readFileSync('src/scenes/UIScene.ts', 'utf8');
const ast = ts.createSourceFile('UIScene.ts', source, ts.ScriptTarget.Latest, true);
const sceneClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'UIScene');
assert.ok(sceneClass, 'UIScene class found');
const frameMethod = sceneClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(ast) === 'drawBossIdentityFrame')?.getText(ast);
assert.ok(frameMethod, 'drawBossIdentityFrame() exists (was: inline block in update)');

// Review P3-5/P3-3 hardening: the HUD bar MUST read the authoritative
// getBossPhaseMode(), and a null phase (boss dead/dying, bar still draining)
// must suppress the ceremony pulse instead of flashing a fake transition.
const updateMethod = sceneClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(ast) === 'update')?.getText(ast);
assert.ok(updateMethod, 'update() found');
assert.match(updateMethod, /this\.gs\?\.getBossPhaseMode\?\.\(\)/, 'HUD phase comes from the authoritative GameScene getter');
assert.match(updateMethod, /const liveMode = /, 'null phase is distinguished from a real armored phase');
assert.match(updateMethod, /liveMode !== null && !prefersReducedMotion\(\)\s*\?\s*phaseTransitionPulse/,
  'ceremony pulse is gated on a live boss and disabled for reduced motion');

const COLORS = { white: 0xffffff, gold: 0xffd56a, green: 0x7fffa1, red: 0xff3e5f };
const HUD = { row: { bossBarY: 68, bossBarH: 8 } };

class Gfx {
  constructor() { this.styles = []; this.fills = []; this.triangles = 0; this.lines = 0; this.rounded = 0; }
  clear() { return this; }
  lineStyle(w, c, a) { this.styles.push({ w, c, a }); return this; }
  fillStyle(c, a) { this.fills.push({ c, a }); return this; }
  fillTriangle() { this.triangles += 1; return this; }
  lineBetween() { this.lines += 1; return this; }
  strokeRoundedRect() { this.rounded += 1; return this; }
  setAlpha() { return this; }
}

const { outputText } = ts.transpileModule(`class Probe { ${frameMethod} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
});
const Probe = new Function('COLORS', 'HUD', `${outputText}; return Probe;`)(COLORS, HUD);
const m = { bossX: 40, bossW: 310 };

const baseline = new Probe();
baseline.bossFrame = new Gfx();
baseline.drawBossIdentityFrame(m, 'armored', 0);
const tickStyle = baseline.bossFrame.styles.find(s => s.w === 1.4);
assert.ok(tickStyle && tickStyle.c === COLORS.white && tickStyle.a === 0.38, 'armored rest state: six quiet white ticks share one 1.4/0.38 style');
assert.equal(baseline.bossFrame.lines, 5, 'rest state draws the five internal separators delimiting six segments');
assert.equal(baseline.bossFrame.triangles, 2, 'emblem is a real diamond (two triangles), not one triangle');
assert.equal(baseline.bossFrame.rounded, 1, 'hairline frame present');

const recovery = new Probe();
recovery.bossFrame = new Gfx();
recovery.drawBossIdentityFrame(m, 'recovery', 0);
assert.ok(recovery.bossFrame.styles.every(s => s.c !== COLORS.white || s.a === 0.32), 'recovery: no quiet white ticks remain');
assert.ok(recovery.bossFrame.styles.some(s => s.c === COLORS.gold && s.a === 0.85), 'recovery: six gold ticks at raised alpha');

const broken = new Probe();
broken.bossFrame = new Gfx();
broken.drawBossIdentityFrame(m, 'broken', 0);
assert.ok(broken.bossFrame.styles.some(s => s.c === COLORS.green && s.a === 0.85), 'broken: green ticks');

const flash = new Probe();
flash.bossFrame = new Gfx();
flash.drawBossIdentityFrame(m, 'armored', 1);
const flashTicks = flash.bossFrame.styles.filter(s => s.c === COLORS.white && s.a > 0.38 && s.w > 1.4);
assert.ok(flashTicks.length >= 1 && flashTicks.every(s => s.a <= 1), 'transition flash: ticks thicken and brighten, alpha clamped');
assert.ok(flash.bossFrame.styles.some(s => s.a > 0.32 && s.w === 1), 'hairline frame participates in the flash');
assert.ok(flash.bossFrame.lines > 5, 'flash adds the diamond emblem outline');

// --- 3. P3: bossFrame follows the cinematic HUD dim like every other boss part ---
const dimMethod = sceneClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(ast) === 'setHudCinematicAlpha')?.getText(ast);
assert.ok(dimMethod, 'setHudCinematicAlpha() found');
const dimCode = ts.transpileModule(`class DimProbe { ${dimMethod} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const tracked = {};
const mk = name => ({ name, alpha: 1, setAlpha(v) { this.alpha = v; tracked[name] = v; return this; } });
const DimProbe = new Function('Phaser', `${dimCode}; return DimProbe;`)({ Math: { Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) } });
const dim = new DimProbe();
const names = ['hudBackdrop','hudMembrane','xpBack','xpFill','hpBack','hpFill','bossBack','bossFill','bossFrame','bossLabel','timerText','levelText','rnaPickupText','killsText','hpText','muteText','pauseHit','pauseText','comboText'];
for (const n of names) dim[n] = mk(n);
dim.setHudCinematicAlpha(0.12);
assert.equal(tracked.bossFrame, 0.12, 'P3: bossFrame dims with the rest of the HUD during boss reveal');
for (const n of names) assert.equal(tracked[n], 0.12, `${n} dimmed`);
dim.setHudCinematicAlpha(1);
assert.equal(tracked.bossFrame, 1, 'P3: bossFrame restores to full alpha');
for (const n of names) assert.equal(tracked[n], 1, `${n} restored`);

// --- 4. World aura: single authoritative getter + transition pulse ---
const enemySource = readFileSync('src/game/Enemy.ts', 'utf8');
const enemyAst = ts.createSourceFile('Enemy.ts', enemySource, ts.ScriptTarget.Latest, true);
const enemyClass = enemyAst.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Enemy');
const updateAura = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'updatePrimeAura')?.getText(enemyAst);
assert.match(updateAura, /this\.getPhaseMode\(\)\s*\?\?\s*'armored'/, 'world aura phase comes from getPhaseMode(), not duplicated state logic');
assert.match(updateAura, /phaseTransitionPulse/, 'world aura draws the transition pulse');
const getPhase = enemyClass.members.find(n => ts.isMethodDeclaration(n) && n.name?.getText(enemyAst) === 'getPhaseMode')?.getText(enemyAst);
assert.match(getPhase, /pressure-wave/, 'pressure-wave remains the only phased boss; heartbeat untouched');
assert.doesNotMatch(getPhase, /heartbeat/, 'heartbeat boss is not pulled into the phase system');

console.log('boss phase ceremony: 420ms ease-out pulse on HUD frame + world aura; single getPhaseMode; bossFrame in cinematic dim; diamond emblem PASS');
