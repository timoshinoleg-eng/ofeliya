// Actual Phaser display/body geometry before and after compensated art.
const fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const executablePath=[chromium.executablePath(),'/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
const BASE=process.env.OFELIYA_BASE_URL||'http://127.0.0.1:5173/';
(async()=>{
 const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader']});
 const results=[];
 try{for(const renderer of ['webgl','canvas']){
  const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await ctx.route('https://st.max.ru/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await ctx.addInitScript(()=>localStorage.setItem('ofeliya_save_v1',JSON.stringify({muted:true,runs:1,tutorialDone:true})));
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const url=new URL(BASE);url.searchParams.set('renderer',renderer);
  await page.goto(url.toString(),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__game?.scene.isActive('Menu'));
  await page.evaluate(()=>{const g=window.__game;g.scene.getScene('Game').events.once('create',()=>g.scene.getScene('Game').scene.pause('Game'));g.scene.getScene('Menu').scene.start('Game');});
  await page.waitForFunction(()=>window.__game.scene.isPaused('Game')&&window.__game.scene.isActive('UI'));
  if(await page.evaluate(()=>window.__game.renderer.type)!==(renderer==='webgl'?2:1))throw Error('renderer fell back');
  const rows=await page.evaluate(()=>{
   const gs=window.__game.scene.getScene('Game'),rows=[];
   const sample=(label,s)=>{s.body?.updateFromGameObject();const b=s.body;rows.push({label,displayWidth:s.displayWidth,displayHeight:s.displayHeight,worldBodyWidth:b?.width??null,worldBodyHeight:b?.height??null,centerOffsetX:b?b.center.x-s.x:null,centerOffsetY:b?b.center.y-s.y:null});};
   for(const time of [0,200,600,1200]){gs.player.preUpdate(time,0);sample('player-'+time,gs.player);}
   const e=gs.enemies.getChildren()[0];
   for(const [kind,elite,key]of [['swarm',false,null],['swarm',true,null],['runner',false,null],['runner',true,null],['brute',false,null],['brute',true,null],['boss',false,'immune-prime'],['boss',false,'cardiac-titan']]){
    e.activate(gs,kind,800,900,{elite,hpScale:1,dmgScale:1,speedScale:1,...(key?{textureKey:key,bossBehavior:key==='cardiac-titan'?'heartbeat-pulse':'pressure-wave',heartbeatMs:820}:{})});
    e.nextRoleActionAt=Number.MAX_SAFE_INTEGER;e.nextBossAttackAt=Number.MAX_SAFE_INTEGER;
    sample(kind+'-'+elite+'-'+key+'-activate',e);
    for(const time of [200,600,1200]){e.preUpdate(time,0);sample(kind+'-'+elite+'-'+key+'-'+time,e);}
    e.deactivateForStageReset();
   }
   gs.hostCells.resetStage();gs.hostCells.spawnNearPlayer();
   const cell=gs.hostCells.cells.find(c=>c.active);cell.phase=0;cell.infection=.68;gs.hostCells.update(600,0,10000);
   const host=(label,c)=>rows.push({label,displayWidth:c.image.displayWidth,displayHeight:c.image.displayHeight,overlayWidth:c.infectionOverlay.displayWidth,overlayHeight:c.infectionOverlay.displayHeight,overlayVisible:c.infectionOverlay.visible});
   host('host',cell);const snapshot=gs.hostCells.snapshot();gs.hostCells.restore(snapshot);gs.hostCells.update(600,0,10000);host('host-restored',gs.hostCells.cells.find(c=>c.active));
   return rows;
  });
  if(errors.length)throw Error(errors.join('\n'));
  results.push({renderer,rows});await ctx.close();
 }}finally{await browser.close();}
 const output=process.argv[2]||'work/visual-qa/art-world-current.json';
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2)+'\n');
 const baselineFile=process.argv[3]||path.resolve(__dirname,'../docs/visual-overhaul/ART_WORLD_BASELINE.json');
 if(baselineFile){
  const baseline=JSON.parse(fs.readFileSync(baselineFile,'utf8'));
  for(let i=0;i<results.length;i++)for(let j=0;j<results[i].rows.length;j++)for(const [key,value]of Object.entries(results[i].rows[j])){
   const expected=baseline[i].rows[j][key];
   if(typeof value!==typeof expected||(typeof value==='number'?Math.abs(value-expected)>1e-6:value!==expected))throw Error(results[i].renderer+'/'+results[i].rows[j].label+'/'+key+': '+value+' != '+expected);
  }
 }
 console.log('art world geometry: '+results.reduce((n,r)=>n+r.rows.length,0)+' actualPhaserrows; '+'baseline matches');
})().catch(e=>{console.error(e);process.exit(1);});
