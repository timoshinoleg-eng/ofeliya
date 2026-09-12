#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, text) { writeFileSync(path, text, 'utf8'); }
function replaceOnce(path, before, after) {
  const src = read(path);
  if (!src.includes(before)) throw new Error(`pattern not found in ${path}: ${before.slice(0, 100)}`);
  const next = src.replace(before, after);
  if (next === src) throw new Error(`replacement was a no-op in ${path}`);
  write(path, next);
}

// 1) Score server: UTC day keys, bounded storage, recovery, rate limiting, no-store API responses.
replaceOnce(
  'server/index.mjs',
  "import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';",
  "import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';"
);
replaceOnce(
  'server/index.mjs',
  "const STORE_FILE = join(DATA_DIR, 'store.json');\nconst MAX_SCORES = 20_000;\nconst MAX_REFS = 10_000;",
  "const STORE_FILE = join(DATA_DIR, 'store.json');\nconst STORE_BACKUP_FILE = `${STORE_FILE}.bak`;\nconst MAX_SCORES = 20_000;\nconst MAX_UNVERIFIED_SCORES = 2_000;\nconst MAX_REFS = 10_000;\nconst MAX_REF_REWARDS = 20_000;\nconst SCORE_RATE_WINDOW_MS = 60_000;\nconst SCORE_RATE_LIMIT = 120;"
);
replaceOnce(
  'server/index.mjs',
  `function loadStore() {
  try {
    const raw = readFileSync(STORE_FILE, 'utf8');
    const s = JSON.parse(raw);
    return {
      scores: Array.isArray(s.scores) ? s.scores : [],
      refs: Array.isArray(s.refs) ? s.refs : [],
      refRewards: s.refRewards && typeof s.refRewards === 'object' ? s.refRewards : {},
    };
  } catch {
    return emptyStore();
  }
}

let store = loadStore();
let saveScheduled = false;
function saveStore() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    saveScheduled = false;
    try {
      const tmp = \`${'${STORE_FILE}'}.tmp\`;
      writeFileSync(tmp, JSON.stringify(store));
      renameSync(tmp, STORE_FILE);
    } catch (e) {
      console.error('[store] save failed:', e.message);
    }
  });
}`,
  `function normalizeStore(s) {
  return {
    scores: Array.isArray(s?.scores) ? s.scores : [],
    refs: Array.isArray(s?.refs) ? s.refs : [],
    refRewards: s?.refRewards && typeof s.refRewards === 'object' ? s.refRewards : {},
  };
}

function parseStoreFile(path) {
  return normalizeStore(JSON.parse(readFileSync(path, 'utf8')));
}

function loadStore() {
  if (!existsSync(STORE_FILE)) return emptyStore();
  try {
    return parseStoreFile(STORE_FILE);
  } catch (primaryError) {
    if (existsSync(STORE_BACKUP_FILE)) {
      try {
        const recovered = parseStoreFile(STORE_BACKUP_FILE);
        const corrupt = \`${'${STORE_FILE}'}.corrupt-${'${Date.now()}'}\`;
        renameSync(STORE_FILE, corrupt);
        copyFileSync(STORE_BACKUP_FILE, STORE_FILE);
        console.warn(\`[store] recovered from backup; corrupt primary moved to ${'${corrupt}'}\`);
        return recovered;
      } catch (backupError) {
        throw new Error(\`score store and backup are corrupt: ${'${primaryError.message}'} / ${'${backupError.message}'}\`);
      }
    }
    throw new Error(\`score store is corrupt: ${'${primaryError.message}'}\`);
  }
}

let store = loadStore();
let saveScheduled = false;
function saveStore() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    saveScheduled = false;
    try {
      const tmp = \`${'${STORE_FILE}'}.tmp\`;
      if (existsSync(STORE_FILE)) copyFileSync(STORE_FILE, STORE_BACKUP_FILE);
      writeFileSync(tmp, JSON.stringify(store));
      renameSync(tmp, STORE_FILE);
    } catch (e) {
      console.error('[store] save failed:', e.message);
    }
  });
}`
);
replaceOnce(
  'server/index.mjs',
  "function currentSeason(now = Date.now()) {",
  "function utcDayKey(ts = Date.now()) {\n  return new Date(ts).toISOString().slice(0, 10);\n}\n\nfunction currentSeason(now = Date.now()) {"
);
replaceOnce(
  'server/index.mjs',
  `function compareScores(a, b) {
  if (!!a.win !== !!b.win) return a.win ? -1 : 1;
  if (a.timeMs !== b.timeMs) return a.win ? a.timeMs - b.timeMs : b.timeMs - a.timeMs;
  if (a.kills !== b.kills) return b.kills - a.kills;
  return (b.level ?? 0) - (a.level ?? 0);
}

function bestByUser(entries) {`,
  `function compareScores(a, b) {
  if (!!a.win !== !!b.win) return a.win ? -1 : 1;
  if (a.timeMs !== b.timeMs) return a.win ? a.timeMs - b.timeMs : b.timeMs - a.timeMs;
  if (a.kills !== b.kills) return b.kills - a.kills;
  return (b.level ?? 0) - (a.level ?? 0);
}

function removeOldestScore(predicate) {
  let found = -1;
  let oldest = Infinity;
  for (let i = 0; i < store.scores.length; i += 1) {
    const row = store.scores[i];
    if (!predicate(row)) continue;
    const ts = Number(row.ts) || 0;
    if (ts < oldest) { oldest = ts; found = i; }
  }
  if (found < 0) return false;
  store.scores.splice(found, 1);
  return true;
}

function pruneScores() {
  let unverified = store.scores.reduce((n, row) => n + (row.verified ? 0 : 1), 0);
  while (unverified > MAX_UNVERIFIED_SCORES && removeOldestScore((row) => !row.verified)) unverified -= 1;
  while (store.scores.length > MAX_SCORES) {
    if (!removeOldestScore((row) => !row.verified)) removeOldestScore(() => true);
  }
}

function upsertScore(record) {
  const idx = store.scores.findIndex((row) =>
    row.platform === record.platform &&
    row.uid === record.uid &&
    !!row.daily === !!record.daily &&
    row.dateKey === record.dateKey
  );
  if (idx < 0) store.scores.push(record);
  else if (compareScores(record, store.scores[idx]) < 0) store.scores[idx] = record;
  pruneScores();
}

function pruneRefRewards() {
  const entries = Object.entries(store.refRewards);
  if (entries.length <= MAX_REF_REWARDS) return;
  entries.sort((a, b) => Number(a[1]) - Number(b[1]));
  for (const [key] of entries.slice(0, entries.length - MAX_REF_REWARDS)) delete store.refRewards[key];
}

const scoreRateBuckets = new Map();
function allowScoreRequest(req, now = Date.now()) {
  const forwarded = Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'][0]
    : req.headers['x-forwarded-for'];
  const key = String(forwarded || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  let bucket = scoreRateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= SCORE_RATE_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    scoreRateBuckets.set(key, bucket);
  }
  if (bucket.count >= SCORE_RATE_LIMIT) return false;
  bucket.count += 1;
  if (scoreRateBuckets.size > 5000) {
    for (const [ip, value] of scoreRateBuckets) {
      if (now - value.startedAt >= SCORE_RATE_WINDOW_MS) scoreRateBuckets.delete(ip);
    }
  }
  return true;
}

function bestByUser(entries) {`
);
replaceOnce(
  'server/index.mjs',
  `function getTop({ period = 'all', platform, includeUnverified = false } = {}) {
  const now = Date.now();
  const dayKey = (ts) => {
    const d = new Date(ts);
    return \`${'${d.getFullYear()}'}-${'${String(d.getMonth() + 1).padStart(2, \'0\')}'}-${'${String(d.getDate()).padStart(2, \'0\')}'}\`;
  };
  const today = dayKey(now);`,
  `function getTop({ period = 'all', platform, includeUnverified = false } = {}) {
  const now = Date.now();
  const today = utcDayKey(now);`
);
replaceOnce(
  'server/index.mjs',
  `// V4: «общий» результат дня — «ты №7 из 412 сегодня».
// «Сегодня» = dateKey собственного daily-скор игрока (его локальный день).
// Считаем по ВСЕМ daily-сорам за этот день (verified + unverified) — это
// социальное сравнение за день, а не постоянный лидерборд (сбросится завтра).
function dailyStats(user, platform) {
  const mine = bestByUser(
    store.scores.filter((s) => s.platform === platform && s.uid === user && s.daily)
  );
  if (mine.length === 0) return { dateKey: null, total: 0, rank: null, you: null };
  const today = mine[0].dateKey;
  const daily = store.scores.filter((s) => s.daily && s.dateKey === today);`,
  `// V4: «общий» результат дня — «ты №7 из 412 сегодня».
// День определяется сервером в UTC: клиент не может подменить dateKey, а
// результат прошлого дня никогда не подставляется вместо сегодняшнего.
function dailyStats(user, platform, now = Date.now()) {
  const today = utcDayKey(now);
  const mine = bestByUser(
    store.scores.filter((s) => s.platform === platform && s.uid === user && s.daily && s.dateKey === today)
  );
  if (mine.length === 0) return { dateKey: today, total: 0, rank: null, you: null };
  const daily = store.scores.filter((s) => s.daily && s.dateKey === today);`
);
replaceOnce(
  'server/index.mjs',
  `    'Access-Control-Allow-Headers': 'Content-Type',
  });`,
  `    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });`
);
replaceOnce(
  'server/index.mjs',
  `    if (req.method === 'POST' && url.pathname === '/api/score') {
      const body = await readBody(req);`,
  `    if (req.method === 'POST' && url.pathname === '/api/score') {
      if (!allowScoreRequest(req)) return send(res, 429, { ok: false, error: 'rate limited' });
      const body = await readBody(req);`
);
replaceOnce(
  'server/index.mjs',
  `      const dateKey =
        typeof payload.dateKey === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(payload.dateKey)
          ? payload.dateKey
          : new Date().toISOString().slice(0, 10);
      const record = {`,
  `      const now = Date.now();
      const dateKey = utcDayKey(now);
      const record = {`
);
replaceOnce('server/index.mjs', '        ts: Date.now(),', '        ts: now,');
replaceOnce(
  'server/index.mjs',
  `      store.scores.push(record);
      if (store.scores.length > MAX_SCORES) store.scores.splice(0, store.scores.length - MAX_SCORES);`,
  `      upsertScore(record);`
);
replaceOnce(
  'server/index.mjs',
  `            store.refRewards[edgeKey] = record.ts;
            refReward = { from: ref.key, to: toKey, first: true };`,
  `            store.refRewards[edgeKey] = record.ts;
            pruneRefRewards();
            refReward = { from: ref.key, to: toKey, first: true };`
);
replaceOnce(
  'server/index.mjs',
  `        store.refRewards[edgeKey] = Date.now();
        first = true;`,
  `        store.refRewards[edgeKey] = Date.now();
        pruneRefRewards();
        first = true;`
);
replaceOnce(
  'server/index.mjs',
  `  } catch (e) {
    return send(res, 500, { ok: false, error: e.message ?? 'server error' });
  }`,
  `  } catch (e) {
    console.error('[http] request failed:', e?.stack ?? e);
    return send(res, 500, { ok: false, error: 'internal server error' });
  }`
);

// 2) Restore same-prefix score client and submit every completed run fire-and-forget.
write('src/systems/ServerClient.ts', `import { PlatformBridge, type PlatformKind } from '../platform';

const EXPLICIT_BASE = ((import.meta.env.VITE_SERVER_URL as string | undefined) ?? '').replace(/\\/+$/, '');
const TIMEOUT_MS = 4000;
const ANON_KEY = 'ofeliya_anon_id';

function requestUrl(path: string): string {
  const clean = path.replace(/^\\/+/, '');
  if (EXPLICIT_BASE) return \`${'${EXPLICIT_BASE}'}/${'${clean}'}\`;
  return new URL(clean, document.baseURI).toString();
}

function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      id = 'anon-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return 'anon-fallback';
  }
}

function authBody(): { platform: PlatformKind; initData?: string; anonId?: string } {
  const platform = PlatformBridge.kind;
  if (platform === 'browser') return { platform, anonId: anonId() };
  return { platform, initData: PlatformBridge.initData };
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const ctrl = new AbortController();
  const timeout = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(requestUrl(path), {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface ScorePayload {
  daily: boolean;
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  ref?: string | null;
}

export const ServerClient = {
  submitScore(payload: ScorePayload): Promise<{ rank: number | null } | null> {
    return request<{ ok: boolean; rank: number | null }>('/api/score', {
      method: 'POST',
      body: JSON.stringify({ ...authBody(), payload }),
    }).then((result) => (result?.ok ? { rank: result.rank } : null));
  },
  getTop(period: 'all' | 'daily' | 'weekly' | 'season' = 'all') {
    return request<{ ok: boolean; top: unknown[] }>(\`/api/top?period=${'${period}'}\`)
      .then((result) => (result?.ok ? result.top : null));
  },
};
`);
replaceOnce(
  'src/scenes/GameScene.ts',
  "import { SaveSystem } from '../systems/SaveSystem';\nimport { Sfx } from '../systems/Sfx';",
  "import { SaveSystem } from '../systems/SaveSystem';\nimport { ServerClient } from '../systems/ServerClient';\nimport { Sfx } from '../systems/Sfx';"
);
replaceOnce(
  'src/scenes/GameScene.ts',
  `      records,
    });
    Sfx.play(win ? 'victory' : 'gameover');`,
  `      records,
    });
    void ServerClient.submitScore({
      daily: false,
      win,
      timeMs: Math.round(st.timeMs),
      kills: st.kills,
      level: st.level,
    });
    Sfx.play(win ? 'victory' : 'gameover');`
);

// 3) Shared production has no Ofeliya webhook route. Dedicated bot keeps an explicit optional snippet.
replaceOnce(
  'deploy/Caddyfile.ofeliya',
  `@ofeliya_webhook path /ofeliya/bot/webhook
handle @ofeliya_webhook {
  request_body {
    max_size 64KB
  }
  header -Server
  reverse_proxy ofeliya-bot:8788
}

`,
  `# Shared MAX bot mode: Hub/Quizika is the only webhook owner. Do not proxy
# /ofeliya/bot/webhook here; dedicated mode must opt in to the separate snippet.

`
);
write('deploy/Caddyfile.ofeliya-dedicated-bot', `# Optional snippet for OFELIYA_BOT_MODE=dedicated only.
@ofeliya_webhook path /ofeliya/bot/webhook
handle @ofeliya_webhook {
  request_body {
    max_size 64KB
  }
  header -Server
  reverse_proxy ofeliya-bot:8788
}
`);

// 4) Make score token/origin explicit in Compose (includes the useful hardening from PR #34).
replaceOnce(
  'deploy/compose.production.yml',
  `    environment:
      NODE_ENV: production
      PORT: 8787
    env_file:`,
  `    environment:
      NODE_ENV: production
      PORT: 8787
      OFELIYA_BOT_TOKEN: ${'${OFELIYA_BOT_TOKEN:?OFELIYA_BOT_TOKEN is required}'}
      ALLOW_ORIGIN: ${'${OFELIYA_ALLOW_ORIGIN:-https://quiz.chatbot24.su}'}
    env_file:`
);
replaceOnce(
  'deploy/ofeliya.env.example',
  `# Public Mini App URL configured for this bot in MAX.
OFELIYA_GAME_URL=https://games.example.ru/ofeliya/`,
  `# Public Mini App URL configured for this bot in MAX.
OFELIYA_GAME_URL=https://games.example.ru/ofeliya/
OFELIYA_ALLOW_ORIGIN=https://quiz.chatbot24.su`
);

// 5) Portable startup smoke: reserve an ephemeral port instead of Vite's 5173 fallback.
replaceOnce(
  'tests/startup-font-timeout.mjs',
  "import { readFile } from 'node:fs/promises';",
  "import { readFile } from 'node:fs/promises';"
);
replaceOnce(
  'tests/startup-font-timeout.mjs',
  `const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;`,
  `const probe = await import('node:net').then(({ createServer }) => createServer());
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const freePort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const server = await createServer({ server: { host: '127.0.0.1', port: freePort, strictPort: true } });
let browser;`
);

// 6) Retire stale deployment contract in favor of the active one.
write('scripts/check-deploy-contract.mjs', `#!/usr/bin/env node
// Backward-compatible entrypoint. The authoritative production contract is
// check-max-rc-production.mjs; keep one source of truth so this script cannot rot.
await import('./check-max-rc-production.mjs');
`);

// 7) Regression tests for UTC and client date spoofing.
replaceOnce(
  'server/test.mjs',
  `  const dk = () => {
    const d = new Date(now);
    return \`${'${d.getFullYear()}'}-${'${String(d.getMonth() + 1).padStart(2, \'0\')}'}-${'${String(d.getDate()).padStart(2, \'0\')}'}\`;
  };`,
  `  const dk = () => new Date(now).toISOString().slice(0, 10);`
);
replaceOnce(
  'server/test.mjs',
  `await ok('top weekly: результаты за 7 дней', async () => {`,
  `await ok('daily: клиентский dateKey не может подменить серверный UTC-день', async () => {
  const body = {
    platform: 'browser', anonId: 'anon-date-spoof-1234',
    payload: { daily: true, win: false, timeMs: 90_000, kills: 30, level: 3, dateKey: '1999-01-01' },
  };
  await j(await fetch(\`${'${BASE}'}/api/score\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const daily = await j(await fetch(\`${'${BASE}'}/api/top?period=daily&includeUnverified=1\`));
  const expected = new Date().toISOString().slice(0, 10);
  assert.ok(daily.top.some((row) => row.dateKey === expected));
  assert.ok(!daily.top.some((row) => row.dateKey === '1999-01-01'));
});

await ok('score storage: повтор пользователя в тот же день делает upsert, а не append', async () => {
  const before = await j(await fetch(\`${'${BASE}'}/health\`));
  await j(await fetch(\`${'${BASE}'}/api/score\`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'telegram', initData: signInitData(ALICE, TG_TOKEN),
      payload: { win: false, timeMs: 60_000, kills: 10, level: 2, daily: false },
    }),
  }));
  const after = await j(await fetch(\`${'${BASE}'}/health\`));
  assert.equal(after.scores, before.scores);
});

await ok('top weekly: результаты за 7 дней', async () => {`
);

// 8) Update active production contract for all remediations.
replaceOnce(
  'scripts/check-max-rc-production.mjs',
  "const main = read('src/main.ts');",
  "const main = read('src/main.ts');\nconst gameScene = read('src/scenes/GameScene.ts');\nconst serverClient = read('src/systems/ServerClient.ts');\nconst dedicatedCaddy = read('deploy/Caddyfile.ofeliya-dedicated-bot');\nconst scoreServer = read('server/index.mjs');"
);
replaceOnce(
  'scripts/check-max-rc-production.mjs',
  `assert.match(caddy, /handle_path \\/ofeliya\\/\\*/, 'Ofeliya must own /ofeliya/ namespace');
assert.doesNotMatch(caddy, /handle_path \\/hub\\/\\*/, 'Ofeliya must not claim Hub routes');`,
  `assert.match(caddy, /handle_path \\/ofeliya\\/\\*/, 'Ofeliya must own /ofeliya/ namespace');
assert.doesNotMatch(caddy, /handle_path \\/hub\\/\\*/, 'Ofeliya must not claim Hub routes');
assert.doesNotMatch(caddy, /ofeliya_webhook|ofeliya-bot:8788/, 'shared Caddy must not route a second Ofeliya webhook');
assert.match(dedicatedCaddy, /reverse_proxy ofeliya-bot:8788/, 'dedicated webhook must remain an explicit opt-in snippet');`
);
replaceOnce(
  'scripts/check-max-rc-production.mjs',
  `assert.match(compose, /OFELIYA_SHARED_NETWORK/, 'compose must use Ofeliya network variable');`,
  `assert.match(compose, /OFELIYA_SHARED_NETWORK/, 'compose must use Ofeliya network variable');
assert.match(compose, /OFELIYA_BOT_TOKEN:\\s*\\$\\{OFELIYA_BOT_TOKEN:\\?/, 'score must receive the resolved shared/dedicated MAX token explicitly');
assert.match(compose, /ALLOW_ORIGIN:\\s*\\$\\{OFELIYA_ALLOW_ORIGIN:-https:\\/\\/quiz[.]chatbot24[.]su\\}/, 'score CORS must default to the production origin');
assert.match(serverClient, /new URL\\(clean, document[.]baseURI\\)/, 'score client must keep the /ofeliya/ deployment prefix');
assert.match(gameScene, /ServerClient[.]submitScore/, 'completed runs must be submitted to score-server');
assert.match(scoreServer, /function utcDayKey/, 'score server must use one UTC day key');
assert.match(scoreServer, /function upsertScore/, 'score storage must upsert per user/day instead of append-only growth');
assert.match(scoreServer, /MAX_UNVERIFIED_SCORES/, 'unverified scores must have an independent storage cap');`
);

console.log('audit remediation applied');
