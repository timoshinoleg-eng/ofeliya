/**
 * Analytics event names in sync — ported Phase 2.
 *
 * The same product-event vocabulary lives in four places and they must
 * agree, otherwise an event tracked by the client is dropped by the
 * server allowlist, by the umami allowlist, or is invisible in the
 * analytics summary:
 *   1. src/systems/AnalyticsClient.ts — `ProductEvent` (client type);
 *   2. server/index.mjs — `PRODUCT_EVENTS` (POST /api/event allowlist);
 *   3. src/systems/OptionalWebAnalytics.ts — `EVENT_NAMES` (umami allowlist);
 *   4. server/analytics-summary.mjs — `ANALYTICS_EVENT_NAMES` (read path).
 *
 * This is a static contract test (source text parsing, like
 * check-language-copy): it pins the four lists equal. Add a new event to
 * all four lists or this test fails.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `marker not found: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `end marker not found: ${end}`);
  return source.slice(from + start.length, to);
}

function names(text) {
  const found = [...text.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert(found.length > 0, 'no event names found in block');
  return [...new Set(found)].sort();
}

const client = readFileSync(resolve('src/systems/AnalyticsClient.ts'), 'utf8');
const server = readFileSync(resolve('server/index.mjs'), 'utf8');
const umami = readFileSync(resolve('src/systems/OptionalWebAnalytics.ts'), 'utf8');
const summary = readFileSync(resolve('server/analytics-summary.mjs'), 'utf8');

const fromClient = names(block(client, 'export type ProductEvent =', ';'));
const fromServer = names(block(server, 'const PRODUCT_EVENTS = new Set([', ']);'));
const fromUmami = names(block(umami, 'const EVENT_NAMES = new Set<OptionalWebEvent>([', ']);'));
const fromSummary = names(block(summary, 'export const ANALYTICS_EVENT_NAMES = Object.freeze([', ']);'));

assert.deepEqual(fromServer, fromClient, 'server PRODUCT_EVENTS must match client ProductEvent');
assert.deepEqual(fromUmami, fromClient, 'umami EVENT_NAMES must match client ProductEvent');
assert.deepEqual(fromSummary, fromClient, 'summary ANALYTICS_EVENT_NAMES must match client ProductEvent');

// The ported Phase 2 funnel events must be present in all four lists.
for (const event of ['run_10min', 'mutation_chosen']) {
  assert(fromClient.includes(event), `ProductEvent must include ${event}`);
  assert(fromServer.includes(event), `PRODUCT_EVENTS must include ${event}`);
  assert(fromUmami.includes(event), `EVENT_NAMES must include ${event}`);
  assert(fromSummary.includes(event), `ANALYTICS_EVENT_NAMES must include ${event}`);
}

// The ported Phase 3 retention events must be present in all four lists.
for (const event of ['daily_claimed', 'achievement_unlocked']) {
  assert(fromClient.includes(event), `ProductEvent must include ${event}`);
  assert(fromServer.includes(event), `PRODUCT_EVENTS must include ${event}`);
  assert(fromUmami.includes(event), `EVENT_NAMES must include ${event}`);
  assert(fromSummary.includes(event), `ANALYTICS_EVENT_NAMES must include ${event}`);
}

// The ported Phase 4 lab events must be present in all four lists.
for (const event of ['lab_upgrade_bought', 'prestige_done']) {
  assert(fromClient.includes(event), `ProductEvent must include ${event}`);
  assert(fromServer.includes(event), `PRODUCT_EVENTS must include ${event}`);
  assert(fromUmami.includes(event), `EVENT_NAMES must include ${event}`);
  assert(fromSummary.includes(event), `ANALYTICS_EVENT_NAMES must include ${event}`);
}

// The ported Phase 5 skins events must be present in all four lists.
for (const event of ['skin_granted', 'skin_equipped']) {
  assert(fromClient.includes(event), `ProductEvent must include ${event}`);
  assert(fromServer.includes(event), `PRODUCT_EVENTS must include ${event}`);
  assert(fromUmami.includes(event), `EVENT_NAMES must include ${event}`);
  assert(fromSummary.includes(event), `ANALYTICS_EVENT_NAMES must include ${event}`);
}

console.log(`analytics-events: OK (${fromClient.length} events in sync)`);
