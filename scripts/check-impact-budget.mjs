import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-impact-budget-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/ImpactDirector.ts',
      'src/systems/VfxBudget.ts',
      '--target',
      'ES2020',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const { ImpactDirector } = require(join(temp, 'game/ImpactDirector.js'));
  const { VfxBudget } = require(join(temp, 'systems/VfxBudget.js'));

  const compatibility = new ImpactDirector();
  assert(compatibility.hitStopMs('critical_hit') === 12, 'critical hit-stop contract drifted');
  assert(compatibility.hitStopMs('elite_death') === 20, 'elite hit-stop contract drifted');
  assert(compatibility.hitStopMs('legendary_pick') === 220, 'legendary hit-stop contract drifted');

  const saturated = new ImpactDirector();
  let denied = 0;
  for (let i = 0; i < 20; i++) {
    if (!saturated.request('normal_hit', 100).budgetGranted) denied += 1;
  }
  assert(denied > 0, 'low-priority impact traffic never saturated the rolling budget');

  const bossAfterSpam = saturated.request('boss_impact', 110);
  assert(bossAfterSpam.budgetGranted, 'boss impact was suppressed by cosmetic budget exhaustion');
  assert(bossAfterSpam.allowCameraShake, 'boss impact lost its protected camera channel');

  const priority = new ImpactDirector();
  const ordinary = priority.request('critical_hit', 1_000);
  assert(ordinary.allowCameraShake, 'first critical impact should acquire the shake channel');
  const boss = priority.request('boss_phase', 1_020);
  assert(boss.allowCameraShake, 'boss phase must pre-empt a lower-priority shake cooldown');
  const lower = priority.request('critical_hit', 1_030);
  assert(!lower.allowCameraShake, 'lower-priority shake must not pre-empt a fresh boss shake');

  const fullscreen = new ImpactDirector();
  const rare = fullscreen.request('rare_pick', 2_000, 500);
  assert(rare.allowFullscreen, 'first reward should acquire fullscreen presentation');
  const legendary = fullscreen.request('legendary_pick', 2_010, 500);
  assert(legendary.allowFullscreen, 'legendary reward must pre-empt lower-priority fullscreen lease');
  const secondRare = fullscreen.request('rare_pick', 2_020, 500);
  assert(!secondRare.allowFullscreen, 'lower-priority fullscreen must not cover a legendary lease');

  const rolling = new ImpactDirector();
  for (let i = 0; i < 12; i++) assert(rolling.request('normal_hit', 0).budgetGranted, 'budget filled too early');
  assert(!rolling.request('normal_hit', 1).budgetGranted, 'budget overflow was not rejected');
  assert(
    rolling.request('normal_hit', 701).budgetGranted,
    'rolling impact budget did not recover after its time window'
  );

  // Normal particles may drain the sustained pool but must leave a protected burst reserve.
  const vfx = new VfxBudget(100, 200);
  assert(vfx.request(100, 0, false) === 100, 'initial sustained particle grant drifted');
  assert(vfx.request(100, 0, false) === 60, 'normal particles should stop at the protected reserve');
  assert(vfx.request(100, 0, false) === 0, 'normal particles drained the protected reserve');
  assert(vfx.debugState.tokens === 40, 'unexpected protected reserve size');
  assert(vfx.request(100, 0, true) === 40, 'critical burst could not consume the protected reserve');
  assert(vfx.request(100, 1_000, true) === 100, 'VFX budget did not refill after one second');

  for (const path of ['src/game/ImpactDirector.ts', 'src/systems/VfxBudget.ts']) {
    const source = readFileSync(resolve(path), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert(!/Math\.random\s*\(/.test(source), `${path} must remain deterministic`);
    assert(!/from ['"]phaser['"]/.test(source), `${path} must stay Phaser-free`);
  }

  const gameScene = readFileSync(resolve('src/scenes/GameScene.ts'), 'utf8');
  assert(
    /impact\.request\('player_hit'/.test(gameScene) &&
      /impact\.request\('boss_impact'/.test(gameScene) &&
      /impact\.request\('heartbeat_impact'/.test(gameScene),
    'critical semantic events are not routed through ImpactDirector'
  );
  assert(
    /preGranted = false/.test(gameScene),
    'pre-granted semantic shake path is missing or may be double-gated'
  );

  console.log('impact feedback budget deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
