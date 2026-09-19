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
      'src/game/UpgradeSystem.ts',
      'src/game/HeartbeatPulseDirector.ts',
      'src/game/BossVulnerability.ts',
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
  const { UPGRADES } = require(join(temp, 'game/UpgradeSystem.js'));
  const { HeartbeatPulseDirector } = require(join(temp, 'game/HeartbeatPulseDirector.js'));
  const {
    PRIME_VULNERABILITY,
    canPrimeLysisBreak,
    primeDamageMultiplier,
    primeMembraneBreakDurationMs,
  } = require(join(temp, 'game/BossVulnerability.js'));
  const { ENEMY_DEFS } = require(join(temp, 'game/config.js'));
  const { StageDirector } = require(join(temp, 'game/StageDirector.js'));
  const {
    BLOODSTREAM_STAGE,
    HEART_STAGE,
    STAGES,
    difficultyForStage,
    getStageById,
    getStageByOrder,
    nextStage,
  } = require(join(temp, 'game/StageDefinitions.js'));

  assert(STAGES.length === 2, 'live catalog must expose Bloodstream and Heart');
  const bloodstream = STAGES[0];
  assert(bloodstream === BLOODSTREAM_STAGE, 'live Bloodstream export mismatch');
  assert(bloodstream.id === 'bloodstream' && bloodstream.order === 1, 'Bloodstream identity changed');
  assert(bloodstream.durationMs === 300_000, 'Bloodstream boss timing changed');
  assert(bloodstream.bossWarningLeadMs === 8_000, 'Bloodstream boss warning mismatch');
  assert(bloodstream.waves.spawnIntervalStartMs === 1150, 'opening spawn interval changed');
  assert(bloodstream.waves.spawnIntervalEndMs === 330, 'late spawn interval changed');
  assert(bloodstream.waves.eliteEveryMs === 120_000, 'elite cadence changed');
  assert(bloodstream.waves.bossPhaseSpawnMultiplier === 0.35, 'boss pressure changed');
  assert(bloodstream.waves.openingSpawns.length === 3, 'opening encounter changed');
  assert(bloodstream.milestones.length === 6, 'Bloodstream story milestones changed');
  assert(getStageById('bloodstream') === bloodstream, 'stage lookup by id failed');
  assert(getStageByOrder(1) === bloodstream, 'stage lookup by order failed');
  assert(nextStage(bloodstream) === HEART_STAGE, 'Bloodstream must transition to Heart');

  assert(HEART_STAGE.id === 'heart' && HEART_STAGE.order === 2, 'Heart identity mismatch');
  assert(HEART_STAGE.durationMs === 240_000, 'Heart target duration mismatch');
  assert(HEART_STAGE.bossWarningLeadMs === 8_000, 'Heart boss warning mismatch');
  assert(HEART_STAGE.theme.ambientProfile === 'heart', 'Heart ambient profile missing');
  assert(HEART_STAGE.theme.heartbeatMs === 900, 'Heart beat cadence mismatch');
  assert(HEART_STAGE.signatureMechanic === 'heartbeat-pulse', 'Heart signature mechanic missing');
  assert(HEART_STAGE.boss.id === 'cardiac-titan', 'Heart boss identity mismatch');
  assert(HEART_STAGE.boss.behavior === 'heartbeat-pulse', 'Heart boss behavior mismatch');
  assert(HEART_STAGE.waves.pickKind(0, 0.99) === 'brute', 'Heart opening mix lacks brute pressure');
  // The dormant profile itself must already satisfy the same catalog invariants as a live stage.
  new StageDirector([BLOODSTREAM_STAGE, HEART_STAGE]);

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

  const single = new StageDirector([bloodstream]);
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
  assert(ending[0]?.type === 'run-ended', 'terminal boss did not end the single-stage campaign');
  assert(single.phase === 'RUN_ENDED', 'terminal phase mismatch');
  assert(single.bossDefeated().length === 0, 'boss defeat handled more than once');

  const first = {
    ...bloodstream,
    durationMs: 1_000,
    bossWarningLeadMs: 200,
    milestones: [{ id: 'test-beat', atMs: 400, title: 'TEST', subtitle: 'TEST', color: 0xffffff }],
  };
  const second = {
    ...HEART_STAGE,
    id: 'heart-test',
    durationMs: 2_000,
    bossWarningLeadMs: 0,
    milestones: [],
    boss: { ...HEART_STAGE.boss, id: 'heart-boss-test', name: 'HEART BOSS TEST' },
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

  const infectionBuild = new RunState(first);
  const infect = UPGRADES.find((upgrade) => upgrade.id === 'infect');
  const lysis = UPGRADES.find((upgrade) => upgrade.id === 'lysis');
  const factory = UPGRADES.find((upgrade) => upgrade.id === 'factory');
  assert(infect && lysis && factory, 'infection build family is incomplete');
  infect.apply(infectionBuild);
  lysis.apply(infectionBuild);
  factory.apply(infectionBuild);
  assert(infectionBuild.infectionDurationMs < 1250, 'infection speed upgrade did not affect host cells');
  assert(infectionBuild.infectionRadius > 58, 'infection radius upgrade did not affect host cells');
  assert(infectionBuild.hostLysisDamage > 26, 'lysis damage upgrade did not scale host-cell burst');
  assert(infectionBuild.hostLysisRadius > 150, 'lysis radius upgrade did not scale host-cell burst');
  assert(infectionBuild.hostLysisRna === 5, 'viral factory did not increase RNA yield');

  // Lysis calibration harness: keep the signature mechanic meaningful without silently turning it
  // into boss-percent damage. These numbers intentionally describe the current build curve.
  const makeLysisBuild = (lysisStacks, factoryStacks) => {
    const s = new RunState(first);
    for (let i = 0; i < lysisStacks; i++) lysis.apply(s);
    for (let i = 0; i < factoryStacks; i++) factory.apply(s);
    return s;
  };
  const baseLysis = makeLysisBuild(0, 0).hostLysisDamage;
  const mediumLysis = makeLysisBuild(2, 1).hostLysisDamage;
  const maxLysis = makeLysisBuild(4, 3).hostLysisDamage;
  assert(Math.abs(baseLysis - 26) < 1e-9, 'base lysis damage changed');
  assert(
    baseLysis < mediumLysis && mediumLysis < maxLysis,
    'lysis build no longer scales monotonically'
  );
  assert(maxLysis > 95 && maxLysis < 105, 'max lysis build left the calibrated damage band');

  const lateBloodstreamScale = difficultyForStage(bloodstream, bloodstream.durationMs).hpScale;
  const lateRunnerHp = ENEMY_DEFS.runner.hp * lateBloodstreamScale;
  const lateSwarmHp = ENEMY_DEFS.swarm.hp * lateBloodstreamScale;
  const lateBruteHp = ENEMY_DEFS.brute.hp * lateBloodstreamScale;
  assert(maxLysis > lateRunnerHp, 'max lysis should delete a late T-killer');
  assert(maxLysis > lateSwarmHp, 'max lysis should delete a late antibody');
  assert(maxLysis < lateBruteHp * 0.5, 'max lysis should not trivialize a late macrophage');

  assert(canPrimeLysisBreak('telegraph'), 'Prime lysis break must work during telegraph');
  assert(canPrimeLysisBreak('recovery'), 'Prime lysis break must work during recovery');
  assert(!canPrimeLysisBreak('pursuit'), 'Prime lysis break must require a readable timing window');
  assert(
    primeDamageMultiplier('pursuit', false) === PRIME_VULNERABILITY.armoredMultiplier,
    'Prime armored multiplier mismatch'
  );
  assert(
    primeDamageMultiplier('recovery', false) === PRIME_VULNERABILITY.recoveryMultiplier,
    'Prime recovery multiplier mismatch'
  );
  assert(
    primeDamageMultiplier('pursuit', true) === PRIME_VULNERABILITY.membraneBreakMultiplier,
    'Prime membrane-break multiplier mismatch'
  );
  assert(
    primeMembraneBreakDurationMs(1) > primeMembraneBreakDurationMs(2),
    'Prime phase 2 must shorten the extended punish window'
  );

  const primeHp = ENEMY_DEFS.boss.hp * BLOODSTREAM_STAGE.difficulty.bossHpScale;
  const titanHp = ENEMY_DEFS.boss.hp * HEART_STAGE.difficulty.bossHpScale;
  const primeArmoredHit = maxLysis * primeDamageMultiplier('pursuit', false);
  const primeRecoveryHit = maxLysis * primeDamageMultiplier('recovery', false);
  const primeBrokenHit = maxLysis * primeDamageMultiplier('recovery', true);
  const titanRhythmHit = maxLysis * 1.35;
  assert(
    primeArmoredHit < primeRecoveryHit && primeRecoveryHit < primeBrokenHit,
    'Prime vulnerability cycle does not create a meaningful punish hierarchy'
  );
  assert(
    primeBrokenHit / primeHp < 0.08,
    'one max-build lysis burst removes too much Standard IMMUNE PRIME HP'
  );
  assert(
    titanRhythmHit / titanHp < 0.05,
    'one synchronized max-build lysis burst removes too much CARDIAC TITAN HP'
  );

  const heartbeat = new HeartbeatPulseDirector();
  assert(heartbeat.update(11_299, false).length === 0, 'heartbeat telegraphed too early');
  const telegraph = heartbeat.update(11_300, false);
  assert(telegraph[0]?.type === 'heartbeat-telegraph', 'heartbeat telegraph missing');
  assert(heartbeat.pressureMultiplier === 1, 'telegraph must not apply pressure');
  const impact = heartbeat.update(12_000, false);
  assert(impact[0]?.type === 'heartbeat-impact', 'heartbeat impact missing');
  assert(Math.abs(heartbeat.pressureMultiplier - 1.18) < 1e-9, 'Heart pressure multiplier mismatch');
  heartbeat.update(13_050, false);
  assert(heartbeat.pressureMultiplier === 1, 'Heart pressure did not end');

  heartbeat.reset();
  heartbeat.update(2_000, true);
  assert(heartbeat.update(4_500, true)[0]?.type === 'heartbeat-telegraph', 'boss heartbeat telegraph missing');
  assert(heartbeat.update(5_200, true)[0]?.type === 'heartbeat-impact', 'boss heartbeat impact missing');
  assert(Math.abs(heartbeat.pressureMultiplier - 1.34) < 1e-9, 'boss pressure multiplier mismatch');

  console.log('stage runtime contract smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
