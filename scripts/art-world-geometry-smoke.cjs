// Actual Phaser world-geometry regression: presentation art must preserve these baseline bounds.
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const executablePath=[chromium.executablePath(),'/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(file=>fs.existsSync(file));
if(!executablePath)throw Error('Chrome not found');
const BASE=process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/';
const OUTPUT=process.env.OFELIYA_GEOMETRY_DIR||'/tmp/ofeliya-art-geometry';
fs.mkdirSync(OUTPUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader']});
 const results=[];
 try {
 for(const renderer of ['webgl','canvas']){
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await ctx.route('https://st.max.ru/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await ctx.addInitScript(()=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({muted:true,runs:1})));
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const url=new URL(BASE);url.searchParams.set('renderer',renderer);
  await page.goto(url.toString(),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
  await page.evaluate(()=>{const game=window.__game;game.scene.getScene('Game').events.once('create',()=>game.scene.getScene('Game').scene.pause('Game'));game.scene.getScene('Menu').scene.start('Game');});
  await page.waitForFunction(()=>window.__game?.scene.isPaused('Game')&&window.__game.scene.isActive('UI'));
  const actualRenderer=await page.evaluate(()=>window.__game.renderer.type);
  if(actualRenderer!==(renderer==='webgl'?2:1))throw Error('Requested renderer fell back');
  const rows=await page.evaluate(()=>{
   const gs=window.__game.scene.getScene('Game');const rows=[];
   const sample=(label,sprite)=>{sprite.body?.updateFromGameObject();const b=sprite.body;rows.push({label,displayWidth:sprite.displayWidth,displayHeight:sprite.displayHeight,worldBodyWidth:b?.width??null,worldBodyHeight:b?.height??null,centerOffsetX:b?b.center.x-sprite.x:null,centerOffsetY:b?b.center.y-sprite.y:null});};
   for(const time of [0,200,600,1200]){gs.player.preUpdate(time,0);sample('player-'+time,gs.player);}
   const enemy=gs.enemies.getChildren()[0];
   const cases=[['swarm',false,null],['swarm',true,null],['runner',false,null],['runner',true,null],['brute',false,null],['brute',true,null],['boss',false,'immune-prime'],['boss',false,'cardiac-titan']];
   for(const [kind,elite,textureKey]of cases){
    enemy.activate(gs,kind,800,900,{elite,hpScale:1,dmgScale:1,speedScale:1,...(textureKey?{textureKey,bossBehavior:textureKey==='cardiac-titan'?'heartbeat-pulse':'pressure-wave',heartbeatMs:820}:{})});
    enemy.nextRoleActionAt=Number.MAX_SAFE_INTEGER;enemy.nextBossAttackAt=Number.MAX_SAFE_INTEGER;
    sample(`${kind}-${elite}-${textureKey}-activate`,enemy);
    for(const time of [200,600,1200]){enemy.preUpdate(time,0);sample(`${kind}-${elite}-${textureKey}-${time}`,enemy);}
    enemy.deactivateForStageReset();
   }
   gs.hostCells.resetStage();gs.hostCells.spawnNearPlayer();
   const cell=gs.hostCells.cells.find(c=>c.active);cell.phase=0;cell.infection=.68;
   gs.hostCells.update(600,0,10000);
   rows.push({label:'host',displayWidth:cell.image.displayWidth,displayHeight:cell.image.displayHeight,overlayWidth:cell.infectionOverlay.displayWidth,overlayHeight:cell.infectionOverlay.displayHeight,overlayVisible:cell.infectionOverlay.visible});
   const snapshot=gs.hostCells.snapshot();gs.hostCells.restore(snapshot);gs.hostCells.update(600,0,10000);
   const restored=gs.hostCells.cells.find(c=>c.active);
   rows.push({label:'host-restored',displayWidth:restored.image.displayWidth,displayHeight:restored.image.displayHeight,overlayWidth:restored.infectionOverlay.displayWidth,overlayHeight:restored.infectionOverlay.displayHeight,overlayVisible:restored.infectionOverlay.visible});
   return rows;
  });
  if(errors.length)throw Error(errors.join('\n'));
  results.push({renderer,rows});await ctx.close();
 }
 } finally { await browser.close(); }
 const output=path.join(OUTPUT,'world-geometry.json');
 fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
 {
  const baseline=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/visual-overhaul/ART_WORLD_BASELINE.json'),'utf8'));
  for(let i=0;i<results.length;i++)for(let j=0;j<results[i].rows.length;j++)for(const [key,value]of Object.entries(results[i].rows[j])){
   const expected=baseline[i].rows[j][key];
   if(typeof value!==typeof expected||(typeof value==='number'?Math.abs(value-expected)>1e-6:value!==expected))throw Error(`${results[i].renderer}/${results[i].rows[j].label}/${key}: ${value} != ${expected}`);
  }
 }
 console.log(`art world geometry: ${results.reduce((n,r)=>n+r.rows.length,0)} actualPhaserrows; baseline matches`);
})().catch(e=>{console.error(e);process.exit(1);});
