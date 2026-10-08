const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const BASE=process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5188/';
(async()=>{
const dir=process.env.OFELIYA_DENSITY_DIR||path.resolve('artifacts/density-experiment');fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const rows=[];
for(const renderer of ['webgl','canvas']){
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
 await context.addInitScript(()=>{localStorage.setItem('ofeliya_save_v1',JSON.stringify({muted:true,runs:1}));localStorage.setItem('ofeliya_performance_tier','full');});
 await context.route('https://st.max.ru/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(BASE+'?renderer='+renderer,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'),null,{timeout:20000});
 const geometry=()=>page.evaluate(()=>{const game=window.__game;const flatten=(objects)=>objects.flatMap(o=>{let own=[];if(o.visible&&o.alpha>0){if(o.type==='Text')own.push({text:o.text,bounds:o.getBounds(),resolution:o.style.resolution});if(o.type==='Container')own.push(...flatten(o.list));}return own;});return {logical:[game.scale.width,game.scale.height],backing:[game.canvas.width,game.canvas.height],scale:[game.scale.displayScale.x,game.scale.displayScale.y],scenes:game.scene.getScenes(true).map(s=>({key:s.scene.key,camera:[s.cameras.main.x,s.cameras.main.y,s.cameras.main.width,s.cameras.main.height,s.cameras.main.zoom],texts:flatten(s.children.list)}))};});
 const render=()=>page.evaluate(()=>{const g=window.__game;g.renderer.preRender();g.scene.render(g.renderer);g.renderer.postRender();});
 await page.evaluate(()=>window.__game.loop.stop());await render();const menu1=await geometry();await page.locator('#game canvas').screenshot({path:path.join(dir,renderer+'-menu-1x.png')});
 await page.evaluate(async()=>{const m=await import('/src/systems/RenderDensityExperiment.ts');window.__densityDraft=m.installRenderDensityExperiment(window.__game,2);});await render();const menu2=await geometry();await page.locator('#game canvas').screenshot({path:path.join(dir,renderer+'-menu-2x.png')});
 await page.evaluate(()=>{window.__densityDraft.destroy();const g=window.__game;g.registry.set('runSeedOverride','hidpi-proof');g.scene.getScene('Game').update=()=>{};g.scene.getScene('Menu').scene.start('Game');g.loop.start(g.step.bind(g));});
 await page.waitForFunction(()=>window.__game.scene.isActive('Game')&&window.__game.scene.isActive('UI'));
 const fixture=await page.evaluate(()=>{
 const g=window.__game,gs=g.scene.getScene('Game'),ui=g.scene.getScene('UI');gs.awaitingChoice=false;gs.pendingChoices=[];gs.queuedLevels=0;ui.dismissProgressionForStageBoundary();gs.physics.world.pause();
 for(const e of gs.enemies.getChildren())if(e.active)e.deactivateForStageReset();
 for(let i=0;i<200;i++){const a=i/200*Math.PI*2,r=86+(i%8)*27;gs.spawnEnemy(['swarm','runner','brute'][i%3],gs.player.x+Math.cos(a)*r,gs.player.y+Math.sin(a)*r,i===7);}
 const boss=gs.enemies.get(gs.player.x+90,gs.player.y-100);boss.activate(gs,'boss',gs.player.x+90,gs.player.y-100,{elite:false,hpScale:1,dmgScale:1,speedScale:1,bossBehavior:'pressure-wave'});gs.wave.boss=boss;
 for(const o of gs.children.list)if(o.active&&typeof o.preUpdate==='function'){o.preUpdate(1000,0);o.preUpdate=()=>{};}
 gs.tweens.pauseAll();g.loop.stop();gs.registry.set('run',gs.snapshot());ui.update(1000,0);return {enemies:gs.enemies.getChildren().filter(e=>e.active).length,uiBlocked:ui.uiBlocked,boss:boss.hp,bossBarVisible:ui.bossBack.visible,bossFillCommands:ui.bossFill.commandBuffer.length};});
 await render();const game1=await geometry();await page.locator('#game canvas').screenshot({path:path.join(dir,renderer+'-game-1x.png')});
 await page.evaluate(async()=>{const m=await import('/src/systems/RenderDensityExperiment.ts');window.__densityDraft=m.installRenderDensityExperiment(window.__game,2);});await render();const game2=await geometry();await page.locator('#game canvas').screenshot({path:path.join(dir,renderer+'-game-2x.png')});
 await page.evaluate(()=>{const g=window.__game;g.scene.getScene('UI').add.rectangle(100,200,30,30,0xff00ff).setInteractive().setDepth(1000).on('pointerdown',p=>window.__densityHit={x:p.x,y:p.y});g.loop.start(g.step.bind(g));});
 await page.mouse.click(100,200);await page.waitForTimeout(100);
 const rafTimes=await page.evaluate(()=>new Promise(resolve=>{const gaps=[];let last=performance.now();const step=now=>{gaps.push(now-last);last=now;if(gaps.length===90)resolve(gaps);else requestAnimationFrame(step)};requestAnimationFrame(step)}));
 const input=await page.evaluate(()=>{const g=window.__game;g.loop.stop();return{css:[g.scale.transformX(100),g.scale.transformY(200)],hit:window.__densityHit};});
 if(!input.hit||input.hit.x!==100||input.hit.y!==200)throw Error(renderer+' real input target failed '+JSON.stringify(input));
 await page.setViewportSize({width:390,height:800});
 await page.evaluate(async()=>{window.dispatchEvent(new Event('resize'));await window.__viewportManager.sync();});
 await page.waitForFunction(()=>window.__game.scale.width===390&&window.__game.scale.height===800);
 await page.evaluate(()=>{const g=window.__game;g.registry.set('runtimeQuality',{level:'full'});g.scale.resize(390,800);g.scale.resize(390,800);});await render();const resized=await geometry();await page.locator('#game canvas').screenshot({path:path.join(dir,renderer+'-resize-2x.png')});
 const simplify=o=>({logical:o.logical,scale:o.scale,scenes:o.scenes});for(const [name,a,b]of[['menu',menu1,menu2],['game',game1,game2]])if(JSON.stringify(simplify(a))!==JSON.stringify(simplify(b)))throw Error(renderer+' '+name+' logical geometry changed');
 if(game2.backing[0]!==780||game2.backing[1]!==1688)throw Error('paired density2 backing failed '+JSON.stringify(game2.backing));
 if(resized.backing[0]!==780||resized.backing[1]!==1600)throw Error('physical resize failed '+JSON.stringify(resized));
 await page.evaluate(()=>window.__game.registry.set('runtimeQuality',{level:'low'}));
 const reduced=await geometry();if(reduced.backing[0]!==390||reduced.backing[1]!==800)throw Error('quality fallback failed');
 await page.evaluate(()=>window.__game.registry.set('runtimeQuality',{level:'full'}));
 const full=await geometry();if(full.backing[0]!==780)throw Error('quality upgrade failed');
 await page.evaluate(()=>window.__game.registry.set('performanceTier','reduced'));
 const staticReduced=await geometry();if(staticReduced.backing[0]!==390)throw Error('static reduced fallback failed');
 await page.evaluate(()=>{window.__game.registry.set('performanceTier','full');window.__game.scale.resize(1100,1000);});
 const capped=await geometry();if(capped.backing[0]!==capped.logical[0]||capped.backing[1]!==capped.logical[1]||capped.logical[0]*capped.logical[1]*4<=4000000)throw Error('4M pixel cap failed '+JSON.stringify({logical:capped.logical,backing:capped.backing}));
 if(errors.length)throw Error('page errors '+errors.join('\n'));
 rows.push({renderer,fixture,menu1,menu2,game1,game2,input,resized,reduced,full,staticReduced,capped,rafTimes,note:'SwiftShader headless RAF intervals, not phone game FPS/thermals',errors});await context.close();
}
fs.writeFileSync(path.join(dir,'evidence.json'),JSON.stringify(rows,null,2));console.log('PASS actual OFELIYA paired menu/game Text+camera geometry, 200 enemies+boss, repeated resize. '+dir);await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
