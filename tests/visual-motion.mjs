import assert from 'node:assert/strict';
import { existsSync,mkdirSync,writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const baseline=process.env.OFELIYA_VISUAL_BASELINE==='1';
const prior=baseline?execFileSync('git',['show','7a0d829:src/game/Player.ts'],{encoding:'utf8',windowsHide:true}):null;
const server=await createServer({server:{host:'127.0.0.1',port:0},plugins:baseline?[{name:'matched-player-baseline',enforce:'pre',transform(_code,id){if(id.endsWith('/game/Player.ts'))return prior;}}]:[]});
const out=resolve(process.env.OFELIYA_MOTION_EVIDENCE||'../evidence/visual-motion',baseline?'before':'after'); mkdirSync(out,{recursive:true});
let browser; const results=[];
try {
 await server.listen();
 browser=await chromium.launch({executablePath:process.env.OFELIYA_CHROME_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader']});
 for(const renderer of ['canvas','webgl']) {
  const context=await browser.newContext({viewport:{width:390,height:740},hasTouch:true,serviceWorkers:'block',recordVideo:{dir:out,size:{width:390,height:740}}});
  await context.route('https://st.max.ru/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(server.resolvedUrls.local[0]+'?renderer='+renderer,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'),null,{timeout:30000});
  await page.evaluate(()=>{const m=window.__game.scene.getScene('Menu');m.registry.set('runSeedOverride','visual-motion-comparison');m.scene.start('Game');});
  await page.waitForFunction(()=>window.__game.scene.isActive('UI'),null,{timeout:30000});
  await page.evaluate(()=>{
   const g=window.__game.scene.getScene('Game'),u=window.__game.scene.getScene('UI');
   u.dismissProgressionForStageBoundary();g.awaitingChoice=false;g.pendingChoices=[];g.queuedLevels=0;g.scene.resume();
   g.runState.stage.hp=100000;g.runState.stage.maxHp=100000;
   for(let i=0;i<100;i++){const a=i/100*Math.PI*2,r=180+(i%5)*30;g.spawnEnemy(['swarm','runner','brute'][i%3],g.player.x+Math.cos(a)*r,g.player.y+Math.sin(a)*r,false);}
   // Authoritative simulation, AI, physics, VFX and Player.preUpdate remain running.
   g.runState.stage.evolutions=new Set(['prism','halo','singularity']);
   g.syncPlayerMutationSilhouette();
   g.onGemCollected=()=>{}; // Keep level-choice modals out of this live render comparison.
  });
  await page.waitForTimeout(500);
  const sample=await page.evaluate(()=>new Promise((resolve,reject)=>{
   const game=window.__game,g=game.scene.getScene('Game'),values=[];let previous=0,frames=0;
   const timer=setTimeout(()=>reject(Error('motion sample deadline')),20000);
   const step=t=>{if(previous)values.push(t-previous);previous=t;if(++frames<241)requestAnimationFrame(step);else{clearTimeout(timer);const sorted=values.slice().sort((a,b)=>a-b);resolve({samples:values.length,windowMs:values.reduce((a,b)=>a+b,0),p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],over33:values.filter(v=>v>33.34).length/values.length,activeEnemies:g.enemies.getChildren().filter(e=>e.active).length,sceneActive:game.scene.isActive('Game'),bodyRadius:g.player.body.radius,rendererType:game.renderer.type,objects:g.children.length,textureCount:game.textures.getTextureKeys().length});}};
   requestAnimationFrame(step);
  }));
  await page.screenshot({path:resolve(out,renderer+'-live.png')});
  assert.equal(sample.sceneActive,true);assert.equal(sample.rendererType,renderer==='canvas'?1:2);assert.equal(errors.length,0,errors.join('\n'));
  const video=page.video(); await context.close(); await video.saveAs(resolve(out,renderer+'-live.webm'));
  results.push({renderer,...sample,errors});console.log(JSON.stringify(results.at(-1)));
 }
 writeFileSync(resolve(out,'cadence.json'),JSON.stringify({baseline,source:'7a0d829 Player module only versus working Player, same scripted workload; 100 seeded spawns with live AI/physics/game loop, elevated HP test fixture',limits:'Desktop software-rendered rAF scheduling; not GPU timings, equal surviving-AI count, physical phone FPS, thermal or perceptual acceptance',results},null,2));
}finally{await browser?.close();await server.close();}
