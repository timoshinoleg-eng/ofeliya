// Controlled presentation fixture: actual damage callbacks/body transforms, frozen progression.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const executablePath=[chromium.executablePath(),'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(file=>fs.existsSync(file));
if(!executablePath)throw Error('Chrome not found');
const BASE=process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/';
const OUT=process.env.OFELIYA_IMPACT_DIR||path.resolve('artifacts/biological-impact');
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader']});
 const results=[];
 try {
 for(const renderer of ['webgl','canvas'])for(const tier of ['full','reduced']) {
  const context=await browser.newContext({viewport:{width:390,height:740},deviceScaleFactor:2,
   ...(process.env.OFELIYA_IMPACT_VIDEO==='1'&&renderer==='webgl'&&tier==='full'?{recordVideo:{dir:OUT,size:{width:390,height:740}}}:{})});
  await context.route('https://st.max.ru/**',route=>route.fulfill({body:''}));
  await context.addInitScript(tier=>{localStorage.setItem('ofeliya_performance_tier',tier);localStorage.setItem('ofeliya_save_v1',JSON.stringify({muted:true,runs:1,tutorialDone:true}));},tier);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`${BASE}?renderer=${renderer}`);
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
  await page.evaluate(()=>{
   const game=window.__game,gs=game.scene.getScene('Game');
   // Freeze progression before starting; retain real object preUpdate/tweens/physics lifecycle.
   gs.update=()=>{};game.scene.getScene('Menu').scene.start('Game');
  });
  await page.waitForFunction(()=>window.__game.scene.isActive('UI'));
  const result=await page.evaluate(({renderer,tier})=>{
   const game=window.__game,gs=game.scene.getScene('Game'),ui=game.scene.getScene('UI');
   gs.scene.pause();ui.hideModal();ui.onboardingContainer?.setVisible(false);ui.onboardingArmed=false;
   gs.enemies.getChildren().forEach(e=>e.deactivateForStageReset());gs.bullets.getChildren().forEach(b=>b.disableBody(true,true));
   gs.hostCells.resetStage();gs.player.setPosition(700,700);gs.cameras.main.stopFollow();gs.cameras.main.centerOn(730,730);
   const enemy=gs.enemies.getChildren()[0];enemy.activate(gs,'swarm',780,760,{elite:false,hpScale:1,dmgScale:1});
   enemy.nextRoleActionAt=enemy.nextBossAttackAt=Infinity;
   const fail=(condition,message)=>{if(!condition)throw Error(message);};
   fail(game.renderer.type===(renderer==='webgl'?2:1),'renderer fallback');
   const geometry=s=>{s.body.updateFromGameObject();return [s.width,s.height,s.displayWidth,s.displayHeight,s.body.width,s.body.height,s.body.center.x-s.x,s.body.center.y-s.y];};
   const sampleTime=gs.time.now;
   gs.player.preUpdate(600,0);enemy.preUpdate(600,0);
   const before={player:geometry(gs.player),enemy:geometry(enemy)},hp=enemy.hp,killCount=gs.runState.stage.kills;
   gs.player.markHurt(sampleTime,1,0);const iframe=gs.player.hurtUntil;
   const damage=enemy.takeDamage(1,130,0);
   const directions={player:gs.player.biologicalHitDirection,enemy:enemy.biologicalHitDirection};
   const phases=[];
   for(const elapsed of [0,60,90,120,179,180]) {
    gs.time.now=sampleTime+elapsed;gs.player.preUpdate(600,0);enemy.preUpdate(600,0);
    const after={player:geometry(gs.player),enemy:geometry(enemy)};
    fail(JSON.stringify(before)===JSON.stringify(after),`body/display changed at ${elapsed}`);
    phases.push({elapsed,player:gs.player.frame.name,enemy:enemy.frame.name,playerAtlas:gs.player.texture.key,enemyAtlas:enemy.texture.key});
   }
   fail(damage===1&&enemy.hp===hp-1,'damage contract');fail(gs.player.hurtUntil===iframe,'iframe changed');
   fail(phases[0].enemyAtlas==='bio-hit-immune-antibody'&&phases[0].playerAtlas==='bio-hit-virus-player','hit not selected');
   fail(phases[5].enemyAtlas==='bio-cycle-immune-antibody'&&phases[5].playerAtlas==='bio-cycle-virus-player','idle not recovered');
   for(const phase of phases.slice(0,5)) {
    const pose=tier==='reduced'?(phase.elapsed<90?0:2):Math.floor(phase.elapsed/60);
    fail(phase.player===`hit-${directions.player}-${pose}`&&phase.enemy===`hit-${directions.enemy}-${pose}`,`wrong tier pose at ${phase.elapsed}`);
   }
   gs.time.now=sampleTime;
   enemy.takeDamage(99999,130,0);
   fail(!enemy.active&&!enemy.body.enable,'death delayed body disable');
   fail(gs.runState.stage.kills===killCount+1,'death changed kill accounting');
   const ghost=gs.vfx.biologicalGhosts[0];fail(ghost?.active&&!ghost.image.body,'nonphysical ghost missing');
   const snapshot={x:ghost.image.x,y:ghost.image.y,texture:ghost.image.texture.key,frame:ghost.image.frame.name};
   enemy.activate(gs,'runner',1200,1300,{elite:false,hpScale:1,dmgScale:1});
   fail(ghost.image.x===snapshot.x&&ghost.image.y===snapshot.y,'ghost retained pooled enemy');
   enemy.deactivateForStageReset();enemy.activate(gs,'swarm',780,760,{elite:false,hpScale:1,dmgScale:1});
   enemy.preUpdate(600,0);fail(enemy.texture.key==='bio-cycle-immune-antibody','recycled hit leaked');
   window.__impactFixture={gs,enemy,ui};
   const label=document.createElement('div');label.textContent=`${renderer} / ${tier} · controlled, muted fixture · no phone/FPS claim`;
   Object.assign(label.style,{position:'fixed',bottom:'12px',left:'8px',right:'8px',padding:'8px',background:'#05101ee0',color:'#def',font:'11px sans-serif',zIndex:'9999'});document.body.append(label);
   return {renderer,tier,phases,before,damage,iframe,snapshot,atlasBytes:(224*224+152*152)*12*4};
  },{renderer,tier});
  await page.screenshot({path:path.join(OUT,`${renderer}-${tier}-idle.png`)});
  // Export actual boot-created hit atlas pixels; native browser canvas, no synthetic repaint.
  if(renderer==='webgl'&&tier==='full') {
   const urls=await page.evaluate(()=>['bio-hit-virus-player','bio-hit-immune-antibody'].map(key=>({key,url:window.__game.textures.get(key).getSourceImage().toDataURL()})));
   const sheet=await context.newPage();await sheet.setViewportSize({width:940,height:1230});
   await sheet.setContent('<body style="margin:0;background:#081019"><canvas id="sheet" width="940" height="1230"></canvas></body>');
   await sheet.evaluate(async urls=>{const c=document.getElementById('sheet').getContext('2d');c.fillStyle='#def';c.font='16px sans-serif';c.fillText('Actual hit atlas: four directions / three recovery poses',15,25);let y=50;for(const {key,url} of urls){const img=new Image();img.src=url;await img.decode();c.drawImage(img,16,y);y+=img.height+30;c.fillText(key,16,y-10);}},urls);
   await sheet.screenshot({path:path.join(OUT,'hit-atlas.png')});await sheet.close();
  }
  await page.evaluate(()=>{
   const {gs,enemy}=window.__impactFixture;gs.player.markHurt(gs.time.now,1,0);enemy.takeDamage(1,130,0);
   gs.player.preUpdate(600,0);enemy.preUpdate(600,0);
  });
  await page.screenshot({path:path.join(OUT,`${renderer}-${tier}-impact.png`)});
  await page.evaluate(()=>{const {gs,enemy}=window.__impactFixture;enemy.takeDamage(99999);gs.scene.resume();});
  await page.waitForFunction(()=>window.__impactFixture.gs.vfx.biologicalGhosts.every(g=>!g.active));
  result.ghostsReleased=true;
  if(process.env.OFELIYA_IMPACT_VIDEO==='1'&&renderer==='webgl'&&tier==='full') {
   await page.evaluate(()=>{
    const {gs,enemy}=window.__impactFixture;let count=0;
    // Cosmetic tint cleanup normally belongs to Game.update, which this fixture freezes.
    gs.update=()=>{if(gs.time.now>=gs.player.hurtUntil&&gs.player.tintFill)gs.player.clearTint();};
    gs.time.addEvent({delay:2000,repeat:9,callback:()=>{
     enemy.activate(gs,'swarm',780,760,{elite:false,hpScale:1,dmgScale:1,speedScale:0});
     gs.player.markHurt(gs.time.now,Math.cos(count),Math.sin(count));enemy.takeDamage(1,Math.cos(count)*130,Math.sin(count)*130);count++;
     gs.time.delayedCall(700,()=>enemy.takeDamage(99999));
    }});
   });await page.waitForTimeout(20500);
  }
  await page.evaluate(()=>window.__game.scene.stop('Game'));
  await page.waitForFunction(()=>window.__impactFixture.gs.vfx.destroyed&&window.__impactFixture.gs.vfx.biologicalGhosts.length===0);
  result.shutdownDestroyed=true;
  await context.close();assert.deepEqual(errors,[]);result.pageErrors=errors;results.push(result);
 }
 fs.writeFileSync(path.join(OUT,'impact-evidence.json'),JSON.stringify(results,null,2));
 console.log(`biological impact: ${results.length} actual Phaser renderer/tier cells PASS; frozen progression, not live mobile/performance acceptance`);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
