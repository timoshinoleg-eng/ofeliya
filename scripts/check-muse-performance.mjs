import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadArt(dpr) {
  const exports={};
  const code=ts.transpileModule(readFileSync('src/game/ArtMetrics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const context={exports,Object,Number,Math,...(dpr===undefined?{}:{window:{devicePixelRatio:dpr}})};
  vm.runInNewContext(code,context);
  return {exports,context};
}

// Execute the real production update prefix through its movement boundary. Everything
// after velocity assignment is unrelated combat IO and remains covered by browser scenes.
const sceneSource=readFileSync('src/scenes/GameScene.ts','utf8');
const ast=ts.createSourceFile('GameScene.ts',sceneSource,ts.ScriptTarget.Latest,true);
const scene=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name.text==='GameScene');
const update=scene.members.find(n=>n.name?.getText(ast)==='update');
const prefix=update.body.getText(ast).slice(1).split('    if (len > 0.1)')[0];
const compiled=ts.transpileModule(`function step(time:number,delta:number){${prefix}}`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
const step=new Function('PLAYER','SIMULATION',`${compiled};return step;`)({speed:180},{maxDeltaMs:50});
const samples=[],questSamples=[],velocity=[];
const game={maybeCompleteBossDefeatCeremony(){},stageDirector:{phase:'RUNNING',currentStage:{}},
  runtimeQuality:{recordFrame(delta){samples.push(delta);return false;}},runtimeQualityRegistryAt:Infinity,
  visualDensityRefreshAt:Infinity,runState:{run:{timeMs:0},stage:{noDamageMs:0,speedMul:1},tick(delta){this.run.timeMs+=delta;}},
  quests:{tick(...args){questSamples.push(args);}},resumed:true,achievementCheckAcc:0,captureAchievements(){},
  keys:{D:{isDown:true}},registry:{get(){return undefined;}},player:{body:{setVelocity(...args){velocity.push(args);}}}};
step.call(game,0,10000);
assert.equal(samples[0],10000,'quality governor observes raw suspended-frame duration');
assert.equal(game.runState.run.timeMs,50,'simulation clamps suspended frame to 50ms');
assert.equal(questSamples[0][0],50,'quest observes actual clamped simulation time');
game.awaitingChoice=true;step.call(game,50,16);
assert.deepEqual(velocity.at(-1),[0,0],'keyboard cannot steer through mutation modal');
game.awaitingChoice=false;step.call(game,66,16);
assert.deepEqual(velocity.at(-1),[180,0],'keyboard resumes normally after modal');
for(const [dpr,want] of [[undefined,4],[1,2],[1.5,3],[2.5,4]]) {
  const {exports:art,context}=loadArt(dpr);
  for(const key of ['virus-player','immune-antibody','bio-cycle-virus-player','bio-cycle-immune-antibody','bio-hit-virus-player','bio-hit-immune-antibody']) {
    assert.equal(art.artSourceFactor(key),want,`${key} DPR ${dpr}`);
    assert.equal(56*want*art.artScale(key,1),56,'logical art footprint is invariant');
  }
  if(context.window){context.window.devicePixelRatio=4;assert.equal(art.artSourceFactor('virus-player'),want,'bake factor cannot drift after boot');}
  assert.equal(art.artSourceFactor('combat-particles'),1);
}
console.log('PASS Muse phase0 raw governor/clamped simulation/modal keyboard/session DPR geometry');
