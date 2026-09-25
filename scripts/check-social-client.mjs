import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-social-client-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/SocialClient.ts',
      'src/platform/PlatformBridge.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { socialIdentity, socialRequestPaths, loadSocialSnapshot, loadSocialSnapshotDetailed } =
    require(join(temp, 'systems/SocialClient.js'));
  const platform = (kind, id) => ({
    kind,
    available: true,
    platform: kind,
    version: '',
    initData: 'signed-test-data',
    getUser: () => (id == null ? null : { id }),
    getDisplayName: () => null,
    getStartParam: () => null,
    buildStartLink: () => null,
    getViewportSize: async () => null,
    setBackHandler: () => {},
    shareResult: async () => false,
    haptic: () => {},
    notify: () => {},
  });

  assert.deepEqual(socialIdentity(platform('telegram', 123)), {
    platform: 'telegram',
    user: '123',
  });
  assert.equal(socialIdentity(platform('browser', 'anon')), null);

  const paths = socialRequestPaths(platform('max', 'abc-1'));
  assert.equal(paths.season, 'api/season');
  assert.equal(paths.seasonTop, 'api/top?period=season');
  assert.equal(paths.daily, 'api/daily');
  assert.equal(paths.friends, 'api/friends');

  const browserPaths = socialRequestPaths(platform('browser', 'anon'));
  assert.equal(browserPaths.daily, null);
  assert.equal(browserPaths.friends, null);

  // --- detailed remote status contract ---
  const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const routeByPath = (routes) => (url) => {
    const key = Object.keys(routes).find((needle) => url.includes(needle));
    if (!key) throw new Error(`unexpected url: ${url}`);
    const route = routes[key];
    if (route && route.reject) throw new Error('network down');
    return route;
  };

  const season = { index: 3, start: 1, end: 2, daysLeft: 5 };
  const top = [
    {
      rank: 1,
      platform: 'telegram',
      daily: true,
      win: true,
      timeMs: 1000,
      kills: 2,
      level: 3,
      dateKey: '2026-09-22',
      rulesetVersion: 2,
      campaignVersion: 2,
      difficultyId: 'standard',
      completionStage: null,
    },
  ];
  const daily = { dateKey: '2026-09-22', total: 10, rank: 2, you: null };
  const friends = [
    {
      relation: 'invited',
      platform: 'telegram',
      win: false,
      timeMs: 5,
      kills: 1,
      level: 2,
      dateKey: '2026-09-22',
    },
  ];
  const identity = platform('telegram', 123);

  // ok: valid documented shape carrying records
  global.fetch = async (url) =>
    routeByPath({
      'api/season': jsonResponse(200, { ok: true, season }),
      'api/top': jsonResponse(200, { ok: true, top }),
      'api/daily': jsonResponse(200, { ok: true, ...daily }),
      'api/friends': jsonResponse(200, { ok: true, friends }),
    })(String(url));
  const detailedOk = await loadSocialSnapshotDetailed(identity);
  assert.deepEqual(detailedOk.status, {
    season: 'ok',
    seasonTop: 'ok',
    daily: 'ok',
    friends: 'ok',
  });
  assert.deepEqual(detailedOk.snapshot.season, season);
  assert.deepEqual(detailedOk.snapshot.seasonTop, top);
  assert.deepEqual(detailedOk.snapshot.daily, { ok: true, ...daily });
  assert.deepEqual(detailedOk.snapshot.friends, friends);

  // legacy loader must stay identical to the detailed snapshot
  const legacySnapshot = await loadSocialSnapshot(identity);
  assert.deepEqual(legacySnapshot, detailedOk.snapshot);

  // empty: valid documented 2xx shape with no records -> 'empty'
  global.fetch = async (url) =>
    routeByPath({
      'api/season': jsonResponse(200, { ok: true }),
      'api/top': jsonResponse(200, { ok: true, top: [] }),
      'api/daily': jsonResponse(200, { ok: true, dateKey: null, total: 0, rank: null, you: null }),
      'api/friends': jsonResponse(200, { ok: true, friends: [] }),
    })(String(url));
  const detailedEmpty = await loadSocialSnapshotDetailed(identity);
  assert.deepEqual(detailedEmpty.status, {
    season: 'empty',
    seasonTop: 'empty',
    daily: 'empty',
    friends: 'empty',
  });

  // malformed / ok:false 2xx must NOT be reported as empty -> closest error status
  global.fetch = async (url) =>
    routeByPath({
      'api/season': jsonResponse(200, { ok: true, season: { index: 'bad', start: 1, end: 2, daysLeft: 5 } }),
      'api/top': jsonResponse(200, { ok: true, top: [{}] }),
      'api/daily': jsonResponse(200, { ok: true, dateKey: '2026-09-22', total: 'bad', rank: null, you: null }),
      'api/friends': jsonResponse(200, { ok: true, friends: [{}] }),
    })(String(url));
  const detailedMalformed = await loadSocialSnapshotDetailed(identity);
  assert.deepEqual(detailedMalformed.status, {
    season: 'http',
    seasonTop: 'http',
    daily: 'http',
    friends: 'http',
  });

  // http: non-2xx
  global.fetch = async () => jsonResponse(500, {});
  const detailedHttp = await loadSocialSnapshotDetailed(identity);
  assert.deepEqual(detailedHttp.status, {
    season: 'http',
    seasonTop: 'http',
    daily: 'http',
    friends: 'http',
  });

  // malformed JSON after a successful HTTP response is an HTTP payload error, not a network error
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('bad json'); },
  });
  const detailedBadJson = await loadSocialSnapshotDetailed(identity);
  assert.deepEqual(detailedBadJson.status, {
    season: 'http',
    seasonTop: 'http',
    daily: 'http',
    friends: 'http',
  });

  // network: fetch rejects
  global.fetch = async () => {
    throw new Error('boom');
  };
  const detailedNetwork = await loadSocialSnapshotDetailed(identity);
  assert.deepEqual(detailedNetwork.status, {
    season: 'network',
    seasonTop: 'network',
    daily: 'network',
    friends: 'network',
  });

  // skipped: identity precondition unmet -> daily/friends never attempted
  const attempted = [];
  global.fetch = async (url) => {
    attempted.push(String(url));
    return routeByPath({
      'api/season': jsonResponse(200, { ok: true, season }),
      'api/top': jsonResponse(200, { ok: true, top }),
    })(String(url));
  };
  const detailedSkipped = await loadSocialSnapshotDetailed(platform('browser', 'anon'));
  assert.deepEqual(detailedSkipped.status, {
    season: 'ok',
    seasonTop: 'ok',
    daily: 'skipped',
    friends: 'skipped',
  });
  assert.ok(attempted.every((u) => !u.includes('api/daily') && !u.includes('api/friends')));

  console.log('social client contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
