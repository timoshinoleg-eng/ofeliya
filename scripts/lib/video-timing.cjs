// Test-only observations; never alters requested delays, game state or product callbacks.
async function installVideoTiming(page) {
 await page.evaluate(() => {
  const events=[];
  const record=(event,detail={})=>events.push({event,at:performance.now(),...detail});
  window.__videoTiming=events;window.__recordVideoTiming=record;
  document.addEventListener('pointerdown',()=>record('touch-received'),{capture:true});
  document.addEventListener('pointerup',()=>record('touch-up-received'),{capture:true});
  const timeout=window.setTimeout;
  window.setTimeout=function(callback,delay,...args){
   if(delay!==3200)return timeout.call(this,callback,delay,...args);
   record('video-cap-arm',{delay});
   return timeout.call(this,function(...values){record('video-cap-fire');return callback.apply(this,values);},delay,...args);
  };
  new MutationObserver(()=>{
   const overlay=document.querySelector('[data-ofeliya-video]');
   if(overlay?.style.opacity==='1'&&!overlay.__timingVisible){overlay.__timingVisible=true;record('video-visible');}
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
  const gs=window.__game.scene.getScene('Game'),create=gs.create;
  gs.create=function(...args){record('game-create-start');const value=create.apply(this,args);record('game-create-end');return value;};
  gs.sys.events.once('create',()=>record('game-active',{active:window.__game.scene.isActive('Game')}));
  const ready=()=>{
   if(window.__game.scene.isActive('Game')&&window.__game.scene.isActive('UI')&&gs.runState?.run.timeMs>0){
    record('game-ready',{active:true,uiActive:true,clockMs:gs.runState.run.timeMs});window.__game.events.off('postrender',ready);
   }
  };
  window.__game.events.on('postrender',ready);
  const play=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(...args){
   record('video-play');this.addEventListener('timeupdate',()=>record('video-progress',{currentTime:this.currentTime}));this.addEventListener('ended',()=>record('video-ended'));return play.apply(this,args);
  };
  const remove=Element.prototype.remove;
  Element.prototype.remove=function(...args){if(this.matches?.('[data-ofeliya-video]'))record('video-finish');return remove.apply(this,args);};
 });
}
function validateVideoTiming(trace,{mode,driverElapsedMs}) {
 const get=name=>{const event=trace.find(e=>e.event===name);if(!event||!Number.isFinite(event.at))throw Error('missing video timing event: '+name);return event;};
 const input=get('touch-received'),play=get('video-play'),finish=get('video-finish'),create=get('game-create-start'),active=get('game-active'),observed=get('game-predicate-observed');
 if(active.active!==true)throw Error('Game create event did not report RUNNING');
 const ordered=[input,play,finish,create,active,observed];if(ordered.some((e,i)=>i&&e.at<ordered[i-1].at))throw Error('invalid video event ordering');
 const ready=get('game-ready');
 if(ready.active!==true||ready.uiActive!==true||!(ready.clockMs>0)||ready.at<active.at)throw Error('Game/UI rendered transition did not complete');
 const userWaitMs=ready.at-input.at;
 const result={mode,userWaitMs,driverElapsedMs,inputDeliveryMs:input.at-get('touch-dispatch').at,videoStartupMs:null,capTimerMs:null,finishToSceneMs:create.at-finish.at,sceneCreateMs:active.at-create.at,renderReadyMs:ready.at-active.at,pollObservationMs:observed.at-active.at};
 if(mode==='cap'){
  const arm=get('video-cap-arm'),fire=get('video-cap-fire'),progress=get('video-progress');
  if(arm.delay!==3200)throw Error('product cap must request exactly 3200ms');
  if(!(progress.currentTime>=.05)||arm.at<play.at||fire.at<arm.at||finish.at<fire.at)throw Error('cap did not finish after real progress and timer callback');
  if(trace.some(e=>e.event==='video-ended'))throw Error('cap fixture must not end naturally');
  result.videoStartupMs=arm.at-play.at;result.capTimerMs=fire.at-arm.at;
  if(userWaitMs>3900)throw Error('maxDurationMs user waiting budget exceeded: '+userWaitMs);
 }else if(mode==='stall'&&userWaitMs>2600)throw Error('stall fallback exceeded watchdog budget: '+userWaitMs);
 return result;
}
async function waitForVideoGame(page,{mode,startedAt}) {
 const waitStartedAt=performance.now();
 const waitBudgetMs=mode==='stall'?2800:4300;
 try {
  await page.waitForFunction(()=>{if(window.__game.scene.isActive('Game')){window.__recordVideoTiming('game-predicate-observed');return true;}return false;},null,{timeout:mode==='stall'?2800:4300});
  // The second condition shares the original wait budget; it cannot extend it.
  const remainingMs=waitBudgetMs-(performance.now()-waitStartedAt);
  if(remainingMs<=0)throw Error('video readiness exhausted original wait budget');
  await page.waitForFunction(()=>window.__videoTiming.some(e=>e.event==='game-ready'),null,{timeout:remainingMs});
  const driverElapsedMs=performance.now()-startedAt;
  const trace=await page.evaluate(()=>window.__videoTiming);
  // Emit evidence BEFORE validation so assertion failures retain the complete trace.
  console.log('VIDEO_'+mode.toUpperCase()+'_TIMING',JSON.stringify({driverElapsedMs,trace}));
  const timing=validateVideoTiming(trace,{mode,driverElapsedMs});console.log('VIDEO_'+mode.toUpperCase()+'_CONTRACT',JSON.stringify(timing));return timing;
 }catch(error){
  const dump=await page.evaluate(()=>({trace:window.__videoTiming,gameActive:window.__game?.scene.isActive('Game'),uiActive:window.__game?.scene.isActive('UI'),overlays:document.querySelectorAll('[data-ofeliya-video]').length})).catch(()=>null);
  console.error('VIDEO_FAILURE_STATE',JSON.stringify({mode,error:String(error),dump}));throw error;
 }
}
module.exports={installVideoTiming,validateVideoTiming,waitForVideoGame};
