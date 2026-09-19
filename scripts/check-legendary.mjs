import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-legendary-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/LegendarySystem.ts',
      'src/game/RunState.ts',
      'src/game/UpgradeSystem.ts',
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

  const { RunState } = require(join(temp, 'game/RunState.js'));
  const { ImpactDirector } = require(join(temp, 'game/ImpactDirector.js'));
  const { VfxBudget } = require(join(temp, 'systems/VfxBudget.js'));
  const {
    LEGENDARY_PITY_OFFERS,
    MAX_LEGENDARIES_PER_RUN,
    eligibleLegendaries,
    rollLegendaryChoice,
  } = require(join(temp, 'game/LegendarySystem.js'));

  const state = new RunState({ id: 'bloodstream', order: 1 });
  let eligible = eligibleLegendaries(state);
  assert(eligible.some((x) => x.id === 'zero-point'), 'starter Legendary missing');
  assert(!eligible.some((x) => x.id === 'myocardial-rhythm'), 'Heart Legendary leaked into Bloodstream');
  assert(!eligible.some((x) => x.id === 'split-geometry'), 'prerequisite gating failed');

  for (let i = 0; i < LEGENDARY_PITY_OFFERS; i++) {
    assert(rollLegendaryChoice(state, () => 0.99) === null, 'pity triggered too early');
  }
  const pity = rollLegendaryChoice(state, () => 0.99);
  assert(pity?.kind === 'legendary', 'pity did not guarantee a Legendary');
  assert(state.run.legendaryPity === 0, 'pity did not reset after shown Legendary');

  const deterministicA = new RunState({ id: 'bloodstream', order: 1 });
  const deterministicB = new RunState({ id: 'bloodstream', order: 1 });
  const a = rollLegendaryChoice(deterministicA, () => 0);
  const b = rollLegendaryChoice(deterministicB, () => 0);
  assert(a?.id === b?.id, 'Legendary selection is not deterministic with injected RNG');

  const heart = new RunState({ id: 'heart', order: 2 });
  assert(
    eligibleLegendaries(heart).some((x) => x.id === 'myocardial-rhythm'),
    'Heart Legendary gating failed'
  );

  assert(state.addLegendary('zero-point'), 'first Legendary was rejected');
  assert(!state.addLegendary('zero-point'), 'duplicate Legendary was accepted');
  assert(state.addLegendary('core-predator'), 'second Legendary was rejected');
  assert(state.addLegendary('last-carrier'), 'third Legendary was rejected');
  assert(state.run.legendaryIds.size === MAX_LEGENDARIES_PER_RUN, 'max Legendary invariant drifted');
  assert(!state.addLegendary('myocardial-rhythm'), 'fourth Legendary exceeded max-per-run');
  assert(eligibleLegendaries(state).length === 0, 'offers remained after max Legendary cap');

  const impact = new ImpactDirector();
  assert(impact.hitStopMs('critical_hit') === 12, 'critical hit-stop budget drifted');
  assert(impact.hitStopMs('elite_death') === 20, 'elite hit-stop budget drifted');
  assert(impact.hitStopMs('legendary_pick') === 220, 'Legendary presentation budget drifted');
  assert(impact.hitStopMs('boss_phase') === 28, 'boss hit-stop budget drifted');
  assert(impact.allowCameraShake(1_000), 'first camera shake should be allowed');
  assert(!impact.allowCameraShake(1_050), 'camera-shake cooldown was bypassed');
  assert(impact.allowCameraShake(1_100), 'camera shake did not recover after cooldown');
  assert(impact.acquireFullscreen(2_000, 300), 'fullscreen slot did not acquire');
  assert(!impact.acquireFullscreen(2_100, 100), 'fullscreen overlap was allowed');
  assert(impact.acquireFullscreen(2_300, 100), 'fullscreen slot did not release');

  const budget = new VfxBudget(10, 20);
  assert(budget.request(15, 0, true) === 15, 'burst reservoir grant mismatch');
  assert(budget.request(10, 0, false) === 5, 'budget allowed particles beyond remaining tokens');
  assert(budget.request(10, 1_000, false) === 10, 'sustained VFX budget did not regenerate');
  assert(budget.request(100, 1_000, true) === 0, 'empty reservoir emitted particles');

  console.log('legendary/impact/vfx deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
