import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'quest-runtime-'));
try {
 execFileSync(process.execPath,[resolve('node_modules/typescript/bin/tsc'),'src/quests/questRuntime.ts','--target','ES2020','--module','commonjs','--moduleResolution','node','--outDir',temp,'--strict','--skipLibCheck'],{stdio:'inherit'});
 const { QuestRuntime } = createRequire(import.meta.url)(join(temp,'questRuntime.js'));
 let raw=null, now=Date.parse('2026-10-23T23:59:00Z');
 const storage={read:()=>raw,write:v=>{raw=v;}};
 let r=new QuestRuntime(storage,{now:()=>now});
 r.begin(0); r.kill(1,'swarm',true); r.kill(1,'swarm',true); r.rna(7); r.mutation();
 r.tick(59000,59000); const cp=r.checkpoint(); r.flush();
 assert.ok(JSON.parse(raw).seenEventIds.every(id=>id.length<=64),'persisted event IDs survive core sanitization');
 let state=JSON.parse(raw); assert.equal(state.runMetrics.q_kills,1); assert.equal(state.runMetrics.q_elites,1);
 assert.equal(state.runMetrics.q_rna,7); assert.equal(state.runMetrics.q_mut,1);
 const events=r.snapshot().processedEvents; r.tick(59100,59100); assert.equal(r.snapshot().processedEvents,events);
 r.rna(7); r.flush(); // activity newer than the product checkpoint
 r=new QuestRuntime(storage,{now:()=>now}); r.begin(0,cp,{kills:1,timeMs:59000,noDamageMs:59000});
 assert.equal(r.snapshot().processedEvents,1,'resume emits only current tick, no start');
 r.rna(7); r.flush(); assert.equal(JSON.parse(raw).runMetrics.q_rna,14,'replayed checkpoint timeline can earn RNA again');
 now+=60000; r.tick(60000,60000); r.tick(60000,0,true); r.tick(120000,60000);
 assert.equal(JSON.parse(raw).dayMetrics.q_nodmg,60,'fresh streak after midnight damage');
 r.end(1); const ended=raw; r.end(2); assert.equal(raw,ended,'terminal receipt is idempotent');
 r=new QuestRuntime(storage,{now:()=>now}); r.begin(1,cp,{kills:1,timeMs:59000,noDamageMs:59000});
 r.kill(2,'swarm',false); r.flush(); assert.equal(JSON.parse(raw).runtime.ended,true,'old terminal checkpoint cannot reactivate');
 r.begin(1); r.flush(); assert.equal(JSON.parse(raw).runMetrics.q_rna,0,'new run resets');
 assert.equal(r.snapshot().lifetime.completedRuns,1);
 let midnightRaw=null; const midnightStorage={read:()=>midnightRaw,write:v=>midnightRaw=v};
 now=Date.parse('2026-10-23T23:59:00Z');
 let m=new QuestRuntime(midnightStorage,{now:()=>now});m.begin(0);m.tick(50000,50000);const old=m.checkpoint();m.tick(59000,59000);m.flush();
 const savedAtEpochMs=now;now+=60000;
 m=new QuestRuntime(midnightStorage,{now:()=>now});m.begin(0,old,{kills:0,timeMs:50000,noDamageMs:50000,savedAtEpochMs});m.flush();
 assert.equal(JSON.parse(midnightRaw).dayMetrics.q_nodmg,0,'yesterday checkpoint streak is not today progress');
 // The producer observes a migrated baseline, then an authoritative damage reset.
 raw=JSON.stringify({version:3,dayKey:'2026-10-24',days:{},runMetrics:{},dayMetrics:{q_nodmg:0},baseline:{q_nodmg:80},seenEventIds:[],claimedLifetime:[]});
 r=new QuestRuntime(storage,{now:()=>now});r.begin(0,{id:'legacy',kills:0,rna:0,mutations:0,elites:0,ended:false},{kills:0,timeMs:80000,noDamageMs:80000,savedAtEpochMs:now});
 r.tick(80000,0,true);r.tick(140000,60000);r.flush();
 assert.equal(JSON.parse(raw).version,4);assert.equal(JSON.parse(raw).dayMetrics.q_nodmg,60);
 assert.deepEqual(JSON.parse(raw).claimedLifetime,[]);assert.ok(Object.values(JSON.parse(raw).days).every(day=>day.claimed.length===0),'producer never claims');
 const broken=new QuestRuntime({read:()=>{throw Error('denied')},write:()=>{throw Error('quota')}},{now:()=>now});broken.begin(0);broken.rna(1);broken.end(1);
 console.log('PASS quest producer persistence/resume/duplicate/UTC/terminal/restart/throttle');
} finally { rmSync(temp,{recursive:true,force:true}); }
