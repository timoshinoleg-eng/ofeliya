import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated child processes: no production credentials, remote state or Bot API.
const script = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHmac } from 'node:crypto';
const realRename = fs.renameSync;
let diskFailed = false;
fs.renameSync = (...args) => {
  if (diskFailed && /[\\/]store\.json$/.test(String(args[1]))) throw new Error('private-path-secret-example');
  return realRename(...args);
};
syncBuiltinESMExports();
const remote = process.env.MODE === 'remote';
const realFetch = globalThis.fetch;
let remoteFailed = false;
let db = { revision: 1, document: { store: { scores: [] }, profiles: { schemaVersion: 1, profiles: {} },
  tg_users: { '42': { chatId: '42', first: 'Retained', joinedAt: 1 } } } };
if (remote) globalThis.fetch = async (url, options) => {
  if (url !== process.env.OFELIYA_STATE_URL) return realFetch(url, options);
  const input = JSON.parse(options.body);
  if (input.op === 'claim') { db.writer = input.writer_id; db.revision++; return Response.json(db); }
  if (remoteFailed) return Response.json({}, { status: 503 });
  assert.equal(input.writer_id, db.writer);
  assert.equal(input.expected, db.revision);
  db.document = input.document; db.revision++;
  return Response.json({ revision: db.revision });
};
const { server, flushStoreNow } = await import('./index.mjs');
if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const post = async (path, body, headers = {}) => {
  const res = await realFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json(), headers: res.headers };
};
try {
  const start = uid => ({ message: { text: '/start', chat: { id: uid, type: 'private' }, from: { id: uid, first_name: 'Fixture' } } });
  const secret = { 'x-telegram-bot-api-secret-token': process.env.TG_WEBHOOK_SECRET };
  assert.equal((await post('/api/telegram/webhook', start(777), { 'x-telegram-bot-api-secret-token': 'wrong' })).status, 403);
  assert.equal((await post('/api/telegram/webhook', start(777), secret)).status, 200);
  if (remote) {
    assert.ok(db.document.tg_users['777'], 'HTTP acknowledgement must follow remote registration commit');
    assert.ok(db.document.tg_users['42'], 'existing users remain in the owned snapshot');
    remoteFailed = true;
    const failed = await post('/api/telegram/webhook', start(778), secret);
    assert.equal(failed.status, 503);
    assert.equal(failed.body.method, undefined, 'Telegram must retry an unacknowledged registration');
    remoteFailed = false;
    assert.equal((await post('/api/telegram/webhook', start(778), secret)).status, 200);
    assert.ok(db.document.tg_users['778'], 'an idempotent registration retry must still flush dirty remote state');
    const { DurableState } = await import('./durable-state.mjs');
    const { TelegramUserRegistry } = await import('./telegram-users.mjs');
    const restored = new DurableState(process.env.OFELIYA_STATE_URL, 'fixture');
    const restartDir = process.env.DATA_DIR + '/restart';
    await restored.restore(restartDir);
    assert.deepEqual(new TelegramUserRegistry(restartDir).snapshot(), db.document.tg_users);
  } else {
    assert.ok(JSON.parse(fs.readFileSync(process.env.DATA_DIR + '/tg_users.json'))['777']);
    const origin = await realFetch(base + '/api/top', { headers: { origin: 'https://evil.example' } });
    assert.equal(origin.headers.get('access-control-allow-origin'), null);
    assert.equal(origin.headers.get('vary'), 'Origin');
    const preflight = await realFetch(base + '/api/top', { method: 'OPTIONS', headers: { origin: 'https://allowed.example' } });
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://allowed.example');
    const same = await realFetch(base + '/api/top', { headers: { origin: base } });
    assert.equal(same.headers.get('access-control-allow-origin'), base);
    const malformed = await realFetch(base + '/api/score?initData=do-not-log-this', { method: 'POST', body: '{' });
    assert.equal(malformed.status, 500);
    assert.deepEqual(await malformed.json(), { ok: false, error: 'server error' });
    const fields = { user: JSON.stringify({ id: 111 }), auth_date: String(Math.floor(Date.now() / 1000)) };
    const check = Object.keys(fields).sort().map(key => key + '=' + fields[key]).join('\n');
    const key = createHmac('sha256', 'WebAppData').update(process.env.TG_BOT_TOKEN).digest();
    const initData = new URLSearchParams({ ...fields, hash: createHmac('sha256', key).update(check).digest('hex') }).toString();
    const auth = { platform: 'telegram', initData };
    const payload = { rulesetVersion: 3, campaignVersion: 2, difficultyId: 'standard', controlMode: 'one-hand', runSeed: 'security-duel-fixture',
      win: true, timeMs: 600000, kills: 40, level: 10, completionStage: 'heart', bossesDefeated: 2, boss1ClearMs: 320000, hostCellsInfected: 0, resumed: false };
    const duel = await post('/api/duel', { ...auth, payload });
    assert.equal(duel.status, 201, JSON.stringify(duel.body));
    const challengeId = duel.body.challenge.challengeId;
    const file = process.env.DATA_DIR + '/store.json';
    assert.ok(JSON.parse(fs.readFileSync(file)).duels.some(value => value.challengeId === challengeId), 'duel create is durable before201');
    diskFailed = true;
    assert.equal((await post('/api/duel/' + challengeId + '/event', { ...auth, event: 'open' })).status, 500);
    assert.equal((await realFetch(base + '/health')).status, 503, 'disk failure is visible to readiness');
    assert.equal(JSON.parse(fs.readFileSync(file)).duelEvents.filter(row => row.event === 'open').length, 0);
    diskFailed = false;
    flushStoreNow();
    assert.equal((await post('/api/duel/' + challengeId + '/event', { ...auth, event: 'start' })).status, 200);
    assert.ok(JSON.parse(fs.readFileSync(file)).duelEvents.some(row => row.event === 'start'));
    const attempt = await post('/api/duel/' + challengeId + '/attempt', { ...auth, payload });
    assert.equal(attempt.status, 200, JSON.stringify(attempt.body));
    assert.equal(JSON.parse(fs.readFileSync(file)).duelAttempts.length, 1);
    const statuses = [];
    for (let i = 0; i < 241; i++) statuses.push((await post('/api/score', { platform: 'browser', anonId: 'direct-ip-fixture-' + i,
      payload: { win: false, timeMs: 1000, kills: 1, level: 1 } }, { 'x-forwarded-for': '198.51.100.' + i })).status);
    assert.deepEqual(statuses.slice(0, 240), Array(240).fill(200));
    assert.equal(statuses[240], 429, 'explicit zero hops prevents bypass with rotating XFF');
  }
} finally { diskFailed = false; await new Promise(resolve => server.close(resolve)); }
console.log('SECURITY_PASS');
`;

for (const mode of ['local', 'remote']) {
  const directory = mkdtempSync(join(tmpdir(), 'ofeliya-security-'));
  const env = { ...process.env, MODE: mode, PORT: '0', DATA_DIR: directory, TG_BOT_TOKEN: 'security-fixture-token',
    TG_WEBHOOK_SECRET: 'fixture-webhook-secret-012345', OFELIYA_TELEGRAM_OUTBOUND_ENABLED: '0',
    STORE_SAVE_DELAY_MS: '3600000', WRITE_RATE_LIMIT: '20', TRUSTED_PROXY_HOPS: '0', TRUSTED_PROXY_IPS: '', ALLOW_ORIGINS: 'https://allowed.example' };
  for (const key of ['OFELIYA_STATE_URL', 'OFELIYA_STATE_TOKEN', 'MAX_BOT_TOKEN', 'OFELIYA_BOT_TOKEN', 'API_HOST']) delete env[key];
  if (mode === 'remote') Object.assign(env, { OFELIYA_STATE_URL: 'https://state.fixture.test', OFELIYA_STATE_TOKEN: 'fixture' });
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /SECURITY_PASS/);
    assert.ok(!result.stderr.includes('do-not-log-this'));
    console.log(`Security HTTP ${mode}: PASS`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
