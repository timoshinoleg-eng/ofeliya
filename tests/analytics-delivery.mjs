#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), 'ofeliya-analytics-delivery-'));
const tokens = { max: 'TEST-MAX-ANALYTICS-000', telegram: '7123456789:TEST-ANALYTICS-TOKEN' };
const users = {
  max: { id: 780113, first_name: 'MaxDeliveryPrivate' },
  telegram: { id: 780114, first_name: 'TelegramDeliveryPrivate' },
};
const release = 'a'.repeat(40);
const envNames = ['DATA_DIR', 'PORT', 'MAX_BOT_TOKEN', 'TG_BOT_TOKEN', 'BOT_TOKEN', 'WRITE_RATE_LIMIT'];
const priorEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

// Match server/test.mjs signing: both MAX and Telegram use the WebAppData-derived HMAC.
function signInitData(user, token) {
  const params = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAF-analytics-delivery',
  };
  const check = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

let server;
try {
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    PORT: '0',
    MAX_BOT_TOKEN: tokens.max,
    TG_BOT_TOKEN: tokens.telegram,
    BOT_TOKEN: 'UNRELATED-SHARED-TOKEN',
    WRITE_RATE_LIMIT: '1000',
  });
  ({ server } = await import('../server/index.mjs'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const signed = Object.fromEntries(
    Object.keys(users).map((platform) => [platform, signInitData(users[platform], tokens[platform])]),
  );
  const accepted = [];

  async function post(platform, event, runId, runTimeMs, firstRun, domain = {}) {
    assert.ok(Object.keys(domain).length <= 4, 'domain props must fit the eight-field server limit');
    const props = { analyticsRunId: runId, runTimeMs, firstRun, release, ...domain };
    assert.deepEqual(Object.keys(props).slice(0, 4), ['analyticsRunId', 'runTimeMs', 'firstRun', 'release']);
    const response = await fetch(`${base}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, initData: signed[platform], event, props }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 202, `${platform} ${event}: ${responseText}`);
    assert.equal(JSON.parse(responseText).ok, true);
    accepted.push({ platform, event, props });
  }

  const maxRun = 'max-delivery-run-01';
  const tgRun = 'telegram-delivery-run-01';
  await post('max', 'run_start', maxRun, 0, true);
  // Receipt order differs from game-time order; the report must use runTimeMs.
  await post('max', 'infection_started', maxRun, 2000, true, { progress: 0.2 });
  await post('max', 'host_cell_approached', maxRun, 1000, true, { progress: 0.1 });
  await post('max', 'first_lysis', maxRun, 4000, true,
    { enemiesHit: 2, enemiesKilled: 1, rna: 3, stage: 'bloodstream' });
  await post('max', 'second_host_cell_completed_without_hint', maxRun, 7000, true);
  await post('telegram', 'run_start', tgRun, 0, false);
  await post('telegram', 'host_cell_approached', tgRun, 500, false, { progress: 0.1 });
  await post('telegram', 'infection_started', tgRun, 1000, false, { progress: 0.3 });
  await post('telegram', 'infection_interrupted', tgRun, 1500, false, { progress: 0.4 });
  await post('telegram', 'infection_resumed', tgRun, 2000, false, { progress: 0.4 });

  for (const platform of ['max', 'telegram']) {
    const tampered = signInitData(users[platform], 'WRONG:ANALYTICS-TOKEN');
    const response = await fetch(`${base}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, initData: tampered, event: 'first_lysis', props: {} }),
    });
    assert.equal(response.status, 403, `${platform} tampered signature must be rejected`);
  }

  const { flushStoreNow } = await import('../server/index.mjs');
  assert.equal(flushStoreNow(), true, 'accepted events must cause a disk flush');
  const storeFile = join(dataDir, 'store.json');
  const rawStore = readFileSync(storeFile, 'utf8');
  const rows = JSON.parse(rawStore).analyticsEvents;
  assert.equal(rows.length, accepted.length, 'rejected signatures must not persist');
  for (const [index, expected] of accepted.entries()) {
    const row = rows[index];
    assert.equal(row.platform, expected.platform);
    assert.equal(row.event, expected.event);
    assert.equal(row.actor, createHash('sha256')
      .update(`${expected.platform}:${users[expected.platform].id}`).digest('hex').slice(0, 24));
    assert.deepEqual(row.props, expected.props, 'all run metadata and bounded domain fields survive sanitization');
    assert.equal(typeof row.ts, 'number');
  }
  for (const platform of ['max', 'telegram']) {
    assert.ok(!rawStore.includes(signed[platform]), 'raw initData leaked into persisted store');
    assert.ok(!rawStore.includes(String(users[platform].id)), 'raw user ID leaked into persisted store');
    assert.ok(!rawStore.includes(users[platform].first_name), 'display name leaked into persisted store');
  }

  const report = spawnSync(process.execPath, [join(root, 'scripts/analyze-product-funnel.mjs'), storeFile], {
    cwd: root, encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(report.status, 0, report.stderr || report.error?.message);
  assert.match(report.stdout, /Comprehension telemetry/);
  assert.match(report.stdout, /contextual runs=2\b/);
  assert.match(report.stdout, /legacy\/partial uncorrelated rows=0\b/);
  assert.match(report.stdout, /malformed-context rows=0\b/);
  assert.match(report.stdout, /All contextual runs: run_start observed=2/);
  assert.match(report.stdout, /observed ordered through infection_started: 2\/2/);
  assert.match(report.stdout, /observed ordered through first_lysis: 1\/2/);
  assert.match(report.stdout, /fully observed chain: 1\/2/);
  assert.match(report.stdout, /First-run subset: run_start observed=1/);
  assert.match(report.stdout, /median first-lysis game time from run_start: 4000 ms/);
  for (const platform of ['max', 'telegram']) {
    for (const privateValue of [String(users[platform].id), users[platform].first_name,
      signed[platform], rows.find((row) => row.platform === platform).actor]) {
      assert.ok(!report.stdout.includes(privateValue), 'report printed a private identifier');
    }
  }
  assert.ok(!report.stdout.includes(maxRun) && !report.stdout.includes(tgRun),
    'report printed a run identifier');
  console.log('signed MAX/Telegram analytics delivery, persistence, and comprehension report: ok');
} finally {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  for (const name of envNames) {
    if (priorEnv[name] === undefined) delete process.env[name];
    else process.env[name] = priorEnv[name];
  }
  rmSync(dataDir, { recursive: true, force: true });
}
