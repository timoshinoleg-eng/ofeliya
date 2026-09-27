import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-rna-overflow-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/RnaOverflow.ts',
      'src/game/RunState.ts',
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

  const {
    mergeRnaOverflowValue,
    pickRnaOverflowTarget,
  } = require(join(temp, 'game/RnaOverflow.js'));
  const { RunState } = require(join(temp, 'game/RunState.js'));

  const drops = [
    { id: 'far', active: true, x: 0, y: 0, value: 7 },
    { id: 'near', active: true, x: 95, y: 102, value: 3 },
    { id: 'inactive', active: false, x: 100, y: 100, value: 50 },
  ];
  const target = pickRnaOverflowTarget(drops, 100, 100);
  assert(target?.id === 'near', 'overflow did not select the nearest active RNA fragment');

  const totalBefore = drops.filter((drop) => drop.active).reduce((sum, drop) => sum + drop.value, 0);
  target.value = mergeRnaOverflowValue(target.value, 5);
  target.x = 100;
  target.y = 100;
  const totalAfter = drops.filter((drop) => drop.active).reduce((sum, drop) => sum + drop.value, 0);
  assert(totalAfter === totalBefore + 5, 'overflow merge lost RNA value');
  assert(target.x === 100 && target.y === 100, 'overflow target was not relocatable to the fresh drop');

  target.value = mergeRnaOverflowValue(target.value, 4);
  const totalAfterSecondOverflow =
    drops.filter((drop) => drop.active).reduce((sum, drop) => sum + drop.value, 0);
  assert(totalAfterSecondOverflow === totalBefore + 9, 'repeated overflow did not conserve RNA');

  const state = new RunState({ id: 'bloodstream', order: 1 });
  state.stage.level = 14;
  state.stage.xp = 24;
  state.stage.xpNext = 130;

  assert(state.addXp(1) === 0, '24/130 unexpectedly triggered a level-up');
  assert(state.stage.xp === 25 && state.stage.xpNext === 130, 'XP did not advance from 24/130');
  assert(state.addXp(1) === 0, '25/130 unexpectedly triggered a level-up');
  assert(state.stage.xp === 26, 'XP did not continue past 25/130');
  assert(state.addXp(104) === 1, 'crossing 130 RNA did not trigger exactly one level-up');
  assert(state.stage.level === 15, 'level did not advance after crossing the RNA threshold');
  assert(state.stage.xp === 0, 'threshold crossing left an unexpected RNA remainder');
  assert(state.stage.xpNext === 144, 'next RNA threshold drifted from the progression curve');

  console.log('RNA overflow/progression deterministic smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
