const assert=require('node:assert/strict');
const path=require('node:path'),{createRequire}=require('node:module');
(async()=>{
const root=path.resolve(__dirname,'..');process.chdir(root);const req=createRequire(path.join(root,'package.json'));
const {createServer}=req('vite'),{chromium}=req('playwright');
const server=await createServer({root,server:{host:'127.0.0.1',port:0}});let browser;
try{
await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:740}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.route('https://st.max.ru/**',r=>r.fulfill({contentType:'application/javascript',body:''}));
await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})}));
await page.addInitScript(()=>{localStorage.setItem('ofeliya_save_v1',JSON.stringify({runs:15,muted:true,achievements:[],evolutionsSeen:[],legendarySeen:[]}));localStorage.setItem('ofeliya_difficulty_v1','standard');localStorage.setItem('ofeliya_control_mode_v1','dual-move')});
await page.goto(server.resolvedUrls.local[0]+'?renderer=canvas',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
await page.evaluate(()=>window.__game.scene.getScene('Menu').scene.start('Game'));
await page.waitForFunction(()=>window.__game?.scene.getScene('Game').wave&&window.__game.scene.isActive('UI'));
const before=await page.evaluate(async()=>{
const game=window.__game,scene=game.scene.getScene('Game'),ui=game.scene.getScene('UI');

const {ANOMALY_ATTACK_PACING}=await import('/src/game/AnomalyPrime.ts');
const {STAGES}=await import('/src/game/StageDefinitions.ts');ui.dismissProgressionForStageBoundary();game.scene.resume('Game');
for(const e of scene.enemies.getChildren())if(e.active)e.deactivateForStageReset();
const enemy=scene.spawnEnemy('anomaly',scene.player.x,scene.player.y,false);scene.wave.anomaly=enemy;scene.wave.anomalySpawned=true;
Object.assign(enemy,{anomalyAttackState:'telegraph',anomalyAttackKind:'radial-burst',anomalyAttackStartedAt:scene.time.now,anomalyStateUntil:scene.time.now+100,anomalyCommittedPacing:{...ANOMALY_ATTACK_PACING.phase1},anomalyCommittedDamage:14});
scene.runState.stage.hp=6;scene.player.hurtUntil=0;scene.stageDirector.phase='STAGE_TRANSITION';scene.beginStageTransition(STAGES[0],STAGES[1]);
return {phase:scene.stageDirector.phase,hp:scene.runState.stage.hp,gameActive:game.scene.isActive('Game'),physicsPaused:scene.physics.world.isPaused,stateUntil:enemy.anomalyStateUntil,now:scene.time.now,transitionActive:!!scene.stageTransition,attackState:enemy.anomalyAttackState};
});
await page.waitForTimeout(450);
const frozen=await page.evaluate(()=>{const g=window.__game,s=g.scene.getScene('Game');return {phase:s.stageDirector.phase,hp:s.runState.stage.hp,result:!!g.registry.get('runResult'),attackState:s.wave.anomaly?.anomalyAttackState}});
assert.equal(before.physicsPaused,true);
assert.equal(frozen.hp,6,'anomaly damaged the frozen player');
assert.equal(frozen.result,false,'anomaly ended the run during transition');
assert.equal(frozen.attackState,'telegraph','anomaly attack state advanced while frozen');
await page.evaluate(()=>{const s=window.__game.scene.getScene('Game');s.requestStageTransitionCommit(s.stageTransition.token)});
await page.waitForFunction(()=>window.__game.scene.getScene('Game').stageDirector.currentStage.id==='heart');
assert.equal(await page.evaluate(()=>!!window.__game.registry.get('runResult')),false);
await page.evaluate(()=>{const g=window.__game;g.scene.stop('UI');g.scene.stop('Game');g.scene.start('Game')});
await page.waitForFunction(()=>window.__game.scene.getScene('Game').stageDirector.currentStage.id==='bloodstream'&&window.__game.scene.isActive('UI'));
const guards=await page.evaluate(async()=>{
 const g=window.__game,s=g.scene.getScene('Game');g.scene.getScene('UI').dismissProgressionForStageBoundary();g.scene.resume('Game');s.runState.stage.hp=6;const enemy=s.spawnEnemy('anomaly',s.player.x,s.player.y,false);s.wave.anomaly=enemy;
 for(const phase of ['STAGE_START','BOSS_DEFEATED','STAGE_TRANSITION','RUN_ENDED']){
  s.stageDirector.phase=phase;s.player.hurtUntil=0;
  s.triggerAnomalyBurst(enemy,150,14);
  if(s.runState.stage.hp!==6)return {failed:phase};
 }
 s.cancelStageTransition();s.stageDirector.phase='PLAYING';s.runState.stage.hp=100;s.player.hurtUntil=0;
 s.triggerAnomalyBurst(enemy,150,14);
 const combatHp=s.runState.stage.hp;
 const {WaveDirector}=await import('/src/game/WaveDirector.ts');
 const {STAGES}=await import('/src/game/StageDefinitions.ts');
 enemy.deactivateForStageReset();
 s.wave=new WaveDirector(s,s.enemies,STAGES[0],s.difficulty,()=>0.5,()=>0.5,()=>0.5);
 s.awaitingChoice=false;s.legendaryRewardPending=false;s.pendingEvolutionCeremony=null;
 s.pendingLegendaryCeremony=null;s.hitStopped=false;s.zeroPointUntil=0;s.bossDefeatCeremony=null;
 const def=STAGES[0].waveEvents[0];s.runState.stage.timeMs=def.atMs-def.telegraphMs-16;
 s.runState.run.timeMs=s.runState.stage.timeMs;
 const safe=s.saveCheckpointNow(),baseline=localStorage.getItem('ofeliya_run_checkpoint_v1');
 s.runState.stage.timeMs=def.atMs-def.telegraphMs;s.wave.updateWaveEvents(s.runState.stage.timeMs);
 const blocked=s.saveCheckpointNow();
 return {combatHp,safe,blocked,checkpointUnchanged:baseline===localStorage.getItem('ofeliya_run_checkpoint_v1'),pending:s.wave.waveEventInProgress};
});
assert.deepEqual(guards,{combatHp:86,safe:true,blocked:false,checkpointUnchanged:true,pending:true},'damage callback must reject frozen phases and retain combat damage');
assert.deepEqual(errors,[]);
console.log('Anomaly lifecycle: real Phaser frozen state + damage guards PASS');
}catch(e){console.error(e.stack);process.exitCode=1}finally{await browser?.close();await server.close()}
})();
