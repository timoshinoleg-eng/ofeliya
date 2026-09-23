import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-no-damage-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const entry = join(temp, 'entry.ts');
  const bundle = join(temp, 'entry.cjs');
  writeFileSync(entry, `export { RunState } from '${resolve('src/game/RunState.ts')}';\n`);
  execFileSync(
    resolve('node_modules/esbuild/bin/esbuild'),
    [entry, '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`],
    { stdio: 'inherit' }
  );

  const { RunState } = require(bundle);
  const state = new RunState({ id: 'bloodstream', order: 1 });

  state.tick(35_000);
  assert(state.stage.noDamageMs === 35_000, 'initial no-damage streak did not accumulate');
  assert(state.run.maxNoDamageMs === 35_000, 'run max no-damage streak drifted before transition');

  state.resetStageProgression({ id: 'heart', order: 2 });
  assert(
    state.stage.noDamageMs === 35_000,
    `stage transition split the no-damage streak: ${state.stage.noDamageMs}`
  );

  state.tick(30_000);
  assert(
    state.stage.noDamageMs === 65_000,
    `cross-stage no-damage streak did not continue: ${state.stage.noDamageMs}`
  );
  assert(
    state.run.maxNoDamageMs === 65_000,
    `run-wide no-damage record did not reach 65s: ${state.run.maxNoDamageMs}`
  );

  state.resetNoDamage();
  assert(state.stage.noDamageMs === 0, 'actual damage reset did not clear current streak');
  state.tick(5_000);
  assert(state.stage.noDamageMs === 5_000, 'streak did not restart after damage');
  assert(state.run.maxNoDamageMs === 65_000, 'historical max streak was incorrectly erased by damage');

  console.log('run-wide no-damage streak contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
