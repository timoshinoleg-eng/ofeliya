/**
 * Sprint 0 — product analytics read path.
 *
 * Two layers:
 *   1. pure unit tests over `server/analytics-summary.mjs` (token match, query parsing,
 *      aggregation, privacy of the returned shape);
 *   2. an HTTP-level test that boots the REAL server and exercises
 *      `GET /api/analytics/summary` end to end, including the auth failure modes.
 *
 * No production behaviour is mocked: the child process imports the actual server module.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ANALYTICS_EVENT_GAPS,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_SUMMARY_TOKEN_MIN_LENGTH,
  analyticsSummaryTokenMatches,
  buildAnalyticsSummary,
  parseAnalyticsSummaryQuery,
} from '../server/analytics-summary.mjs';

const TOKEN = 'test-analytics-summary-token-0123456789';
const PRIVATE_PROP = 'PRIVATE-RUNSEED-DO-NOT-LEAK';
const TEST_UID = 918273645;

await test('token matcher fails closed and compares in constant time', () => {
  assert.equal(analyticsSummaryTokenMatches(TOKEN, TOKEN), true);
  assert.equal(analyticsSummaryTokenMatches(TOKEN, TOKEN + 'x'), false);
  assert.equal(analyticsSummaryTokenMatches(TOKEN, TOKEN.slice(0, -1)), false);
  assert.equal(analyticsSummaryTokenMatches(TOKEN, ''), false);
  assert.equal(analyticsSummaryTokenMatches(TOKEN, undefined), false);
  assert.equal(analyticsSummaryTokenMatches(TOKEN, null), false);
  // Unset or too-short expected secret rejects everything.
  assert.equal(analyticsSummaryTokenMatches('', TOKEN), false);
  assert.equal(analyticsSummaryTokenMatches('short', TOKEN), false);
  assert.equal(analyticsSummaryTokenMatches(undefined, TOKEN), false);
  assert.equal(ANALYTICS_SUMMARY_TOKEN_MIN_LENGTH, 16);
});

await test('query parser is strict: unknown parameters are rejected, never ignored', () => {
  const ok = parseAnalyticsSummaryQuery(new URLSearchParams('window=24h'), 1_000_000);
  assert.equal(ok.ok, true);
  assert.equal(ok.label, '24h');
  assert.equal(ok.to, 1_000_000);
  assert.equal(ok.from, 1_000_000 - 24 * 60 * 60 * 1000);
  assert.equal(ok.platform, null);

  const typo = parseAnalyticsSummaryQuery(new URLSearchParams('windw=24h'), 1_000_000);
  assert.equal(typo.ok, false);
  assert.match(typo.error, /unknown query parameter/);

  const badWindow = parseAnalyticsSummaryQuery(new URLSearchParams('window=42y'), 1_000_000);
  assert.equal(badWindow.ok, false);
  assert.match(badWindow.error, /unsupported window/);

  const badPlatform = parseAnalyticsSummaryQuery(new URLSearchParams('platform=vk'), 1_000_000);
  assert.equal(badPlatform.ok, false);
  assert.match(badPlatform.error, /unsupported platform/);

  const badFrom = parseAnalyticsSummaryQuery(new URLSearchParams('from=abc'), 1_000_000);
  assert.equal(badFrom.ok, false);
  assert.match(badFrom.error, /from must be/);

  const negativeTo = parseAnalyticsSummaryQuery(new URLSearchParams('to=-5'), 1_000_000);
  assert.equal(negativeTo.ok, false);

  const inverted = parseAnalyticsSummaryQuery(new URLSearchParams('from=200&to=100'), 1_000_000);
  assert.equal(inverted.ok, false);
  assert.match(inverted.error, /from must not be greater than to/);

  const all = parseAnalyticsSummaryQuery(new URLSearchParams('window=all'), 1_000_000);
  assert.equal(all.ok, true);
  assert.equal(all.from, 0);

  const custom = parseAnalyticsSummaryQuery(new URLSearchParams('from=10&to=20&platform=max'), 1_000_000);
  assert.equal(custom.ok, true);
  assert.equal(custom.from, 10);
  assert.equal(custom.to, 20);
  assert.equal(custom.label, 'custom');
  assert.equal(custom.platform, 'max');
});

await test('aggregator over an empty store returns an empty, well-formed summary', () => {
  const summary = buildAnalyticsSummary([], { from: 0, to: 1000, now: 1000 });
  assert.equal(summary.totals.events, 0);
  assert.equal(summary.totals.ignoredRows, 0);
  assert.deepEqual(summary.events, []);
  assert.equal(summary.funnel.appOpen, 0);
  assert.equal(summary.funnel.runEnded, 0);
  assert.equal(summary.coverage.oldestTs, null);
  assert.equal(summary.coverage.newestTs, null);
  assert.equal(summary.coverage.storedEvents, 0);
});

await test('aggregator ignores unknown event names instead of echoing them back', () => {
  const summary = buildAnalyticsSummary([
    { event: 'app_open', platform: 'telegram', ts: 100, actor: 'a'.repeat(24), props: { x: 1 } },
    { event: 'totally_made_up', platform: 'telegram', ts: 100 },
    { event: null, platform: 'telegram', ts: 100 },
    { platform: 'telegram', ts: 100 },
    { event: 'app_open', platform: 'vk', ts: 100 },
    { event: 'app_open', platform: 'telegram', ts: 'nope' },
    null,
  ], { from: 0, to: 1000, now: 1000 });
  assert.equal(summary.totals.events, 1);
  assert.equal(summary.totals.ignoredRows, 6);
  assert.equal(summary.events.length, 1);
  assert.equal(summary.events[0].event, 'app_open');
  // The unknown name must not appear anywhere in the payload.
  assert.doesNotMatch(JSON.stringify(summary), /totally_made_up/);
});

await test('aggregator filters by window and by platform', () => {
  const rows = [
    { event: 'app_open', platform: 'telegram', ts: 100 },
    { event: 'app_open', platform: 'max', ts: 100 },
    { event: 'run_start', platform: 'telegram', ts: 5_000 },
    { event: 'run_start', platform: 'telegram', ts: 50_000 },
  ];
  const narrow = buildAnalyticsSummary(rows, { from: 0, to: 1_000, now: 60_000 });
  assert.equal(narrow.totals.events, 2);
  assert.deepEqual(narrow.events.map((e) => e.event), ['app_open']);
  assert.equal(narrow.events[0].count, 2);
  assert.equal(narrow.events[0].platforms.telegram, 1);
  assert.equal(narrow.events[0].platforms.max, 1);

  const telegramOnly = buildAnalyticsSummary(rows, { from: 0, to: 60_000, platform: 'telegram', now: 60_000 });
  assert.equal(telegramOnly.totals.events, 3);
  assert.equal(telegramOnly.events.find((e) => e.event === 'run_start').platforms.max, 0);
  assert.equal(telegramOnly.events.find((e) => e.event === 'run_start').platforms.telegram, 2);
});

await test('aggregator derives funnel counters from existing events only', () => {
  // Values that exist ONLY in the row must never appear in the summary.
  const ROW_ONLY = 'ROW_ONLY_MARKER';
  const rows = [
    { event: 'app_open', platform: 'telegram', ts: 1 },
    { event: 'run_start', platform: 'telegram', ts: 1 },
    { event: 'first_mutation_opened', platform: 'telegram', ts: 1 },
    { event: 'first_mutation_selected', platform: 'telegram', ts: 1 },
    { event: 'win', platform: 'telegram', ts: 1 },
    { event: 'death', platform: 'telegram', ts: 1 },
    { event: 'replay', platform: 'telegram', ts: 1 },
    { event: 'share', platform: 'telegram', ts: 1, props: { kind: 'challenge' } },
    { event: 'share', platform: 'telegram', ts: 1, props: { kind: ROW_ONLY } },
    { event: 'onboarding_step', platform: 'telegram', ts: 1, props: { outcome: 'completed' } },
    { event: 'onboarding_step', platform: 'telegram', ts: 1, props: { outcome: ROW_ONLY } },
    { event: 'onboarding_exit', platform: 'telegram', ts: 1, props: { reason: 'skip' } },
    { event: 'onboarding_exit', platform: 'telegram', ts: 1, props: { reason: ROW_ONLY } },
  ];
  const summary = buildAnalyticsSummary(rows, { from: 0, to: 100, now: 100 });
  assert.equal(summary.funnel.appOpen, 1);
  assert.equal(summary.funnel.runStart, 1);
  assert.equal(summary.funnel.mutationOpened, 1);
  assert.equal(summary.funnel.mutationSelected, 1);
  assert.equal(summary.funnel.runWin, 1);
  assert.equal(summary.funnel.runDeath, 1);
  assert.equal(summary.funnel.runEnded, 2);
  assert.equal(summary.funnel.replay, 1);
  assert.equal(summary.funnel.share, 2);
  // Only the exact contract values drive a counter; other prop values are ignored.
  assert.equal(summary.funnel.challengeShare, 1);
  assert.equal(summary.funnel.tutorialCompleted, 1);
  assert.equal(summary.funnel.tutorialSkipped, 1);
  // A prop value that exists only in a stored row must never be emitted.
  const serialised = JSON.stringify(summary);
  assert.doesNotMatch(serialised, new RegExp(ROW_ONLY));
  assert.doesNotMatch(serialised, /"props"/);
  assert.doesNotMatch(serialised, /"actor"/);
  // The gap list is a frozen constant, not data.
  assert.deepEqual(summary.gaps, ANALYTICS_EVENT_GAPS.map((gap) => ({ ...gap })));
});

await test('aggregator reports the ring cap and survives a full ring', () => {
  const rows = [];
  for (let i = 0; i < 20_001; i++) rows.push({ event: 'app_open', platform: 'telegram', ts: i });
  const summary = buildAnalyticsSummary(rows, { from: 0, to: 20_001, cap: 20_000, now: 20_001 });
  assert.equal(summary.coverage.cap, 20_000);
  assert.equal(summary.coverage.storedEvents, 20_001);
  assert.equal(summary.totals.events, 20_001);
  assert.equal(summary.events[0].count, 20_001);
  assert.equal(summary.coverage.oldestTs, 0);
  assert.equal(summary.coverage.newestTs, 20_000);
});

await test('aggregator never emits actors, props or raw identities', () => {
  const actor = createHash('sha256').update(`telegram:${TEST_UID}`).digest('hex').slice(0, 24);
  const summary = buildAnalyticsSummary([
    { event: 'win', platform: 'telegram', ts: 1, actor, props: { runSeed: PRIVATE_PROP, timeMs: 1234 } },
  ], { from: 0, to: 100, now: 100 });
  const serialised = JSON.stringify(summary);
  assert.doesNotMatch(serialised, new RegExp(actor));
  assert.doesNotMatch(serialised, new RegExp(String(TEST_UID)));
  assert.doesNotMatch(serialised, new RegExp(PRIVATE_PROP));
  assert.doesNotMatch(serialised, /"actor"/);
  assert.doesNotMatch(serialised, /"props"/);
  assert.doesNotMatch(serialised, /initData/);
});

await test('gap list names the absent events and never invents them', () => {
  const keys = ANALYTICS_EVENT_GAPS.map((gap) => gap.key);
  assert.ok(keys.includes('menu_ready'));
  assert.ok(keys.includes('challenge_click'));
  assert.ok(keys.includes('tutorial_completed'));
  for (const gap of ANALYTICS_EVENT_GAPS) {
    assert.ok(gap.status === 'ABSENT' || gap.status === 'DERIVED');
    assert.ok(typeof gap.derivedFrom === 'string' && gap.derivedFrom.length > 0);
  }
  // An absent event must not be present in the accepted catalogue.
  assert.equal(ANALYTICS_EVENT_NAMES.includes('menu_ready'), false);
  assert.equal(ANALYTICS_EVENT_NAMES.includes('challenge_click'), false);
  assert.equal(ANALYTICS_EVENT_NAMES.includes('tutorial_completed'), false);
});

// ---------------------------------------------------------------------------
// HTTP layer against the real server
// ---------------------------------------------------------------------------

const CHILD_PROGRAM = `
import { createHmac } from 'node:crypto';

const mod = await import(process.env.OFELIYA_SERVER_MODULE);
const server = mod.server;
await new Promise((resolve) => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const token = process.env.TG_BOT_TOKEN;

function sign(fields) {
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret)
    .update(Object.keys(fields).sort().map((k) => k + '=' + fields[k]).join('\\n'))
    .digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const initData = sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(process.env.OFELIYA_TEST_UID) }) });

const post = (path, body, headers = {}) => fetch(base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const get = (path, headers = {}) => fetch(base + path, { headers });

const events = [
  ['app_open', {}],
  ['run_start', {}],
  ['first_mutation_opened', {}],
  ['first_mutation_selected', {}],
  ['win', { runSeed: process.env.OFELIYA_TEST_PRIVATE_PROP, timeMs: 4242 }],
  ['death', {}],
  ['replay', {}],
  ['share', { kind: 'challenge' }],
  ['onboarding_step', { outcome: 'completed' }],
  ['onboarding_exit', { reason: 'skip' }],
];

const healthInitial = await (await get('/health')).json();

const writeStatuses = [];
for (const [event, props] of events) {
  const res = await post('/api/event', { platform: 'telegram', initData, event, props });
  writeStatuses.push(res.status);
}

const healthBefore = await (await get('/health')).json();

const unauthorized = await get('/api/analytics/summary');
const unauthorizedBody = await unauthorized.text();

const wrongToken = await get('/api/analytics/summary', { 'X-Ofeliya-Analytics-Token': 'wrong-token-value-that-is-long-enough' });

const authorized = await get('/api/analytics/summary', { 'X-Ofeliya-Analytics-Token': process.env.OFELIYA_ANALYTICS_TOKEN });
const authorizedBody = await authorized.text();

const emptyWindow = await get('/api/analytics/summary?from=0&to=1', { 'X-Ofeliya-Analytics-Token': process.env.OFELIYA_ANALYTICS_TOKEN });
const emptyWindowBody = await emptyWindow.text();

const malformed = await get('/api/analytics/summary?window=99y', { 'X-Ofeliya-Analytics-Token': process.env.OFELIYA_ANALYTICS_TOKEN });
const malformedBody = await malformed.text();

const unknownParam = await get('/api/analytics/summary?windo=24h', { 'X-Ofeliya-Analytics-Token': process.env.OFELIYA_ANALYTICS_TOKEN });

const telegramOnly = await get('/api/analytics/summary?platform=telegram', { 'X-Ofeliya-Analytics-Token': process.env.OFELIYA_ANALYTICS_TOKEN });
const telegramOnlyBody = await telegramOnly.text();

const maxOnly = await get('/api/analytics/summary?platform=max', { 'X-Ofeliya-Analytics-Token': process.env.OFELIYA_ANALYTICS_TOKEN });
const maxOnlyBody = await maxOnly.text();

const badEvent = await post('/api/event', { platform: 'telegram', initData, event: 'not_a_real_event' });
const badInitData = await post('/api/event', { platform: 'telegram', initData: 'garbage', event: 'app_open' });

const healthAfter = await (await get('/health')).json();

console.log('RESULT:' + JSON.stringify({
  writeStatuses,
  unauthorized: { status: unauthorized.status, body: unauthorizedBody },
  wrongToken: { status: wrongToken.status },
  authorized: { status: authorized.status, body: authorizedBody },
  emptyWindow: { status: emptyWindow.status, body: emptyWindowBody },
  malformed: { status: malformed.status, body: malformedBody },
  unknownParam: { status: unknownParam.status },
  telegramOnly: { status: telegramOnly.status, body: telegramOnlyBody },
  maxOnly: { status: maxOnly.status, body: maxOnlyBody },
  badEvent: { status: badEvent.status },
  badInitData: { status: badInitData.status },
  healthInitial: { analyticsEvents: healthInitial.analyticsEvents },
  healthBefore: { analyticsEvents: healthBefore.analyticsEvents },
  healthAfter: { analyticsEvents: healthAfter.analyticsEvents },
}));

await new Promise((resolve) => server.close(resolve));
`;

function runServer(env, program = CHILD_PROGRAM) {
  const dir = mkdtempSync(join(tmpdir(), 'ofeliya-analytics-readpath-'));
  const programPath = join(dir, 'child.mjs');
  writeFileSync(programPath, program);
  const child = spawnSync(process.execPath, [programPath], {
    env: {
      ...process.env,
      OFELIYA_SERVER_MODULE: new URL('../server/index.mjs', import.meta.url).href,
      DATA_DIR: join(dir, 'data'),
      PORT: '0',
      TG_BOT_TOKEN: 'test-telegram-token-0123456789',
      OFELIYA_TEST_UID: String(TEST_UID),
      OFELIYA_TEST_PRIVATE_PROP: PRIVATE_PROP,
      ...env,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (child.status !== 0) {
    throw new Error('child server failed: ' + child.stderr);
  }
  const marker = child.stdout.split('RESULT:');
  if (marker.length < 2) throw new Error('child produced no RESULT: ' + child.stdout + child.stderr);
  return { result: JSON.parse(marker[1].trim()), dir };
}

await test('HTTP: unauthenticated read is rejected, authenticated read returns aggregates', () => {
  const { result, dir } = runServer({ OFELIYA_ANALYTICS_TOKEN: TOKEN });
  try {
    // Unauthenticated and wrong-token reads are rejected.
    assert.equal(result.unauthorized.status, 403);
    assert.doesNotMatch(result.unauthorized.body, /app_open/);
    assert.equal(result.wrongToken.status, 403);

    // The authenticated read succeeds.
    assert.equal(result.authorized.status, 200);
    const body = JSON.parse(result.authorized.body);
    assert.equal(body.ok, true);
    assert.equal(body.totals.events, 10);
    assert.equal(body.funnel.appOpen, 1);
    assert.equal(body.funnel.runStart, 1);
    assert.equal(body.funnel.mutationOpened, 1);
    assert.equal(body.funnel.mutationSelected, 1);
    assert.equal(body.funnel.runWin, 1);
    assert.equal(body.funnel.runDeath, 1);
    assert.equal(body.funnel.runEnded, 2);
    assert.equal(body.funnel.replay, 1);
    assert.equal(body.funnel.challengeShare, 1);
    assert.equal(body.funnel.tutorialCompleted, 1);
    assert.equal(body.funnel.tutorialSkipped, 1);
    assert.equal(body.window.label, '24h');
    assert.equal(body.coverage.cap, 20000);
    assert.ok(body.coverage.storedEvents >= 10);
    assert.ok(Array.isArray(body.gaps) && body.gaps.length > 0);

    // The write path is unchanged: every valid event still returns 202.
    assert.deepEqual(result.writeStatuses, Array(10).fill(202));
    assert.equal(result.healthInitial.analyticsEvents, 0);
    assert.equal(result.healthBefore.analyticsEvents, 10);
    assert.equal(result.healthAfter.analyticsEvents, 10);
    // The write path still rejects a bad event and bad initData.
    assert.equal(result.badEvent.status, 400);
    assert.equal(result.badInitData.status, 403);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('HTTP: the summary never exposes raw identities, props or initData', () => {
  const { result, dir } = runServer({ OFELIYA_ANALYTICS_TOKEN: TOKEN });
  try {
    const actor = createHash('sha256').update(`telegram:${TEST_UID}`).digest('hex').slice(0, 24);
    for (const body of [result.authorized.body, result.telegramOnly.body, result.maxOnly.body]) {
      assert.doesNotMatch(body, new RegExp(actor));
      assert.doesNotMatch(body, new RegExp(String(TEST_UID)));
      assert.doesNotMatch(body, new RegExp(PRIVATE_PROP));
      assert.doesNotMatch(body, /"actor"/);
      assert.doesNotMatch(body, /"props"/);
      assert.doesNotMatch(body, /initData/);
    }
    // The private prop value was accepted and stored, it is simply never returned.
    assert.equal(result.authorized.body.includes('runSeed'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('HTTP: window filtering, platform filtering and malformed queries behave', () => {
  const { result, dir } = runServer({ OFELIYA_ANALYTICS_TOKEN: TOKEN });
  try {
    // A window that ends before the events excludes them.
    assert.equal(result.emptyWindow.status, 200);
    const empty = JSON.parse(result.emptyWindow.body);
    assert.equal(empty.totals.events, 0);
    assert.deepEqual(empty.events, []);

    // Malformed queries are rejected, never silently widened.
    assert.equal(result.malformed.status, 400);
    assert.match(result.malformed.body, /unsupported window/);
    assert.equal(result.unknownParam.status, 400);

    // Platform filtering works and `max` has no rows here.
    assert.equal(result.telegramOnly.status, 200);
    assert.equal(JSON.parse(result.telegramOnly.body).totals.events, 10);
    assert.equal(result.maxOnly.status, 200);
    assert.equal(JSON.parse(result.maxOnly.body).totals.events, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await test('HTTP: the endpoint fails closed when no operator token is configured', () => {
  const { result, dir } = runServer({ OFELIYA_ANALYTICS_TOKEN: '' });
  try {
    assert.equal(result.unauthorized.status, 403);
    // Even the correct-looking token must be rejected when the secret is unset.
    assert.equal(result.wrongToken.status, 403);
    assert.equal(result.authorized.status, 403);
    assert.doesNotMatch(result.authorized.body, /app_open/);
    // The write path still works without the operator token.
    assert.deepEqual(result.writeStatuses, Array(10).fill(202));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
