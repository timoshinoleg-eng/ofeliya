import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/systems/MotionPreferences.ts', 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
});
const originalWindow = globalThis.window;
try {
  delete globalThis.window;
  const noWindow = { exports: {} };
  new Function('module', 'exports', outputText)(noWindow, noWindow.exports);
  assert.equal(noWindow.exports.prefersReducedMotion(), false, 'non-browser runtime defaults to motion allowed');
  const query = { matches: true };
  globalThis.window = { matchMedia: () => query };
  const withWindow = { exports: {} };
  new Function('module', 'exports', outputText)(withWindow, withWindow.exports);
  assert.equal(withWindow.exports.prefersReducedMotion(), true, 'reduce preference is detected');
  query.matches = false;
  assert.equal(withWindow.exports.prefersReducedMotion(), false, 'cached media query follows preference changes');
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}

const game = readFileSync('src/scenes/GameScene.ts', 'utf8');
const enemy = readFileSync('src/game/Enemy.ts', 'utf8');
const ui = readFileSync('src/scenes/UIScene.ts', 'utf8');
assert.match(game, /import \{ prefersReducedMotion \} from '\.\.\/systems\/MotionPreferences'/);
assert.match(game, /if \(prefersReducedMotion\(\)\) return;[\s\S]{0,100}cameras\.main\.shake/,
  'reduced motion suppresses decorative camera shake');
assert.match(enemy, /if \(prefersReducedMotion\(\)\) \{[\s\S]{0,260}setRotation\(0\)[\s\S]{0,260}return;/,
  'boss world aura rotation and breathing are neutralized');
assert.match(enemy, /setRotation\(reducedMotion \? 0 : time \* 0\.0008\)/,
  'heartbeat boss rotation is also static for reduced motion');
assert.match(ui, /const bossPulse =[\s\S]{0,220}: 0;/,
  'boss HUD transition pulse is suppressed while phase color remains available');
assert.match(game, /const echo = enemy\.getDangerEcho\(time\)/,
  'actionable danger echo generation remains independent of decorative motion preference');
assert.doesNotMatch(readFileSync('src/game/Enemy.ts', 'utf8').match(/getDangerEcho\(now: number\)[\s\S]*?\n  }/)?.[0] ?? '', /prefersReducedMotion/,
  'combat warning timing and geometry are not hidden by reduced motion');
console.log('reduced-motion contract passed (preference, camera shake, boss aura/HUD, actionable danger retained)');
