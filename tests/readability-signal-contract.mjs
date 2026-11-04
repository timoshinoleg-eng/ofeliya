/**
 * A1+A2 readability contract — signal-color reservation + ambient value ceilings.
 *
 * 1. SIGNAL values are compiled from src/game/config.ts (not copied literals):
 *    danger aliases COLORS.red, rna equals the baked rna-fragment stroke.
 * 2. No COLORS.red remains in combat code — every in-combat threat site uses
 *    SIGNAL.danger. The only allowed COLORS.red uses are the palette entry in
 *    StrainZeroTextures and out-of-combat BootScene loading art.
 * 3. AtmosphereSystem ambient alphas/tints stay at or below the A1 ceilings, so
 *    the background cannot drift back above the enemies.
 * 4. RNA pickup feedback uses the reserved RNA color, and ambient decor holds
 *    no green.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-readability-'));
const require = createRequire(import.meta.url);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);
const read = (rel) => readFileSync(resolve(rel), 'utf8');

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/config.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  // tsc preserves the src/ layout (config.ts imports ../systems/PerformanceProfile).
  const { COLORS, SIGNAL } = require(join(temp, 'game', 'config.js'));

  // 1. Signal values, compiled from source.
  eq(SIGNAL.danger, 0xff3e5f, 'SIGNAL.danger');
  eq(SIGNAL.danger, COLORS.red, 'SIGNAL.danger aliases COLORS.red');
  eq(SIGNAL.rna, 0x86ffaa, 'SIGNAL.rna');

  // 1b. SIGNAL.rna matches the baked rna-fragment stroke in StrainZeroTextures.
  const textures = read('src/game/StrainZeroTextures.ts');
  const fragment = textures.slice(textures.indexOf("make('rna-fragment'"));
  const stroke = fragment.match(/strokeStyle = '#([0-9a-f]{6})'/);
  assert(stroke, 'rna-fragment stroke not found');
  eq(parseInt(stroke[1], 16), SIGNAL.rna, 'rna-fragment stroke equals SIGNAL.rna');

  // 2. Threat sites use SIGNAL.danger; no raw COLORS.red in combat code.
  const combatFiles = [
    'src/scenes/GameScene.ts',
    'src/scenes/UIScene.ts',
    'src/game/Enemy.ts',
    'src/systems/VfxSystem.ts',
    'src/game/StageDefinitions.ts',
  ];
  for (const file of combatFiles) {
    const src = read(file);
    assert(!src.includes('COLORS.red'), `${file} still uses COLORS.red`);
    assert(src.includes('SIGNAL.danger'), `${file} does not use SIGNAL.danger`);
  }

  // 3. A1 ambient ceilings in AtmosphereSystem.
  const atmo = read('src/systems/AtmosphereSystem.ts');
  const bandAlphas = [...atmo.matchAll(/alpha: \[([\d.]+), ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
  eq(bandAlphas.length, 3, 'RBC_BANDS count');
  for (const [lo, hi] of bandAlphas) {
    assert(lo <= 0.17 && hi <= 0.26, `RBC band alpha [${lo}, ${hi}] above A1 ceiling`);
  }
  assert(atmo.includes('FloatBetween(0.034, 0.079)'), 'host-cell alpha range changed');
  assert(atmo.includes('FloatBetween(0.019, 0.064)'), 'particle alpha range changed');
  assert(atmo.includes('setAlpha(heart ? 0.27 : 0)'), 'structure setStage alpha changed');
  assert(atmo.includes('0xcca186') && atmo.includes('0xccabb2') && atmo.includes('0xcccccc'), 'plasma tints changed');
  assert(!atmo.includes('COLORS.green'), 'ambient decor still uses COLORS.green');

  // 4. RNA feedback uses the reserved RNA color.
  const ui = read('src/scenes/UIScene.ts');
  assert(ui.includes("text(0, 0, '', 11, '#86ffaa', 0)"), 'rnaPickupText color is not SIGNAL.rna');

  console.log('readability-signal contract: OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
