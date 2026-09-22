/**
 * UI token contract - value lock + source scan for SLICE-TOKENS-01R.
 * Values are frozen to the literals present at main @ b898fd4.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-tokens-'));
const require = createRequire(import.meta.url);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => assert(actual === expected, `${message}: expected ${expected}, got ${actual}`);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/ui/tokens.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { BP, SPACE, PANEL, BORDER, SCRIM, BUTTON, TOUCH, CLAMP, ROLE } = require(join(temp, 'tokens.js'));

  // 1. Value lock
  eq(BP.compact, 650, 'BP.compact');
  eq(BP.compactNarrow, 620, 'BP.compactNarrow');
  eq(BP.narrow, 360, 'BP.narrow');
  eq(SPACE.xxs, 2, 'SPACE.xxs');
  eq(SPACE.gutter, 32, 'SPACE.gutter');
  eq(PANEL.sheet, 0.995, 'PANEL.sheet');
  eq(PANEL.card, 0.985, 'PANEL.card');
  eq(PANEL.raised, 0.97, 'PANEL.raised');
  eq(PANEL.panel, 0.95, 'PANEL.panel');
  eq(PANEL.raisedSoft, 0.94, 'PANEL.raisedSoft');
  eq(PANEL.button, 0.92, 'PANEL.button');
  eq(PANEL.dim, 0.9, 'PANEL.dim');
  eq(PANEL.band, 0.78, 'PANEL.band');
  eq(PANEL.plate, 0.46, 'PANEL.plate');
  eq(BORDER.hair, 1, 'BORDER.hair');
  eq(BORDER.thin, 1.4, 'BORDER.thin');
  eq(BORDER.base, 2, 'BORDER.base');
  eq(BORDER.heavyLg, 3.5, 'BORDER.heavyLg');
  eq(SCRIM.transition.color, 0x050308, 'SCRIM.transition.color');
  eq(SCRIM.transition.alpha, 0.96, 'SCRIM.transition.alpha');
  eq(SCRIM.pause.color, 0x05070f, 'SCRIM.pause.color');
  eq(SCRIM.pause.alpha, 0.9, 'SCRIM.pause.alpha');
  eq(SCRIM.levelUp.color, 0x09040a, 'SCRIM.levelUp.color');
  eq(SCRIM.levelUp.alpha, 0.91, 'SCRIM.levelUp.alpha');
  eq(SCRIM.legendary.color, 0x030208, 'SCRIM.legendary.color');
  eq(SCRIM.legendary.alpha, 0.94, 'SCRIM.legendary.alpha');
  eq(SCRIM.evolution.color, 0x03040a, 'SCRIM.evolution.color');
  eq(SCRIM.evolution.alpha, 0.9, 'SCRIM.evolution.alpha');
  eq(SCRIM.result.color, 0x05070f, 'SCRIM.result.color');
  eq(SCRIM.result.alpha, 0.84, 'SCRIM.result.alpha');
  eq(BUTTON.primaryFill, 0.18, 'BUTTON.primaryFill');
  eq(BUTTON.secondaryFill, 0.95, 'BUTTON.secondaryFill');
  eq(BUTTON.strokeWidth, 2, 'BUTTON.strokeWidth');
  eq(BUTTON.strokeAlpha, 1, 'BUTTON.strokeAlpha');
  eq(TOUCH.min, 44, 'TOUCH.min');
  eq(TOUCH.chip, 24, 'TOUCH.chip');
  eq(CLAMP.panelMax, 370, 'CLAMP.panelMax');
  eq(CLAMP.cardMax, 374, 'CLAMP.cardMax');
  eq(CLAMP.buttonMax, 230, 'CLAMP.buttonMax');
  eq(CLAMP.bottomReserve, 205, 'CLAMP.bottomReserve');
  eq(CLAMP.fitMinScaleDefault, 0.62, 'CLAMP.fitMinScaleDefault');
  eq(ROLE.surface.screen, 0x12070d, 'ROLE.surface.screen');
  eq(ROLE.surface.panel, 0x1d0d18, 'ROLE.surface.panel');
  eq(ROLE.faction.player, 0xff4fb5, 'ROLE.faction.player');
  eq(ROLE.faction.reward, 0x7fffa1, 'ROLE.faction.reward');
  eq(ROLE.rarity.legendary, 0xffd56a, 'ROLE.rarity.legendary');
  eq(ROLE.state.bad, 0xff5a5a, 'ROLE.state.bad');

  // 2. Module hygiene: data only
  const src = readFileSync('src/ui/tokens.ts', 'utf8');
  for (const bad of ["from 'phaser'", '../systems', '../scenes', '../game/config']) {
    assert(!src.includes(bad), `tokens.ts must not import ${bad}`);
  }
  assert(!/console\.|window\.|document\./.test(src), 'tokens.ts must have no runtime side effects');
  assert(!/export const TYPE/.test(src), 'TYPE must not exist in SLICE-TOKENS-01R');

  // 3. Sites actually adopted
  const ui = readFileSync('src/scenes/UIScene.ts', 'utf8');
  assert(ui.includes("from '../ui/tokens'"), 'UIScene must import the token module');
  const retired = [
    '0x050308, 0.96',
    '0x05070f, 0.9)',
    '0x09040a, 0.91',
    '0x030208, 0.94',
    '0x03040a, 0.9)',
    '0x05070f, 0.84',
    'primary ? 0.18 : 0.95',
    'COLORS.stroke, 1);',
  ];
  for (const gone of retired) {
    assert(!ui.includes(gone), `replacement site still holds the raw literal: ${gone}`);
  }
  assert(
    ui.split('primary ? BUTTON.primaryFill : BUTTON.secondaryFill').length - 1 === 2,
    'button fill token must be used at both the create and the pointerout site'
  );

  // 4. Gameplay isolation (inbound)
  const gameplay = [
    'src/scenes/GameScene.ts',
    'src/game/RunState.ts',
    'src/game/WaveDirector.ts',
    'src/game/DifficultyProfile.ts',
  ];
  for (const file of gameplay) {
    assert(!readFileSync(file, 'utf8').includes('ui/tokens'), `${file} must not import UI tokens`);
  }

  console.log('ui tokens contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}