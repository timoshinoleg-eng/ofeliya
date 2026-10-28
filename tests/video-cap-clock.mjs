import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {validateVideoTiming,waitForVideoGame}=require('../scripts/lib/video-timing.cjs');
function exercise({lateCap=false}={}){
 let now=0,next=0;const timers=new Map(),calls=[];
 const clock={setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+(lateCap&&delay===3200?6400:delay),requested:delay});return id;},clearTimeout(id){timers.delete(id);}};
 const advance=ms=>{const end=now+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=end;};
 class Element extends EventTarget{
  constructor(){super();this.style={};this.dataset={};this.children=[];this.currentTime=0;}
  appendChild(el){this.children.push(el);el.parent=this;}remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this);}setAttribute(){}removeAttribute(){}load(){}pause(){}play(){return Promise.resolve();}focus(){}
 }
 const host=new Element();let media;
 const document={getElementById:id=>id==='game'?host:null,createElement:tag=>{const e=new Element();if(tag==='video')media=e;return e;}};
 const exports={};const source=readFileSync('src/systems/VideoInterstitial.ts','utf8').replaceAll('import.meta.env.BASE_URL',JSON.stringify('/'));
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,module:{exports},window:{...clock,location:{search:'?video=1'}},document,navigator:{webdriver:true},URLSearchParams});
 const api=exports.VideoInterstitial;
 assert.equal(api.play('startIntro',{maxDurationMs:3200,onVisible:()=>calls.push('visible'),onComplete:()=>calls.push('complete'),onFail:()=>calls.push('fail')}),true);
 media.currentTime=.08;media.dispatchEvent(new Event('timeupdate'));
 assert.equal(host.children[0].style.opacity,'1');assert.deepEqual(calls,['visible']);
 assert.deepEqual([...timers.values()].map(t=>t.requested),[3200],'real product must request the exact cap and clear startup watchdog');
 advance(3199);assert.deepEqual(calls,['visible']);assert.equal(host.children.length,1);
 advance(1);assert.deepEqual(calls,['visible','complete'],'real product must release exactly at cap in a controlled clock');assert.equal(host.children.length,0);assert.equal(timers.size,0);
 media.dispatchEvent(new Event('ended'));advance(5000);assert.deepEqual(calls,['visible','complete'],'duplicate completion cannot run callback twice');
}
if(process.env.VIDEO_CLOCK_FAULT==='late-cap'){exercise({lateCap:true});}else{
 exercise();assert.throws(()=>exercise({lateCap:true}),/real product must release exactly at cap/,'negative control must detect late cap');
 const trace=[['touch-dispatch',0],['touch-received',300],['video-play',310],['video-cap-arm',420],['video-progress',420],['video-cap-fire',3650],['video-finish',3651],['game-create-start',3660],['game-active',3720],['game-ready',3740],['game-predicate-observed',3900]].map(([event,at])=>({event,at,...(event==='video-cap-arm'?{delay:3200}:{}),...(event==='video-progress'?{currentTime:.08}:{}),...(event==='game-active'?{active:true}:event==='game-ready'?{active:true,uiActive:true,clockMs:16}:{})}));
 assert.equal(validateVideoTiming(trace,{mode:'cap',driverElapsedMs:3999}).userWaitMs,3440);
 assert.throws(()=>validateVideoTiming(trace.filter(e=>e.event!=='game-ready'),{mode:'cap'}),/missing video timing/);
 assert.throws(()=>validateVideoTiming(trace.filter(e=>e.event!=='game-active'),{mode:'cap'}),/missing video timing/);
 assert.throws(()=>validateVideoTiming(trace.map(e=>e.event==='game-ready'?{...e,at:4250}:e.event==='game-predicate-observed'?{...e,at:4300}:e),{mode:'cap'}),/user waiting budget exceeded/);
 assert.throws(()=>validateVideoTiming(trace.map(e=>e.event==='video-cap-arm'?{...e,delay:6400}:e),{mode:'cap'}),/exactly 3200/);
 const originalPerformance=globalThis.performance;let fakeNow=0,waitCalls=0;
 try{
  globalThis.performance={now:()=>fakeNow};
  const page={waitForFunction:async()=>{waitCalls++;fakeNow=4301;},evaluate:async()=>({trace:[],gameActive:true,uiActive:false})};
  await assert.rejects(waitForVideoGame(page,{mode:'cap',startedAt:0}),/exhausted original wait budget/);
  assert.equal(waitCalls,1,'readiness must never receive a fresh timeout after the original budget expires');
 }finally{globalThis.performance=originalPerformance;}
 console.log('video cap: real production module3200ms clock, cleanup/idempotency, negative late-cap control and layered timing contracts PASS');
}
