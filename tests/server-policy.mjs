import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

await test('production defaults give analytics 60 events and disable outbound unless explicitly enabled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ofeliya-policy-'));
  const env = { ...process.env, DATA_DIR: dir, STORE_SAVE_DELAY_MS: '60000', PORT: '0', TG_BOT_TOKEN: 'test-policy-token' };
  delete env.WRITE_RATE_LIMIT;
  delete env.OFELIYA_TELEGRAM_OUTBOUND_ENABLED;
  const program = `
    import { createHmac } from 'node:crypto';
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const token = process.env.TG_BOT_TOKEN;
    const fields = { auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({id: 9381}) };
    const secret = createHmac('sha256','WebAppData').update(token).digest();
    fields.hash = createHmac('sha256',secret).update(Object.keys(fields).sort().map(k=>k+'='+fields[k]).join('\\n')).digest('hex');
    const initData = new URLSearchParams(fields).toString();
    const {server} = await import('./server/index.mjs');
    await new Promise(r=>server.once('listening',r));
    const base = 'http://127.0.0.1:'+server.address().port;
    const post = (path, body) => fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    try {
      const statuses = [];
      for(let i=0;i<61;i++) statuses.push((await post('/api/event',{platform:'telegram',initData,event:'app_open'})).status);
      const share = await post('/api/telegram/share',{initData});
      const health = await (await fetch(base+'/health')).json();
      const ordinary = await post('/api/run/start', {platform:'telegram',initData,run:{rulesetVersion:2,campaignVersion:2,difficultyId:'standard',runSeed:'durable-ordinary',controlMode:'one-hand'}});
      const ordinaryAck = await ordinary.json();
      if (ordinary.status!==201 || !JSON.parse(readFileSync(join(process.env.DATA_DIR,'store.json'),'utf8')).runGrants.some(r=>r.runId===ordinaryAck.grant.runId)) throw new Error('run grant ack before durable commit');
      const issued = await post('/api/daily/run', {platform:'telegram',initData});
      const {ticket} = await issued.json();
      const durableTicket = JSON.parse(readFileSync(join(process.env.DATA_DIR,'store.json'),'utf8')).dailyRuns.find(r=>r.runId===ticket.runId);
      if (!durableTicket) throw new Error('ticket ack before durable commit');
      const score = await post('/api/score', {platform:'telegram',initData,submissionId:'durable-score-test001',payload:{rulesetVersion:2,campaignVersion:2,difficultyId:'standard',completionStage:'bloodstream',runSeed:ticket.runSeed,controlMode:'one-hand',bossesDefeated:0,boss1ClearMs:null,hostCellsInfected:0,win:false,timeMs:1000,kills:1,level:1,daily:true,dailyRunId:ticket.runId,dateKey:ticket.dateKey}});
      const ack = await score.json();
      if (score.status!==200 || !ack.dailyRunAccepted) throw new Error('score fixture rejected '+JSON.stringify(ack));
      const durable = JSON.parse(readFileSync(join(process.env.DATA_DIR,'store.json'),'utf8'));
      if (!durable.scores.some(s=>s.scoreId===ack.scoreId) || !durable.dailyRuns.find(r=>r.runId===ticket.runId).closedAt) throw new Error('score ack before durable commit');
      console.log('RESULT:'+JSON.stringify({statuses,share:share.status,health}));
    } finally { await new Promise(r=>server.close(r)); }
  `;
  try {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout.split('RESULT:')[1].trim());
    assert.equal(result.share, 503, 'unset outbound policy must fail fast before prepared share transport');
    assert.deepEqual(result.statuses, [...Array(60).fill(202), 429]);
    assert.equal(result.health.analyticsEvents, 60);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
