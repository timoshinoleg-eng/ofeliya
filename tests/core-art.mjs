import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
const cache = new Map();
class Display {
 constructor(scene,x=0,y=0,key) { Object.assign(this,{scene,x,y,active:true,visible:true,scaleX:1,scaleY:1,rotation:0,alpha:1}); if(key)this.setTexture(key); }
 setOrigin(){return this;} setSize(w,h){this.width=w;this.height=h;return this;} setFillStyle(){return this;}
 setTexture(key) { this.texture={key}; const d=this.scene.textures.get(key); this.width=d.width; this.height=d.height; return this; }
 setScale(x,y=x){this.scaleX=x;this.scaleY=y;return this;} get displayWidth(){return this.width*this.scaleX;} get displayHeight(){return this.height*this.scaleY;}
 setPosition(x,y){this.x=x;this.y=y;return this;} setRotation(v){this.rotation=v;return this;} setAlpha(v){this.alpha=v;return this;}
 setVisible(v){this.visible=v;return this;} setTint(){return this;} setTintFill(){return this;} clearTint(){return this;} setDepth(){return this;} setStrokeStyle(){return this;} setBlendMode(){return this;} setScrollFactor(){return this;}
 clear(){return this;} preUpdate(){} destroy(){} enableBody(_,x,y){this.active=true;return this.setPosition(x,y);} disableBody(){this.active=false;return this;}
}
const display = () => new Proxy(Display.prototype,{get(t,k){return t[k]??function(){return this;};}});
class Graphics extends Display{} Object.setPrototypeOf(Graphics.prototype,display());
const phaser={ Scene:class {},Physics:{Arcade:{Sprite:Display}},BlendModes:{ADD:1,NORMAL:0},Math:{Clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),FloatBetween:(a,b)=>(a+b)/2,Between:(a,b)=>Math.floor((a+b)/2)}};
function load(path){path=new URL(path,`file://${process.cwd()}/`).pathname;if(cache.has(path))return cache.get(path);const m={exports:{}};cache.set(path,m.exports);const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;new Function('require','module','exports',source)(n=>n==='phaser'?phaser:n.endsWith('/StartupTrace')?{StartupTrace:{mark(){}}}:load(new URL(n+'.ts','file://'+path).pathname),m,m.exports);cache.set(path,m.exports);return m.exports;}
// Phaser raster/physics are I/O adapters; production TS and source method bodies execute unchanged.
// Root's actual Phaser WebGL/Canvas baseline protects the engine's body rounding and centers.
const logical={'virus-player':[56,56],'immune-antibody':[38,38],'immune-tcell':[44,40],'immune-macrophage':[62,62],'immune-prime':[94,94],'cardiac-titan':[108,108],'host-cell-shadow':[112,112]};
function fixture(raw=[]){const textures=new Map(), removed=[], objects=[], tweens=[];for(const key of raw) textures.set('raw-art-'+key,{width:1024,height:1024,getSourceImage:()=>({art:key})});
 const scene={textures:{exists:k=>textures.has(k),get:k=>textures.get(k),remove:k=>{assert.ok(textures.get(k.slice(8))?.refreshed,'raw removal must follow canonical refresh');removed.push(k);textures.delete(k);},createCanvas(k,w,h){assert.ok(!textures.has(k),'must not duplicate '+k);const ops=[];const ctx=new Proxy({scale:(...a)=>ops.push(['scale',...a]),drawImage:(...a)=>ops.push(['drawImage',...a]),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})},{get:(t,k)=>t[k]??(()=>{})});const texture={width:w,height:h,ops,getContext:()=>ctx,refresh(){this.refreshed=true;},add(){}};textures.set(k,texture);return texture;}},add:{existing(){},tileSprite(x,y,w,h,k){const o=new Display(scene,x,y,k);o.width=w;o.height=h;objects.push(o);return o;},rectangle(x,y,w,h){const o=new Display(scene,x,y);o.width=w;o.height=h;objects.push(o);return o;},image(x,y,k){const o=new Display(scene,x,y,k);objects.push(o);return o;},graphics(){const o=new Graphics(scene);objects.push(o);return o;},circle(){return new Display(scene);},arc(){const o=new Display(scene);objects.push(o);return o;}},physics:{add:{existing(o){o.body={setCircle(r,x,y){Object.assign(this,{radius:r,offset:{x,y}});},setVelocity(){},velocity:{x:0,y:0}};}}},time:{now:0},cameras:{main:{width:390,height:844,scrollX:0,scrollY:0}},tweens:{add:c=>{tweens.push(c);return c;},killTweensOf(){}},scale:{width:390,height:844},events:{once(){},off(){}}};return {scene,textures,removed,objects,tweens};}
let passed=0;
const failures=[];function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failures.push(name);console.error('FAIL '+name+': '+e.message);}}
const bake=f=>load('src/game/StrainZeroTextures.ts').ensureStrainZeroTextures(f.scene);
test('all seven art/fallback backings are bounded 4x including non-square T-cell; raw removed after refresh',()=>{for(const raw of [[],Object.keys(logical),['virus-player','immune-tcell']]){const f=fixture(raw);bake(f);for(const[k,[w,h]]of Object.entries(logical)){const t=f.textures.get(k);assert.deepEqual([t.width,t.height],[w*4,h*4]);assert.deepEqual(t.ops[0],['scale',4,4]);const op=t.ops.find(o=>o[0]==='drawImage');if(raw.includes(k))assert.deepEqual(op.slice(2),[0,0,w,h]);else assert.equal(op,undefined);assert.ok(t.refreshed);}assert.deepEqual(f.removed.sort(),raw.map(k=>'raw-art-'+k).sort());}});
test('repeated bake plus partial canonical presence still completes all required keys without duplication',()=>{const f=fixture();f.textures.set('virus-player',{width:224,height:224});bake(f);const count=f.textures.size;for (const key of [...Object.keys(logical),'viral-particle','rna-fragment','erythrocyte','host-cell-infection','membrane-fragment','bio-spark','combat-particles','mutation-prism','mutation-halo','mutation-singularity','blood-plasma','heart-plasma','cardiac-fiber']) assert.ok(f.textures.has(key), 'required texture '+key);bake(f);assert.equal(f.textures.size,count);});
test('projectile RNA atmosphere and combat atlas source geometry remains unchanged',()=>{const f=fixture();bake(f);for(const [k,w,h]of [['viral-particle',22,14],['rna-fragment',22,28],['combat-particles',200,40],['blood-plasma',256,256],['heart-plasma',256,256],['cardiac-fiber',256,256],['host-cell-infection',112,112]])assert.deepEqual([f.textures.get(k).width,f.textures.get(k).height],[w,h]);});
test('boot preload uses seven distinct raw keys with per-image finite XHR timeout',()=>{const {BootScene}=load('src/scenes/BootScene.ts'),boot=new BootScene(),requests=[];boot.textures={exists:()=>false};boot.load={image:(...args)=>requests.push(args)};boot.preload();assert.equal(requests.length,7);for(const [k,path,config]of requests){assert.ok(k.startsWith('raw-art-'));assert.equal(path,'art/'+k.slice(8)+'.webp');assert.equal(config.timeout,1800);}assert.equal(new Set(requests.map(r=>r[0])).size,7);});
test('boot preload skips only individually present canonical textures', () => {
 const { BootScene } = load('src/scenes/BootScene.ts'), boot = new BootScene(), requests = [];
 const present = new Set(['virus-player', 'immune-tcell']);
 boot.textures = { exists: key => present.has(key) };
 boot.load = { image: (...args) => requests.push(args) };
 boot.preload();
 assert.deepEqual(requests.map(([key]) => key), Object.keys(logical).filter(key => !present.has(key)).map(key => 'raw-art-' + key));
 for (const key of Object.keys(logical)) present.add(key);
 requests.length = 0; boot.preload(); assert.deepEqual(requests, []);
});
test('optional art consumes one timeout window without retry or Android batching', () => {
 const { BootScene } = load('src/scenes/BootScene.ts');
 for (const parallel of [6, 32]) {
  const boot = new BootScene(), requests = [];
  boot.textures = { exists: () => false };
  // File captures loader retry policy at queue time, so assert before the first image call.
  boot.load = { maxRetries: 2, maxParallelDownloads: parallel, image: (...args) => {
   assert.equal(boot.load.maxRetries, 0);
   assert.equal(boot.load.maxParallelDownloads, Math.max(parallel, 7));
   requests.push(args);
  } };
  boot.preload(); assert.equal(requests.length, 7);
  assert.equal(boot.load.maxRetries, 2, 'unrelated future loads retain retry policy');
 }
});
test('boot create bakes missing or partly loaded art before removing splash and starting Menu', () => {
 const { BootScene } = load('src/scenes/BootScene.ts');
 const priorDocument = globalThis.document;
 try {
  for (const raw of [[], ['virus-player', 'immune-tcell']]) {
   const f = fixture(raw), boot = Object.assign(new BootScene(), f.scene), events = [];
   // Legacy graphics texture generation is a separate adapter boundary; execute the actual
   // Boot create method and production core bake after optional loader completion/failure.
   boot.makeTextures = () => events.push('legacy');
   globalThis.document = { getElementById: id => {
    assert.equal(id, 'splash');
    return { remove: () => {
     for (const key of Object.keys(logical)) assert.ok(f.textures.get(key)?.refreshed, key + ' must be ready before splash removal');
     events.push('splash');
    } };
   } };
   boot.scene = { start: key => { assert.equal(key, 'Menu'); events.push('menu'); } };
   boot.create();
   assert.deepEqual(events, ['legacy', 'splash', 'menu']);
   assert.deepEqual(f.removed.sort(), raw.map(key => 'raw-art-' + key).sort());
  }
 } finally {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
 }
});
test('packaged generated asset provenance covers exactly the seven core keys and current bytes', () => {
 const provenance = JSON.parse(readFileSync('public/art/provenance.json', 'utf8'));
 assert.deepEqual(provenance.assets.map(asset => asset.key).sort(), Object.keys(logical).sort());
 for (const asset of provenance.assets) {
  assert.equal(asset.file, asset.key + '.webp');
  assert.ok(asset.source, 'source identifier required');
  const bytes = readFileSync('public/art/' + asset.file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
 }
});
test('central metrics preserve unknown texture factor 1',()=>{const m=load('src/game/ArtMetrics.ts');assert.equal(m.artSourceFactor('unknown'),1);for(const k of Object.keys(logical))assert.equal(m.artSourceFactor(k),4);});
test('player constructor/breathing world display and centered circle match original geometry',()=>{const f=fixture();bake(f);const {Player}=load('src/game/Player.ts');const p=new Player(f.scene,200,300);assert.equal(p.displayWidth,56);assert.equal(p.body.radius*p.scaleX,13);for(const t of [0,200,600,1200]){p.preUpdate(t,0);const breathe=.9+Math.sin(t*.0042)*.028;assert.ok(Math.abs(p.displayWidth-56*breathe)<1e-10);assert.ok(Math.abs(p.body.radius*p.scaleX-13*breathe)<1e-10);assert.equal((p.body.offset.x+p.body.radius-p.width/2)*p.scaleX,0);assert.equal((p.body.offset.y+p.body.radius-p.height/2)*p.scaleY,0);}});
test('enemy activation, role animation and recycling retain world geometry across all seven roles',()=>{const f=fixture();bake(f);const {Enemy}=load('src/game/Enemy.ts'),{ENEMY_DEFS,ELITE}=load('src/game/config.ts');const p={x:200,y:300,body:{velocity:{x:0,y:0}}};const gs={player:p,enemies:{countActive:()=>1},getCombatVisualDensity:()=>0,getEnemyPressureMultiplier:()=>1,runTimeMs:0};const e=new Enemy(f.scene,0,0);for(const[kind,elite,key]of [['swarm',false,'immune-antibody'],['swarm',true,'immune-antibody'],['runner',false,'immune-tcell'],['runner',true,'immune-tcell'],['brute',false,'immune-macrophage'],['brute',true,'immune-macrophage'],['boss',false,'immune-prime'],['boss',false,'cardiac-titan']]){e.activate(gs,kind,800,900,{elite,hpScale:1,dmgScale:1,textureKey:key,bossBehavior:key==='cardiac-titan'?'heartbeat-pulse':'pressure-wave',heartbeatMs:820});const def=ENEMY_DEFS[kind],scale=def.scale*(elite?ELITE.scale:1);assert.equal(e.radius,def.radius*scale);assert.ok(Math.abs(e.displayWidth-logical[key][0]*scale)<1e-9);assert.ok(Math.abs(e.body.radius*e.scaleX-e.radius)<1e-9);e.nextRoleActionAt=e.nextBossAttackAt=Infinity;for(const t of [200,600,1200]){e.preUpdate(t,0);assert.equal((e.body.offset.x+e.body.radius-e.width/2)*e.scaleX,0);assert.equal((e.body.offset.y+e.body.radius-e.height/2)*e.scaleY,0);assert.ok(e.displayWidth<logical[key][0]*scale*1.3);}e.deactivateForStageReset();}});
test('host pool lifecycle infection checkpoint and rupture preserve shadow/overlay world sizes and interaction radius',()=>{const f=fixture();bake(f);const {HostCellSystem}=load('src/systems/HostCellSystem.ts');const events=[],lysis=[];const p={x:200,y:300};const host=new HostCellSystem(f.scene,p,e=>lysis.push(e),()=>({infectionRadius:58,infectionMs:1250,rna:4,lysisRadius:150,lysisDamage:26}),()=>0,e=>events.push(e));const c=host.cells[0];assert.equal(c.image.displayWidth,112*.78);host.spawnNearPlayer();assert.equal(c.image.displayWidth,112*.68);assert.equal(f.tweens.at(-1).scale,.78/4);c.infection=.68;c.phase=0;host.update(600,0,10000);const scale=(.78+.068)*(1+Math.sin(600*.003)*.025);assert.ok(Math.abs(c.image.displayWidth-112*scale)<1e-9);assert.ok(Math.abs(c.infectionOverlay.displayWidth-112*scale*(1+.68*.025))<1e-9);host.restore(host.snapshot());assert.equal(c.image.displayWidth,112*(.78+.068));host.update(600,0,10000);const before=c.image.displayWidth;host.lyse(c);assert.ok(f.objects.some(o=>o.texture?.key==='host-cell-infection'&&Math.abs(o.displayWidth-before)<1e-9));assert.equal(lysis[0].radius,150);host.resetStage();assert.equal(c.image.displayWidth,112*.78);assert.equal(c.infectionOverlay.displayWidth,112*.78);});

// Execute source AST bodies directly: these are production method/snippets, not duplicate scale recipes.
function sceneSource(path) { return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true); }
function methodBody(path, name) {
 const source = sceneSource(path), declaration = source.statements.find(ts.isClassDeclaration);
 const method = declaration.members.find(m => m.name?.getText(source) === name);
 assert.ok(method?.body, `production method ${name} must exist`);
 return method.body.getText(source).slice(1, -1);
}
test('Menu host and hero keep the original large portraits and tween endpoints', () => {
 const { artScale } = load('src/game/ArtMetrics.ts');
 const source = readFileSync('src/scenes/MenuScene.ts', 'utf8');
 const body = source.slice(source.indexOf('    const host ='), source.indexOf('    const titleY ='));
 for (const H of [568, 844]) {
  const f = fixture(); bake(f);
  new Function('W', 'H', 'artScale', body).call(f.scene, 390, H, artScale);
  const [host, hero] = f.objects;
  const hostScale = H < 650 ? 1.1 : 1.4, heroScale = H < 650 ? 1.8 : 2.15;
  assert.equal(host.displayWidth, 112 * hostScale);
  assert.equal(hero.displayWidth, 56 * heroScale);
  assert.ok(Math.abs(f.tweens[0].scale * host.width - 112 * hostScale * 1.07) < 1e-9);
  assert.ok(Math.abs(f.tweens[2].scale * hero.width - 56 * heroScale * 1.06) < 1e-9);
 }
});
test('Game trail initial/fade endpoints and organ reset retain their world footprint', () => {
 const { artScale } = load('src/game/ArtMetrics.ts');
 const { COLORS, JUICE } = load('src/game/config.ts');
 const f = fixture(); bake(f);
 const trail = f.scene.add.image(0, 0, 'virus-player');
 const game = { ...f.scene, player: { x: 100, y: 200 }, trail: [trail], trailCursor: 0,
  runState: { hasEvolution: () => false } };
 new Function('artScale', 'COLORS', 'JUICE', methodBody('src/scenes/GameScene.ts', 'spawnTrail')).call(game, artScale, COLORS, JUICE);
 assert.equal(trail.displayWidth, 56); assert.equal(trail.displayHeight, 56);
 assert.equal(f.tweens[0].scale * trail.width, 56 * .62);
 f.tweens[0].onComplete(); assert.equal(trail.visible, false);
 const { Player } = load('src/game/Player.ts'); game.player = new Player(f.scene, 1, 2);
 const source = sceneSource('src/scenes/GameScene.ts'); let reset;
 function visit(n) { if (ts.isExpressionStatement(n) && n.getText(source).startsWith('this.player.clearTint()')) reset = n.getText(source); ts.forEachChild(n, visit); }
 visit(source); assert.ok(reset);
 new Function('artScale', 'centerX', 'centerY', reset).call(game, artScale, 400, 500);
 assert.equal(game.player.displayWidth, 56 * .9); assert.equal(game.player.x, 400); assert.equal(game.player.y, 500);
});
test('ambient hosts keep world dimensions while atmosphere update and quality preserve pools', () => {
 const f = fixture(); bake(f);
 // Legacy spark is created by Boot; this adapter supplies only that unrelated texture boundary.
 f.textures.set('spark', { width: 8, height: 8 });
 const { AtmosphereSystem } = load('src/systems/AtmosphereSystem.ts');
 const { BLOODSTREAM_STAGE, HEART_STAGE } = load('src/game/StageDefinitions.ts');
 const atmosphere = new AtmosphereSystem(f.scene);
 const hosts = f.objects.filter(o => o.texture?.key === 'host-cell-shadow');
 assert.ok(hosts.length > 0);
 const widths = hosts.map(o => o.displayWidth);
 assert.ok(widths.every(w => w >= 112 * 1.2 && w <= 112 * 2.15));
 atmosphere.setStage(HEART_STAGE); atmosphere.setRuntimeQualityScale(.65);
 atmosphere.update(600, 16, 600, HEART_STAGE.durationMs);
 atmosphere.setStage(BLOODSTREAM_STAGE); atmosphere.setRuntimeQualityScale(1);
 assert.deepEqual(hosts.map(o => o.displayWidth), widths);
 atmosphere.destroy();
});
test('runner windup/burst/recovery and brute wobble match the original asymmetric body transforms', () => {
 const f = fixture(); bake(f);
 const { Enemy } = load('src/game/Enemy.ts'), { ENEMY_DEFS } = load('src/game/config.ts');
 const e = new Enemy(f.scene, 0, 0), gs = { player: { x: 200, y: 300, body: { velocity: { x: 0, y: 0 } } },
  getCombatVisualDensity: () => 0, getEnemyPressureMultiplier: () => 1 };
 for (const kind of ['runner', 'brute']) {
  const key = ENEMY_DEFS[kind].tex;
  for (const phase of ['pursuit', 'windup', 'burst', 'recovery']) {
   e.activate(gs, kind, 800, 900, { elite: false, hpScale: 1, dmgScale: 1 });
   e.rolePhase = phase; e.rolePhaseUntil = e.nextRoleActionAt = Infinity;
   const time = 600; e.preUpdate(time, 0);
   const charge = phase === 'windup' ? .9 + Math.sin(time * .028) * .06 : phase === 'burst' ? 1.12 : 1 + Math.sin(time * .012 + e.y * .01) * .035;
   const wobble = 1 + Math.sin(time * .003 + e.x * .008) * .025 + (phase === 'windup' ? Math.sin(time * .022) * .055 : 0);
   const sx = kind === 'runner' ? charge : wobble, sy = kind === 'runner' ? 2 - charge : 1 / wobble;
   assert.ok(Math.abs(e.displayWidth - logical[key][0] * sx) < 1e-9);
   assert.ok(Math.abs(e.displayHeight - logical[key][1] * sy) < 1e-9);
   assert.ok(Math.abs(e.body.radius * e.scaleX - ENEMY_DEFS[kind].radius * sx) < 1e-9);
   assert.ok(Math.abs(e.body.radius * e.scaleY - ENEMY_DEFS[kind].radius * sy) < 1e-9);
  }
 }
});
if(failures.length)process.exitCode=1;else console.log(`core art contracts: ${passed}/${passed}`);
