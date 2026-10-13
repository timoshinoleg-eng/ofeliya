import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'ofeliya-daily-upgrade-'));
const now = Date.now();
const d = new Date(now);
const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const oldRuns = [
  { uid: '771', rulesetVersion: 2, campaignVersion: 2 },
  { uid: '772', rulesetVersion: 3, campaignVersion: 1 },
].map((contract, index) => ({
  ...contract, runId: `old-daily-ticket-00000${index}`, platform: 'telegram', dateKey,
  runSeed: 'aabbccddeeff1122', difficultyId: 'standard', issuedAt: now - 30000,
  expiresAt: now + 600000, closedAt: null,
}));
writeFileSync(join(data, 'store.json'), JSON.stringify({ scores: [], dailyRuns: oldRuns }));
const token = 'daily-upgrade-test-only';
Object.assign(process.env, { PORT: '0', DATA_DIR: data, TG_BOT_TOKEN: token, OFELIYA_TELEGRAM_OUTBOUND_ENABLED: '0' });
delete process.env.OFELIYA_STATE_URL;
delete process.env.OFELIYA_STATE_TOKEN;
let server;
try {
  ({ server } = await import('./index.mjs'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  for (const old of oldRuns) {
    const fields = { user: JSON.stringify({ id: Number(old.uid) }), auth_date: String(Math.floor(Date.now() / 1000)) };
    const check = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(token).digest();
    const initData = new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
    const auth = { platform: 'telegram', initData };
    const beforePlaying = await post('/api/daily', auth);
    assert.equal(beforePlaying.body.dateKey, null);
    assert.equal(beforePlaying.body.challengeDateKey, dateKey, 'new players still receive the current server challenge date');
    const oldPayload = {
      rulesetVersion: 2, campaignVersion: 2, difficultyId: 'standard', controlMode: 'one-hand', runSeed: old.runSeed,
      daily: false, win: false, timeMs: 1000, kills: 1, level: 1,
      completionStage: 'bloodstream', bossesDefeated: 0, boss1ClearMs: null, hostCellsInfected: 0, resumed: false,
    };
    assert.equal((await post('/api/run/start', { ...auth, run: oldPayload })).status, 422, 'old fresh runs fail closed');
    assert.equal((await post('/api/score', { ...auth, submissionId: `old-v2-score-${old.uid}`, payload: oldPayload })).status, 422, 'old score contracts are never relabelled');
    assert.equal((await post('/api/duel', { ...auth, payload: { ...oldPayload, win: true } })).status, 422, 'old duels fail closed');
    const first = await post('/api/daily/run', auth);
    assert.equal(first.status, 201, 'a restored incompatible ticket must not be reused');
    const ticket = first.body.ticket;
    assert.equal(ticket.rulesetVersion, 3);
    assert.equal(ticket.campaignVersion, 2);
    assert.notEqual(ticket.runId, old.runId);
    const again = await post('/api/daily/run', auth);
    assert.equal(again.status, 200);
    assert.equal(again.body.ticket.runId, ticket.runId, 'compatible ticket still reuses idempotently');
    const accepted = await post('/api/score', { ...auth, submissionId: `daily-upgrade-submit-${old.uid}`, payload: {
      rulesetVersion: 3, campaignVersion: 2, difficultyId: 'standard', controlMode: 'one-hand', runSeed: ticket.runSeed,
      daily: true, dailyRunId: ticket.runId, win: false, timeMs: 1000, kills: 1, level: 1,
      completionStage: 'bloodstream', bossesDefeated: 0, boss1ClearMs: null, hostCellsInfected: 0, resumed: false,
    } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.dailyRunAccepted, true);
    const saved = JSON.parse(readFileSync(join(data, 'store.json'), 'utf8'));
    assert.deepEqual(saved.dailyRuns.find(run => run.runId === old.runId), old, 'old run contract must remain immutable');
    const daily = await post('/api/daily', auth);
    assert.equal(daily.body.dateKey, ticket.dateKey);
    assert.equal(daily.body.challengeDateKey, ticket.dateKey);
    assert.ok(daily.body.nextDayAt > daily.body.serverTime);
  }
  console.log('Daily persisted-state upgrade: PASS (ruleset + campaign, reuse, submission, immutable old tickets)');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(data, { recursive: true, force: true });
}
