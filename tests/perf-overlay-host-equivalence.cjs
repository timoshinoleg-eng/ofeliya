// PERF-03 deterministic before/after graphics counts and gameplay/geometry parity.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {execFileSync}=require('node:child_process');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const sha='b738ec9c691d10c3af7a5ef3d5bf4e17abb95ae4';
const phaser={Math:{Clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),FloatBetween:(a,b)=>(a+b)/2,Between:(a,b)=>Math.floor((a+b)/2)},BlendModes:{ADD:1}};
const colors={green:0x00ff77,gold:0xffbb00,white:0xffffff,magenta:0xff00aa};
const savedLoad=Module._load;
Module._load=function(request,...args){
 if(request==='phaser')return phaser;
 if(request==='../game/config')return {COLORS:colors};
 if(request==='../game/ArtMetrics')return {artScale:(_key,n)=>n,artSourceFactor:()=>1};
 if(request==='./HostCellRecycling')return {selectHostCellRecycleIndex:()=>null};
 return savedLoad.call(this,request,...args);
};
function compile(src,name){
 const filename=path.join(root,'src/systems',name);
 const mod=new Module(filename,module);
 mod.filename=filename;
 mod.paths=Module._nodeModulePaths(path.dirname(filename));
 mod._compile(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
 return mod.exports;
}
function load(name){
 const src=fs.readFileSync(path.join(root,'src/systems',name),'utf8');
 const original=execFileSync('git',['show',sha+':src/systems/'+name],{cwd:root,encoding:'utf8'});
 return [compile(original,name),compile(src,name)];
}
class Graphics {
 constructor(x=0,y=0){this.x=x;this.y=y;this.visible=true;this.clearCount=0;this.commands=[];this.style=[];}
 clear(){this.clearCount++;this.commands=[];return this;}
 setDepth(x){this.depth=x;return this;}setVisible(x){this.visible=x;return this;}
 setName(x){this.name=x;return this;}setPosition(x,y){this.x=x;this.y=y;return this;}
 destroy(){this.destroyed=true;return this;}setAlpha(x){this.alpha=x;return this;}
 lineStyle(...x){this.style=x;this.commands.push(['lineStyle',...x]);return this;}
 fillStyle(...x){this.style=x;this.commands.push(['fillStyle',...x]);return this;}
 fillRoundedRect(x,y,w,h,r){this.commands.push(['fillRect',x,y,w,h,r]);return this;}
 strokeRoundedRect(x,y,w,h,r){this.commands.push(['strokeRect',x,y,w,h,r]);return this;}
 strokeCircle(x,y,r){this.commands.push(['circle',x,y,r]);return this;}
 beginPath(){this.commands.push(['begin']);return this;}
 moveTo(x,y){this.commands.push(['move',x,y]);return this;}
 lineTo(x,y){this.commands.push(['line',x,y]);return this;}
 strokePath(){this.commands.push(['stroke']);return this;}
 arc(x,y,r,a,b,ccw){this.commands.push(['arc',x,y,r,a,b,ccw]);return this;}
}
class Image {
 constructor(x,y){this.x=x;this.y=y;this.scaleX=1;this.visible=true;}
 setDepth(x){this.depth=x;return this;}setScale(x){this.scaleX=x;return this;}
 setAlpha(x){this.alpha=x;return this;}setVisible(x){this.visible=x;return this;}
 setBlendMode(x){this.blendMode=x;return this;}setPosition(x,y){this.x=x;this.y=y;return this;}
 setRotation(x){this.rotation=x;return this;}setTint(x){this.tint=x;return this;}
 clearTint(){this.tint=0xffffff;return this;}setStrokeStyle(){return this;}
 destroy(){this.destroyed=true;return this;}
}
const norm=x=>typeof x==='number'?Math.round(x*10000)/10000:x;
function rendered(g){
 return {visible:g.visible,commands:g.commands.map(c=>{
   if(['fillRect','strokeRect'].includes(c[0]))return [c[0],norm(c[1]+g.x),norm(c[2]+g.y),...c.slice(3).map(norm)];
   return c.map((v,i)=>i>0 && ['circle','move','line','arc'].includes(c[0]) && (i===1||i===2)?norm(v+(i===1?g.x:g.y)):norm(v));
 })};
}
function overlayScenario(Overlay){
 const scene={add:{graphics:()=>new Graphics()}};
 const overlay=new Overlay(scene,10);
 const enemies=Array.from({length:10},(_,i)=>({active:true,hp:100,maxHp:100,isBoss:false,isElite:i===0,spawnSerial:i+1,x:100+i*30,y:90+i*20,radius:12+i%3}));
 for(const e of enemies)overlay.show(e,0);
 const sample=[];
 for(let frame=1;frame<=58;frame++){
   for(const e of enemies){e.x+=2;e.y+=1;if(frame===22&&e===enemies[0])e.hp=65;if(frame===35&&e===enemies[1])e.radius+=2;}
   if(frame===41){enemies[2].spawnSerial+=100;overlay.show(enemies[2],frame*16);}
   overlay.update(frame*16);
   sample.push(overlay.slots.map(s=>rendered(s.graphics)));
 }
 const clears=overlay.slots.reduce((n,s)=>n+s.graphics.clearCount,0);
 overlay.clear();
 assert.ok(overlay.slots.every(s=>s.graphics.visible===false));
 return {sample,clears};
}
const [OldOverlay,NewOverlay]=load('EnemyHealthOverlay.ts').map(m=>m.EnemyHealthOverlay);
const oldBars=overlayScenario(OldOverlay),newBars=overlayScenario(NewOverlay);
assert.deepEqual(newBars.sample,oldBars.sample,'enemy bars must match exact global geometry after movement, radius change and pool reuse');
assert.ok(newBars.clears<oldBars.clears/5,'health redraw savings must be measurable');
function newScene(level){
 const graphics=[];
 const scene={time:{now:0},cameras:{main:{width:360,height:640}},registry:{get:k=>k==='runtimeQuality'?{level}:undefined},
 add:{image:(x,y)=>new Image(x,y),graphics:()=>{const g=new Graphics();graphics.push(g);return g;},arc:(x,y)=>new Image(x,y)},
 tweens:{add:()=>{},killTweensOf:()=>{}}};
 return {scene,graphics};
}
function hostScenario(Host,level){
 const ctx=newScene(level),player={x:0,y:0},lyses=[],interactions=[];
 let seed=13;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const host=new Host(ctx.scene,player,e=>lyses.push(e),()=>({infectionRadius:58,infectionMs:1250,rna:4,lysisRadius:150,lysisDamage:26}),rand,e=>interactions.push(e));
 const state=[],visuals=[];
 for(let frame=0;frame<120;frame++){
   const t=7000+frame*16;
   ctx.scene.time.now=t;
   if(frame===4){const cell=host.cells.find(c=>c.active);player.x=cell.image.x;player.y=cell.image.y;}
   if(frame===26){player.x=0;player.y=0;}
   if(frame===40){const cell=host.cells.find(c=>c.active);player.x=cell.image.x;player.y=cell.image.y;}
   host.update(t,16,t);
   state.push(host.snapshot());
   visuals.push(ctx.graphics.map(g=>JSON.stringify({visible:g.visible,commands:g.commands})));
 }
 const clears=ctx.graphics.reduce((n,g)=>n+g.clearCount,0);
 const expected={state,lyses,interactions};
 host.resetStage();
 const reset=host.snapshot();
 host.restore(reset);
 const restored=host.snapshot();
 host.destroy();
 return {expected,clears,reset,restored,visuals};
}
const [OldHost,NewHost]=load('HostCellSystem.ts').map(m=>m.HostCellSystem);
const baseFull=hostScenario(OldHost,'full'),afterFull=hostScenario(NewHost,'full');
const afterLow=hostScenario(NewHost,'low');
assert.deepEqual(afterFull.expected,baseFull.expected,'full-tier host gameplay must exactly match baseline');
assert.deepEqual(afterFull.visuals,baseFull.visuals,'full-tier host ring commands and visibility must exactly match baseline each frame');
assert.deepEqual(afterLow.expected,baseFull.expected,'low-tier host gameplay must exactly match baseline');
assert.deepEqual(afterFull.reset,baseFull.reset);
assert.deepEqual(afterLow.restored,baseFull.restored);
assert.ok(afterLow.clears<afterFull.clears,'low-tier cosmetic ring redraw count must fall');
assert.ok(afterFull.clears===baseFull.clears,'full-tier redraw count must be unchanged');
function lysisAndReuse(Host,level){
 const ctx=newScene(level),player={x:0,y:0},lyses=[],interactions=[];
 const host=new Host(ctx.scene,player,e=>lyses.push(e),()=>({infectionRadius:58,infectionMs:1250,rna:4,lysisRadius:150,lysisDamage:26}),()=>0.5,e=>interactions.push(e));
 ctx.scene.time.now=7000;host.update(7000,16,7000);
 const first=host.cells.find(c=>c.active);
 const oldId=first.interactionId;
 player.x=first.image.x;player.y=first.image.y;
 first.infection=0.995;
 ctx.scene.time.now=7008;host.update(7008,16,7008);
 assert.equal(lyses.length,1,'lysis not emitted');assert.equal(lyses[0].interactionId,oldId);
 assert.equal(first.active,false,'lysed slot remains active');
 const stateAfterLysis=host.snapshot();
 assert.equal(host.ensureOpportunityNearPlayer(),true,'opportunity not restored');
 const newCell=host.cells.find(c=>c.active);
 assert.notEqual(newCell.interactionId,oldId,'reuse retained previous interaction id');
 const next=host.snapshot();
 host.resetStage();host.restore(next);
 ctx.scene.time.now=7024;host.update(7024,16,7024);
 const restored=host.snapshot();
 return {lyses,interactions,stateAfterLysis,restored};
}
for(const quality of ['full','low']){
 assert.deepEqual(lysisAndReuse(NewHost,quality),lysisAndReuse(OldHost,quality),'lysis, interaction IDs and pool reset parity at '+quality);
}
// Low-quality ring must redraw immediately on inside/near change, quality
// escalation, and snapshot restore, even inside its nominal 33ms interval.
{
 const ctx=newScene('low'),player={x:0,y:0};
 let level='low';ctx.scene.registry.get=()=>({level});
 const host=new NewHost(ctx.scene,player,()=>{},undefined,()=>0.5);
 ctx.scene.time.now=7000;host.update(7000,16,7000);
 const cell=host.cells.find(c=>c.active);
 const before=cell.ring.clearCount;
 player.x=cell.image.x;player.y=cell.image.y;
 ctx.scene.time.now=7008;host.update(7008,8,7008);
 assert.equal(cell.ring.clearCount,before+1,'enter must redraw immediately at low tier');
 const prevInfection=cell.infection;
 ctx.scene.time.now=7012;host.update(7012,4,7012);
 assert.ok(cell.infection>prevInfection,'infection must progress every frame');
 assert.equal(cell.ring.clearCount,before+2,'changing infection arc must redraw immediately at low tier');
 level='full';ctx.scene.time.now=7016;host.update(7016,8,7016);
 assert.equal(cell.ring.clearCount,before+3,'quality escalation must redraw immediately');
 const snap=host.snapshot();
 host.resetStage();host.restore(snap);
 const afterRestore=cell.ring.clearCount;
 level='low';ctx.scene.time.now=7024;host.update(7024,8,7024);
 assert.equal(cell.ring.clearCount,afterRestore+1,'restore must redraw immediately');
}
function sixCellStress(Host,level){
 const ctx=newScene(level),player={x:0,y:0};
 let seed=7;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 const host=new Host(ctx.scene,player,()=>{},undefined,rand);
 for(let i=0;i<6;i++)host.spawnNearPlayer();
 assert.equal(host.cells.filter(c=>c.active).length,6);
 const snapshots=[],visuals=[];
 for(let i=0;i<90;i++){
  const t=1000+i*16;ctx.scene.time.now=t;host.update(t,16,0);
  snapshots.push(host.snapshot());
  visuals.push(ctx.graphics.map(g=>JSON.stringify({visible:g.visible,commands:g.commands})));
 }
 return {snapshots,visuals,clears:ctx.graphics.reduce((n,g)=>n+g.clearCount,0)};
}
const sixOriginal=sixCellStress(OldHost,'full');
const sixFull=sixCellStress(NewHost,'full');
const sixLow=sixCellStress(NewHost,'low');
assert.deepEqual(sixFull.snapshots,sixOriginal.snapshots,'six-cell full gameplay parity');
assert.deepEqual(sixLow.snapshots,sixOriginal.snapshots,'six-cell low gameplay parity');
assert.deepEqual(sixFull.visuals,sixOriginal.visuals,'six-cell full ring geometry parity');
assert.ok(sixLow.clears < sixOriginal.clears*0.7,'six-cell low-tier draw-rate reduction');
console.log('PERF-03: six active cells, 90 frames, ring clears full '+sixOriginal.clears+' -> low '+sixLow.clears+' (snapshots/events unchanged)');
Module._load=savedLoad;
console.log('PERF-03: bar geometry parity PASS (58 frames, 10 pooled slots), clears '+oldBars.clears+' -> '+newBars.clears);
console.log('PERF-03: host snapshots/events/restore parity PASS (120 frames), ring clears full '+afterFull.clears+' low '+afterLow.clears+' baseline '+baseFull.clears);
