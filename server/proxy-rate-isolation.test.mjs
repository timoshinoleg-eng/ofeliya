import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createHmac} from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'ofeliya-review-gateway-'));mkdirSync(join(dir,'dist'));writeFileSync(join(dir,'dist/index.html'),'<html>fixture</html>');
const port=async()=>{const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p};
const outer=await port();let inner=await port();while(inner===outer)inner=await port();
const env={...process.env,SERVER_PORT:String(outer),OFELIYA_API_PORT:String(inner),DATA_DIR:join(dir,'data'),OFELIYA_DIST_DIR:join(dir,'dist'),RENDER:'false',TG_BOT_TOKEN:'fixture-only',TG_WEBHOOK_SECRET:'fixture-secret-0123456789',OFELIYA_TELEGRAM_OUTBOUND_ENABLED:'0',WRITE_RATE_LIMIT:'20'};
for(const k of ['OFELIYA_STATE_URL','OFELIYA_STATE_TOKEN','OFELIYA_BOT_TOKEN','OFELIYA_MAX_BOT_TOKEN','MAX_BOT_TOKEN','HOST_TRUSTED_PROXY_HOPS','HOST_TRUSTED_PROXY_IPS','TRUSTED_PROXY_HOPS','TRUSTED_PROXY_IPS'])delete env[k];
const child=spawn(process.execPath,[resolve('server/hosting.mjs')],{env,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>out+=s);const exited=once(child,'exit');
const base='http://127.0.0.1:'+outer;
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/ready')).ok)break}catch{}if(child.exitCode!==null)throw Error(out);await new Promise(r=>setTimeout(r,40));}
 const payload={win:false,timeMs:1000,kills:1,level:1};
 const post=async(body,client)=>{const r=await fetch(base+'/api/score',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':client},body:JSON.stringify(body)});return{status:r.status,body:await r.json()}};
 const attackCounts={};
 for(let i=0;i<240;i++){const r=await post({platform:'browser',anonId:'single-attacker',payload},'198.51.100.1');attackCounts[r.status]=(attackCounts[r.status]??0)+1;}
 const fields={user:JSON.stringify({id:777}),auth_date:String(Math.floor(Date.now()/1000))};const check=Object.keys(fields).sort().map(k=>k+'='+fields[k]).join('\n');const key=createHmac('sha256','WebAppData').update(env.TG_BOT_TOKEN).digest();const initData=new URLSearchParams({...fields,hash:createHmac('sha256',key).update(check).digest('hex')}).toString();
 const distinctSignedUser=await post({platform:'telegram',initData,payload},'203.0.113.2');assert.deepEqual(attackCounts,{'200':20,'429':220});
 assert.equal(distinctSignedUser.status,200,'anonymous retries exhausted a different signed actor');
 // Repeated blocked actor requests must not consume other anonymous actors' budget.
 assert.equal((await post({platform:'browser',anonId:'other-anonymous',payload},'198.51.100.9')).status,200);
 for(let i=1;i<20;i++)assert.equal((await post({platform:'telegram',initData,payload},'203.0.113.2')).status,200);
 assert.equal((await post({platform:'telegram',initData,payload},'203.0.113.2')).status,429,'verified actors must remain bounded');
 // Exhaust the real shared anonymous budget by rotating actors; signatures stay independent.
 for(let i=0;i<240;i++)await post({platform:'browser',anonId:'rotated-anon-'+i,payload},'198.51.100.8');
 assert.equal((await post({platform:'browser',anonId:'new-after-flood',payload},'198.51.100.99')).status,429,'anonymous XFF spoofing bypassed IP backstop');
 const fields2={user:JSON.stringify({id:778}),auth_date:fields.auth_date};
 const check2=Object.keys(fields2).sort().map(k=>k+'='+fields2[k]).join('\n');
 const initData2=new URLSearchParams({...fields2,hash:createHmac('sha256',key).update(check2).digest('hex')}).toString();
 assert.equal((await post({platform:'telegram',initData:initData2,payload},'203.0.113.3')).status,200,'anonymous flood blocked another signed user');
 console.log('Gateway rate isolation: actor retries, signed users, anonymous flood and spoofed XFF PASS');
}finally{child.kill();await exited;if(resolve(dir).startsWith(resolve(tmpdir())+sep))rmSync(dir,{recursive:true,force:true});}
