import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-stages-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/StageDefinitions.ts',
      'src/game/StageDirector.ts',
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

  const { RunState } = require(join(temp, 'game/RunState.js'));
  const { StageDirector } = require(join(temp, 'game/StageDirector.js'));
  const { STAGES, difficultyForStage, getStageById, getStageByOrder, nextStage } = require(
    join(temp, 'game/StageDefinitions.js')
  );

  assert(STAGES.length === 1, 'PR 1 catalog must expose only the current Bloodstream stage');
  const bloodstream = STAGES[0];
  assert(bloodstream.id === 'bloodstream' && bloodstream.order === 1, 'Bloodstream identity changed');
  assert(bloodstream.durationMs === 300_000, 'Bloodstream boss timing changed');
  assert(bloodstream.bossWarningLeadMs === 0, 'PR 1 must not add a boss warning ceremony');
  assert(bloodstream.waves.spawnIntervalStartMs === 1150, 'opening spawn interval changed');
  assert(bloodstream.waves.spawnIntervalEndMs === 330, 'late spawn interval changed');
  assert(bloodstream.waves.eliteEveryMs === 120_000, 'elite cadence changed');
  assert(bloodstream.waves.bossPhaseSpawnMultiplier === 0.35, 'boss pressure changed');
  assert(bloodstream.waves.openingSpawns.length === 3, 'opening encounter changed');
  assert(bloodstream.milestones.length === 6, 'Bloodstream story milestones changed');
  assert(getStageById('bloodstream') === bloodstream, 'stage lookup by id failed');
  assert(getStageByOrder(1) === bloodstream, 'stage lookup by order failed');
  assert(nextStage(bloodstream) === undefined, 'PR 1 must keep Boss 1 as the terminal encounter');
  let invalidCatalogRejected = false;
  try {
    new StageDirector([{ ...bloodstream, order: 2 }]);
  } catch {
    invalidCatalogRejected = true;
  }
  assert(invalidCatalogRejected, 'non-contiguous stage catalog was accepted');

  const difficulty = difficultyForStage(bloodstream, 120_000);
  assert(Math.abs(difficulty.hpScale - 1.84) < 1e-9, 'enemy HP curve changed');
  assert(Math.abs(difficulty.dmgScale - 1.24) < 1e-9, 'enemy damage curve changed');
  assert(bloodstream.waves.pickKind(89_999, 0.99) === 'swarm', 'opening enemy mix changed');
  assert(bloodstream.waves.pickKind(90_000, 0.8) === 'runner', 'T-cell boundary changed');
  assert(bloodstream.waves.pickKind(120_000, 0.95) === 'brute', 'macrophage boundary changed');

  const single = new StageDirector(STAGES);
  assert(single.startRun()[0]?.type === 'stage-started', 'run did not start');
  assert(single.startRun().length === 0, 'run started twice');
  const terminalEvents = single.update(bloodstream.durationMs);
  assert(
    terminalEvents.filter((event) => event.type === 'milestone').length === 6,
    'crossed milestones were not emitted exactly once'
  );
  assert(
    terminalEvents.at(-1)?.type === 'boss-spawn-requested' && single.phase === 'BOSS_ACTIVE',
    'boss activation failed'
  );
  assert(single.update(bloodstream.durationMs + 1).length === 0, 'boss spawned more than once');
  const defeated = single.bossDefeated();
  assert(defeated[0]?.type === 'boss-defeated', 'boss defeat event missing');
  assert(single.phase === 'BOSS_DEFEATED', 'boss death ceremony phase was skipped');
  const ending = single.completeBossDefeat();
  assert(ending[0]?.type === 'run-ended', 'terminal boss did not end the campaign');
  assert(single.phase === 'RUN_ENDED', 'terminal phase mismatch');
  assert(single.bossDefeated().length === 0, 'boss defeat handled more than once');

  const first = {
    ...bloodstream,
    durationMs: 1_000,
    bossWarningLeadMs: 200,
    milestones: [{ id: 'test-beat', atMs: 400, title: 'TEST', subtitle: 'TEST', color: 0xffffff }],
  };
  const second = {
    ...bloodstream,
    id: 'heart-test',
    order: 2,
    name: 'HEART TEST',
    durationMs: 2_000,
    bossWarningLeadMs: 0,
    milestones: [],
    boss: { ...bloodstream.boss, id: 'heart-boss-test', name: 'HEART BOSS TEST' },
  };
  const multi = new StageDirector([second, first]);
  multi.startRun();
  const warning = multi.update(800);
  assert(warning.some((event) => event.type === 'boss-warning'), 'boss warning was not emitted');
  assert(multi.phase === 'BOSS_WARNING', 'boss warning phase mismatch');
  assert(multi.update(1_000).at(-1)?.type === 'boss-spawn-requested', 'warned boss did not spawn');
  multi.bossDefeated();
  const transition = multi.completeBossDefeat();
  assert(
    transition.at(-1)?.type === 'stage-transition-requested' && multi.phase === 'STAGE_TRANSITION',
    'non-terminal boss did not request transition'
  );
  multi.completeTransition();
  assert(multi.currentStage.id === second.id && multi.phase === 'STAGE_START', 'next stage setup mismatch');
  assert(multi.completeTransition().length === 0, 'transition completed more than once');
  const nextEvents = multi.startStage();
  assert(nextEvents[0]?.type === 'stage-started', 'next stage did not start');
  assert(multi.phase === 'PLAYING', 'next stage state mismatch');

  const state = new RunState(first);
  state.tick(10_000);
  state.recordKill(2_500);
  state.recordHostCellInfected();
  state.addEvolution('prism');
  state.stage.level = 8;
  state.stage.damageMul = 3;
  state.recordBossDefeated(first.boss.id);
  state.recordBossDefeated(first.boss.id);
  state.resetStageProgression(second);
  assert(state.run.timeMs === 10_000, 'stage reset erased run time');
  assert(state.run.kills === 1, 'stage reset erased run kills');
  assert(state.run.hostCellsInfected === 1, 'stage reset erased infected cells');
  assert(state.run.bossesDefeated === 1, 'boss defeat was lost or counted twice');
  assert(state.run.evolutionsSeen.has('prism'), 'stage reset erased discovered evolution');
  assert(state.run.highestStageOrder === 2, 'highest stage was not preserved');
  assert(state.stage.id === second.id && state.stage.timeMs === 0, 'stage timer did not reset');
  assert(state.stage.level === 1 && state.stage.damageMul === 1, 'combat progression did not reset');
  assert(state.stage.kills === 0 && state.stage.evolutions.size === 0, 'stage counters did not reset');

  console.log('stage runtime contract smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
