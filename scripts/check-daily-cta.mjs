import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(tmpdir(), 'ofeliya-daily-cta-'));
const require = createRequire(import.meta.url);

function pass(name, detail = '') {
  console.log(`  ok  ${name}${detail ? ' - ' + detail : ''}`);
}

function fail(name, error) {
  console.error(`  FAIL ${name}: ${error && error.stack ? error.stack : error}`);
  console.error('daily cta contract: FAIL');
  process.exit(1);
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    failures += 1;
    fail(name, error);
  }
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeRegistry(initial = []) {
  const map = new Map(initial);
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    snapshot: () =>
      JSON.stringify([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))),
  };
}

const platform = {
  kind: 'telegram',
  available: true,
  platform: 'android',
  version: '9',
  initData: 'signed-init-data',
  getUser: () => ({ id: 111 }),
  getDisplayName: () => 'Alice',
  getStartParam: () => null,
  buildStartLink: () => null,
  getViewportSize: async () => null,
  setBackHandler: () => {},
  shareResult: async () => false,
  haptic: () => {},
  notify: () => {},
};

const ticket = {
  runId: 'dailyRun_abcdefghijkl',
  runSeed: 'abc123def4567890',
  dateKey: '2026-09-22',
  issuedAt: 1000,
  expiresAt: 9_999_999_999_999,
  difficultyId: 'standard',
  rulesetVersion: 2,
  campaignVersion: 2,
};

const result = {
  win: true,
  reason: 'victory',
  difficultyId: 'standard',
  runSeed: ticket.runSeed,
  controlMode: 'dual-move',
  resumed: false,
  timeMs: 600000,
  kills: 420,
  hostCellsInfected: 12,
  level: 17,
  highestLevel: 17,
  comboBest: 7,
  stageId: 'heart',
  stageOrder: 2,
  bossesDefeated: 2,
  boss1ClearMs: 320000,
  stacks: {},
  evolutions: [],
  legendaryIds: [],
  stageBuilds: {},
  newAchievements: [],
  records: { timeRecord: false, killsRecord: false, levelRecord: false },
};

try {
  execFileSync(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      'src/game/DailyRunIntent.ts',
      'src/systems/ScoreClient.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      // The intent module's type graph transitively reaches UI/platform files that use
      // `import.meta.env` (ESM-only). We only need runnable emit here, not a second type-check:
      // the project's own `npm run build` (tsc --noEmit) is the type gate.
      '--noCheck',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit', cwd: root }
  );

  const intent = require(join(temp, 'game/DailyRunIntent.js'));
  const score = require(join(temp, 'systems/ScoreClient.js'));

  // --- (1) launchDailyRun atomicity -------------------------------------------------
  await test('launchDailyRun writes the full registry block only on an ok ticket', async () => {
    const registry = makeRegistry([['sentinel', 'keep']]);
    global.fetch = async () => jsonRes(201, { ok: true, ticket });
    const status = await intent.launchDailyRun({ registry, platform });
    assert.equal(status, 'ok');
    assert.equal(registry.get('dailyTicket'), ticket);
    assert.deepEqual(registry.get('dailyIntent'), { runId: ticket.runId });
    assert.equal(registry.get('runSeedOverride'), ticket.runSeed);
    assert.equal(registry.get('difficultyId'), 'standard');
    assert.equal(registry.get('duelChallenge'), null);
    assert.equal(registry.get('sentinel'), 'keep');
  });

  const failureCases = [
    ['503 capacity', async () => jsonRes(503, { ok: false }), 'capacity'],
    ['403 denied', async () => jsonRes(403, { ok: false }), 'denied'],
    ['500 http', async () => jsonRes(500, {}), 'http'],
    ['malformed 200 http', async () => jsonRes(200, { ok: false, ticket }), 'http'],
    ['throw network', async () => { throw new Error('boom'); }, 'network'],
  ];
  for (const [name, stub, expected] of failureCases) {
    await test(`launchDailyRun leaves the registry untouched on ${name}`, async () => {
      const registry = makeRegistry([['sentinel', 'keep'], ['difficultyId', 'strained']]);
      const before = registry.snapshot();
      global.fetch = stub;
      const status = await intent.launchDailyRun({ registry, platform });
      assert.equal(status, expected);
      assert.equal(registry.snapshot(), before, 'registry changed on a failed ticket request');
    });
  }

  await test('launchDailyRun returns unavailable with no request for a browser identity', async () => {
    const registry = makeRegistry([['sentinel', 'keep']]);
    const before = registry.snapshot();
    let fetches = 0;
    global.fetch = async () => {
      fetches += 1;
      return jsonRes(200, { ok: true, ticket });
    };
    const status = await intent.launchDailyRun({
      registry,
      platform: { ...platform, kind: 'browser', initData: '' },
    });
    assert.equal(status, 'unavailable');
    assert.equal(fetches, 0);
    assert.equal(registry.snapshot(), before);
  });

  // --- (2) submitDailyRunScoreDetailed status table ---------------------------------
  const scoreCases = [
    ['200 + dailyRunAccepted -> ok', 200, { ok: true, rank: 3, ranked: true, rulesetVersion: 2, campaignVersion: 2, dailyRunAccepted: true }, 'ok'],
    ['200 without the flag -> rejected', 200, { ok: true, rank: 3, ranked: true, rulesetVersion: 2, campaignVersion: 2 }, 'rejected'],
    ['403 -> denied', 403, { ok: false }, 'denied'],
    ['409 -> closed', 409, { ok: false }, 'closed'],
    ['410 -> expired', 410, { ok: false }, 'expired'],
    ['422 -> rejected', 422, { ok: false }, 'rejected'],
    ['500 -> http', 500, {}, 'http'],
  ];
  for (const [name, status, body, expected] of scoreCases) {
    await test(`submitDailyRunScoreDetailed ${name}`, async () => {
      global.fetch = async () => jsonRes(status, body);
      const outcome = await score.submitDailyRunScoreDetailed(result, platform, ticket);
      assert.equal(outcome.status, expected);
      if (expected === 'ok') {
        assert.equal(outcome.response.dailyRunAccepted, true);
        assert.equal(outcome.response.rank, 3);
      } else {
        assert.equal(outcome.response, null);
      }
    });
  }

  await test('submitDailyRunScoreDetailed throw -> network', async () => {
    global.fetch = async () => {
      throw new Error('boom');
    };
    const outcome = await score.submitDailyRunScoreDetailed(result, platform, ticket);
    assert.equal(outcome.status, 'network');
    assert.equal(outcome.response, null);
  });

  const preconditionCases = [
    ['resumed result', { ...result, resumed: true }, platform],
    ['seed mismatch', { ...result, runSeed: 'other-seed' }, platform],
    ['browser identity', result, { ...platform, kind: 'browser', initData: '' }],
  ];
  for (const [name, res, plat] of preconditionCases) {
    await test(`submitDailyRunScoreDetailed ${name} -> unavailable with zero requests`, async () => {
      let fetches = 0;
      global.fetch = async () => {
        fetches += 1;
        return jsonRes(200, { ok: true, dailyRunAccepted: true, ranked: true, rulesetVersion: 2, campaignVersion: 2 });
      };
      const outcome = await score.submitDailyRunScoreDetailed(res, plat, ticket);
      assert.equal(outcome.status, 'unavailable');
      assert.equal(outcome.response, null);
      assert.equal(fetches, 0);
    });
  }

  await test('submitDailyRunScore stays compatible (ok -> response, else null)', async () => {
    global.fetch = async () => jsonRes(200, { ok: true, rank: 3, ranked: true, rulesetVersion: 2, campaignVersion: 2, dailyRunAccepted: true });
    const ok = await score.submitDailyRunScore(result, platform, ticket);
    assert.equal(ok.dailyRunAccepted, true);
    global.fetch = async () => jsonRes(200, { ok: true, ranked: true, rulesetVersion: 2, campaignVersion: 2 });
    assert.equal(await score.submitDailyRunScore(result, platform, ticket), null);
    global.fetch = async () => jsonRes(409, { ok: false });
    assert.equal(await score.submitDailyRunScore(result, platform, ticket), null);
  });

  // --- (3) resolveDailyResultBranch fail-closed matrix ------------------------------
  await test('resolveDailyResultBranch: resumed wins', () => {
    assert.equal(
      intent.resolveDailyResultBranch({ resumed: true, dailyIntent: null, ticket: null, runSeed: 'x', now: 0 }),
      'resumed'
    );
  });
  await test('resolveDailyResultBranch: no intent -> inactive (ordinary/duel path)', () => {
    assert.equal(
      intent.resolveDailyResultBranch({ resumed: false, dailyIntent: null, ticket: ticket, runSeed: ticket.runSeed, now: 0 }),
      'inactive'
    );
  });
  await test('resolveDailyResultBranch: intent without ticket -> blocked (never ordinary)', () => {
    const branch = intent.resolveDailyResultBranch({ resumed: false, dailyIntent: { runId: 'r' }, ticket: null, runSeed: ticket.runSeed, now: 0 });
    assert.equal(branch, 'blocked');
    assert.notEqual(branch, 'inactive');
    assert.notEqual(branch, 'daily');
  });
  await test('resolveDailyResultBranch: intent with mismatched runId -> blocked', () => {
    assert.equal(
      intent.resolveDailyResultBranch({ resumed: false, dailyIntent: { runId: 'other-run' }, ticket: ticket, runSeed: ticket.runSeed, now: ticket.issuedAt }),
      'blocked'
    );
  });
  await test('resolveDailyResultBranch: intent with mismatched seed -> blocked', () => {
    assert.equal(
      intent.resolveDailyResultBranch({ resumed: false, dailyIntent: { runId: ticket.runId }, ticket: ticket, runSeed: 'wrong', now: 0 }),
      'blocked'
    );
  });
  await test('resolveDailyResultBranch: intent with expired ticket -> blocked', () => {
    assert.equal(
      intent.resolveDailyResultBranch({ resumed: false, dailyIntent: { runId: ticket.runId }, ticket: ticket, runSeed: ticket.runSeed, now: ticket.expiresAt }),
      'blocked'
    );
  });
  await test('resolveDailyResultBranch: intent with matching live ticket -> daily', () => {
    assert.equal(
      intent.resolveDailyResultBranch({ resumed: false, dailyIntent: { runId: ticket.runId }, ticket: ticket, runSeed: ticket.runSeed, now: ticket.issuedAt }),
      'daily'
    );
  });

  // --- (4) checkpoint policy --------------------------------------------------------
  await test('shouldCheckpoint: daily never checkpoints, ordinary always does', () => {
    assert.equal(intent.shouldCheckpoint(true), false);
    assert.equal(intent.shouldCheckpoint(false), true);
  });

  // --- (5) copy exhaustiveness ------------------------------------------------------
  await test('every ticket/submit status maps to a non-empty copy slot', () => {
    const ticketStatuses = ['ok', 'capacity', 'denied', 'http', 'network', 'unavailable'];
    const submitStatuses = ['ok', 'rejected', 'closed', 'expired', 'denied', 'http', 'network', 'unavailable'];
    const ticketCopy = {
      capacity: 'ежедневный забег временно недоступен',
      denied: 'нужен подтверждённый запуск',
      http: 'сервис недоступен',
      network: 'проверьте соединение',
      unavailable: 'нужна идентичность мессенджера',
      ok: '(launches)',
    };
    const submitCopy = {
      ok: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · РЕЗУЛЬТАТ СОХРАНЁН',
      rejected: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · РЕЗУЛЬТАТ НЕ СИНХРОНИЗИРОВАН',
      closed: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · ОКНО РЕЗУЛЬТАТА ЗАКРЫТО',
      expired: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · ВРЕМЯ РЕЗУЛЬТАТА ИСТЕКЛО',
      denied: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · НУЖЕН ПОДТВЕРЖДЁННЫЙ ЗАПУСК',
      http: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · СЕРВИС НЕДОСТУПЕН',
      network: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · ПРОВЕРЬТЕ СОЕДИНЕНИЕ',
      unavailable: 'ЕЖЕДНЕВНЫЙ ЗАБЕГ · НУЖНА ИДЕНТИЧНОСТЬ МЕССЕНДЖЕРА',
    };
    for (const s of ticketStatuses) assert.ok(typeof ticketCopy[s] === 'string' && ticketCopy[s].length > 0, s);
    for (const s of submitStatuses) assert.ok(typeof submitCopy[s] === 'string' && submitCopy[s].length > 0, s);
  });

  // --- (6) no PII / no logging in the intent module --------------------------------
  await test('DailyRunIntent source carries no initData/uid/logging', () => {
    const src = readFileSync(resolve(root, 'src/game/DailyRunIntent.ts'), 'utf8');
    assert.ok(!/initData/.test(src), 'initData referenced');
    assert.ok(!/\buid\b/.test(src), 'uid referenced');
    assert.ok(!/console\./.test(src), 'console logging present');
  });

  if (failures > 0) {
    console.error(`daily cta contract: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('daily cta contract: ok');
} catch (error) {
  fail('setup', error);
} finally {
  rmSync(temp, { recursive: true, force: true });
}