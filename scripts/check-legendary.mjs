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

  console.log('legendary deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
