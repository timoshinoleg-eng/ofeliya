#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const write = (p, s) => writeFileSync(p, s);

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`missing patch anchor: ${label}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`ambiguous patch anchor: ${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

// ---- client share/referral contract ----
{
  const p = 'src/game/share.ts';
  let s = read(p);
  s = s.replace(
    "import { MessengerBridge } from '../systems/MessengerBridge';",
    "import { MessengerBridge, type MessengerKind } from '../systems/MessengerBridge';"
  );
  s = replaceOnce(
    s,
    `/** Заполнить username ботов перед публикацией (см. README «Публикация»). */\nexport const SHARE = {\n  maxBot: '',\n  tgBot: '',\n} as const;`,
    `const botUsername = (value: string | undefined): string =>\n  (value ?? '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9_.-]/g, '');\n\n/** Username ботов приходит из build env; секретом не является. */\nexport const SHARE = {\n  maxBot: botUsername(import.meta.env.VITE_MAX_BOT_USERNAME as string | undefined),\n  tgBot: botUsername(import.meta.env.VITE_TG_BOT_USERNAME as string | undefined),\n} as const;\n\nconst REF_PLATFORM_CODE: Record<MessengerKind, string> = {\n  max: 'm',\n  telegram: 't',\n  vk: 'v',\n  browser: 'b',\n};\n\nexport function buildReferralToken(kind: MessengerKind, uid: string): string | null {\n  const clean = uid.trim();\n  if (!/^[A-Za-z0-9-]{1,48}$/.test(clean)) return null;\n  return \`\${REF_PLATFORM_CODE[kind]}_\${clean}\`;\n}`,
    'share config'
  );
  s = replaceOnce(
    s,
    `/**\n * Реферальная ссылка (V1): открывает игру со startapp-параметром \`ref_<uid>\`.\n * Новый игрок получает бонус на первый забег; рёбро фиксируется на сервере.\n */\nexport function buildRefLink(uid: string): string | undefined {\n  const param = \`ref_\${uid}\`;\n  const kind = MessengerBridge.kind;\n  if (kind === 'max' && SHARE.maxBot) {\n    return \`https://max.ru/\${SHARE.maxBot}?startapp=\${param}\`;\n  }\n  if (kind === 'telegram' && SHARE.tgBot) {\n    return \`https://t.me/\${SHARE.tgBot}?startapp=\${param}\`;\n  }\n  if (typeof location !== 'undefined' && location.origin.startsWith('http')) {\n    return \`\${location.origin}\${location.pathname}?ref=\${uid}\`;\n  }\n  return undefined;\n}`,
    `/**\n * Реферальная ссылка V2: payload \`ref_<platformCode>_<uid>\`.\n * Платформа referrer'а сохраняется в payload, чтобы MAX id никогда не\n * интерпретировался как Telegram chat id. Старые \`ref_<uid>\` сервер принимает\n * как legacy, но без outbound push.\n */\nexport function buildRefLink(uid: string): string | undefined {\n  const kind = MessengerBridge.kind;\n  const token = buildReferralToken(kind, uid);\n  if (!token) return undefined;\n  const param = \`ref_\${token}\`;\n  if (kind === 'max' && SHARE.maxBot) {\n    return \`https://max.ru/\${SHARE.maxBot}?startapp=\${param}\`;\n  }\n  if (kind === 'telegram' && SHARE.tgBot) {\n    return \`https://t.me/\${SHARE.tgBot}?startapp=\${param}\`;\n  }\n  if (typeof location !== 'undefined' && location.origin.startsWith('http')) {\n    return \`\${location.origin}\${location.pathname}?ref=\${encodeURIComponent(param)}\`;\n  }\n  return undefined;\n}`,
    'ref link v2'
  );
  write(p, s);
}

// ---- client API types: public responses contain no raw platform uid ----
{
  const p = 'src/systems/ServerClient.ts';
  let s = read(p);
  s = s.replace('/** uid друга, по чьей ссылке пришли (ref_<uid>) */', '/** referral token: new format <platformCode>_<uid>, legacy bare uid also accepted */');
  s = replaceOnce(s, `  platform: string;\n  uid: string;\n  daily: boolean;`, `  platform: string;\n  daily: boolean;`, 'TopEntry raw uid');
  s = s.replace(
    `Promise<Array<{ relation: string; uid: string; platform: string; win: boolean; timeMs: number; kills: number; level: number; dateKey: string }> | null>`,
    `Promise<Array<{ relation: string; platform: string; win: boolean; timeMs: number; kills: number; level: number; dateKey: string }> | null>`
  );
  s = s.replace(
    `as Array<{ relation: string; uid: string; platform: string; win: boolean; timeMs: number; kills: number; level: number; dateKey: string }>`,
    `as Array<{ relation: string; platform: string; win: boolean; timeMs: number; kills: number; level: number; dateKey: string }>`
  );
  write(p, s);
}

// ---- score server: platform-aware refs + privacy-safe public payloads ----
{
  const p = 'server/index.mjs';
  let s = read(p);
  s = replaceOnce(
    s,
    `function antiCheatCheck(p) {\n  if (!Number.isFinite(p.timeMs) || p.timeMs < 1000 || p.timeMs > ANTI_CHEAT.maxTimeMs) return 'time';\n  if (p.win === true && p.timeMs < ANTI_CHEAT.minWinTimeMs) return 'win-time';\n  if (!Number.isFinite(p.kills) || p.kills < 0 || p.kills > ANTI_CHEAT.maxKillsPerSec * (p.timeMs / 1000)) return 'kills';\n  if (!Number.isFinite(p.level) || p.level < 1 || p.level > ANTI_CHEAT.maxLevel) return 'level';\n  return null;\n}`,
    `function antiCheatCheck(p) {\n  if (!Number.isFinite(p.timeMs) || p.timeMs < 1000 || p.timeMs > ANTI_CHEAT.maxTimeMs) return 'time';\n  if (p.win === true && p.timeMs < ANTI_CHEAT.minWinTimeMs) return 'win-time';\n  if (!Number.isFinite(p.kills) || p.kills < 0 || p.kills > ANTI_CHEAT.maxKillsPerSec * (p.timeMs / 1000)) return 'kills';\n  if (!Number.isFinite(p.level) || p.level < 1 || p.level > ANTI_CHEAT.maxLevel) return 'level';\n  return null;\n}\n\nconst REF_PLATFORM_CODES = { t: 'telegram', m: 'max', b: 'browser', v: 'vk' };\nconst KNOWN_PLATFORMS = new Set(Object.values(REF_PLATFORM_CODES));\n\nfunction parseReferralRef(raw) {\n  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 64) return null;\n  const modern = /^([tmbv])_([A-Za-z0-9-]{1,48})$/.exec(raw);\n  if (modern) {\n    const platform = REF_PLATFORM_CODES[modern[1]];\n    return { token: raw, platform, uid: modern[2], key: \`\${platform}:\${modern[2]}\`, legacy: false };\n  }\n  // Backward compatibility for links already shared before referral V2.\n  if (/^[A-Za-z0-9-]{1,64}$/.test(raw)) {\n    return { token: raw, platform: null, uid: raw, key: raw, legacy: true };\n  }\n  return null;\n}\n\nfunction parseStoredIdentity(raw) {\n  const value = String(raw ?? '');\n  const split = value.indexOf(':');\n  if (split > 0) {\n    const platform = value.slice(0, split);\n    const uid = value.slice(split + 1);\n    if (KNOWN_PLATFORMS.has(platform) && uid) return { platform, uid, key: value };\n  }\n  return value ? { platform: null, uid: value, key: value } : null;\n}`,
    'ref parser'
  );
  s = replaceOnce(
    s,
    `/**\n * Telegram: когда приглашённый завершает первый забег по реф-ссылке,\n * шлём referrer'у сообщение «твой ход» (Bot API sendMessage, fire-and-forget).\n * Работает только для TG-рефереров (uid — числовой chat id). MAX — TODO-V7\n * (webhook-бот после получения токена).\n */\nasync function notifyReferrer(fromUid) {\n  if (!TG_TOKEN) return;\n  if (!/^\\d+$/.test(fromUid)) return; // только TG-uid (chat id)`,
    `/**\n * Outbound push разрешён только когда referral V2 криптографически не доказывает,\n * но явно сохраняет исходную платформу. Legacy bare uid никогда не пушим:\n * числовой MAX id нельзя ошибочно отправить как Telegram chat_id.\n */\nasync function notifyReferrer(ref) {\n  if (!TG_TOKEN || !ref || ref.platform !== 'telegram') return;\n  const fromUid = ref.uid;\n  if (!/^\\d+$/.test(fromUid)) return;`,
    'notify platform guard'
  );
  s = replaceOnce(
    s,
    `function getTop({ period = 'all', platform, includeUnverified = false } = {}) {`,
    `function publicTop(list) {\n  return list.map(({ uid, ...row }) => row);\n}\n\nfunction getTop({ period = 'all', platform, includeUnverified = false } = {}) {`,
    'public top sanitizer'
  );
  s = replaceOnce(
    s,
    `        ref: typeof payload.ref === 'string' ? payload.ref.slice(0, 64) : null,`,
    `        ref: parseReferralRef(payload.ref)?.token ?? null,`,
    'score referral validation'
  );
  s = replaceOnce(
    s,
    `      // Реферал: записываем рёбро и разовую награду.\n      let refReward = null;\n      if (record.ref) {\n        const edgeKey = \`\${record.ref}>\${platform}:\${uid}\`;\n        if (!store.refs.some((r) => r.edge === edgeKey)) {\n          store.refs.push({ edge: edgeKey, from: record.ref, to: \`\${platform}:\${uid}\`, ts: record.ts });\n          if (store.refs.length > MAX_REFS) store.refs.splice(0, store.refs.length - MAX_REFS);\n        }\n        if (!store.refRewards[edgeKey]) {\n          store.refRewards[edgeKey] = record.ts;\n          refReward = { from: record.ref, to: \`\${platform}:\${uid}\`, first: true };\n          // V7: push referrer'у «твой ход» (best effort, не блокирует ответ).\n          void notifyReferrer(record.ref);\n        }\n      }`,
    `      // Реферал V2: from хранится как platform:uid. Legacy bare uid остаётся\n      // читаемым, но не получает outbound push из-за неоднозначной платформы.\n      let refReward = null;\n      const ref = parseReferralRef(record.ref);\n      if (ref) {\n        const toKey = \`\${platform}:\${uid}\`;\n        const selfReferral = ref.uid === uid && (!ref.platform || ref.platform === platform);\n        if (!selfReferral) {\n          const edgeKey = \`\${ref.key}>\${toKey}\`;\n          if (!store.refs.some((r) => r.edge === edgeKey)) {\n            store.refs.push({ edge: edgeKey, from: ref.key, to: toKey, ts: record.ts });\n            if (store.refs.length > MAX_REFS) store.refs.splice(0, store.refs.length - MAX_REFS);\n          }\n          if (!store.refRewards[edgeKey]) {\n            store.refRewards[edgeKey] = record.ts;\n            refReward = { from: ref.key, to: toKey, first: true };\n            void notifyReferrer(ref);\n          }\n        }\n      }`,
    'referral edge v2'
  );
  s = replaceOnce(
    s,
    `      const top = getTop({ period: record.daily ? 'daily' : 'all' });\n      const rank = top.find((t) => t.uid === uid && t.platform === platform)?.rank ?? null;\n      return send(res, 200, { ok: true, rank, top, refReward });`,
    `      const top = getTop({ period: record.daily ? 'daily' : 'all' });\n      const rank = top.find((t) => t.uid === uid && t.platform === platform)?.rank ?? null;\n      return send(res, 200, { ok: true, rank, top: publicTop(top), refReward });`,
    'score response privacy'
  );
  s = replaceOnce(
    s,
    `      return send(res, 200, { ok: true, top, period, season: currentSeason() });`,
    `      return send(res, 200, { ok: true, top: publicTop(top), period, season: currentSeason() });`,
    'top response privacy'
  );
  s = replaceOnce(
    s,
    `    if (req.method === 'GET' && url.pathname === '/api/ref') {\n      const user = url.searchParams.get('user') ?? '';\n      const platform = url.searchParams.get('platform') ?? '';\n      const mine = store.refs.filter((r) => r.from === user).length;\n      return send(res, 200, { ok: true, user, platform, invited: mine });\n    }`,
    `    if (req.method === 'GET' && url.pathname === '/api/ref') {\n      const user = (url.searchParams.get('user') ?? '').slice(0, 64);\n      const platform = (url.searchParams.get('platform') ?? '').toLowerCase();\n      if (!user || !KNOWN_PLATFORMS.has(platform)) {\n        return send(res, 400, { ok: false, error: 'bad request' });\n      }\n      const meKey = \`\${platform}:\${user}\`;\n      const mine = store.refs.filter((r) => {\n        const from = parseStoredIdentity(r.from);\n        return r.from === meKey || (from?.platform == null && from?.uid === user);\n      }).length;\n      return send(res, 200, { ok: true, platform, invited: mine });\n    }`,
    'ref stats v2'
  );
  const oldFriends = `    // V2: топ друзей по реферальным рёбрам (двунаправленно: кого позвал + кто позвал).\n    if (req.method === 'GET' && url.pathname === '/api/friends') {\n      const user = url.searchParams.get('user') ?? '';\n      const platform = url.searchParams.get('platform') ?? '';\n      if (!user) return send(res, 400, { ok: false, error: 'no user' });\n\n      const friends = new Map(); // uid -> relation\n      for (const r of store.refs) {\n        if (r.from === user) {\n          const toUid = String(r.to).split(':').slice(1).join(':');\n          if (toUid) friends.set(toUid, friends.has(toUid) ? 'both' : 'invited');\n        }\n        if (platform && r.to === \`\${platform}:\${user}\`) {\n          if (r.from) friends.set(r.from, friends.has(r.from) ? 'both' : 'inviter');\n        }\n      }\n\n      // лучший скор каждого друга (по uid, любая платформа)\n      const out = [];\n      for (const [uid, relation] of friends) {\n        let best = null;\n        for (const s of store.scores) {\n          if (s.uid !== uid) continue;\n          if (!best || compareScores(s, best) < 0) best = s;\n        }\n        if (best) {\n          out.push({\n            relation,\n            uid,\n            platform: best.platform,\n            win: !!best.win,\n            timeMs: best.timeMs,\n            kills: best.kills,\n            level: best.level,\n            dateKey: best.dateKey,\n          });\n        }\n      }\n      out.sort(compareScores);\n      return send(res, 200, { ok: true, user, platform, friends: out.slice(0, 10) });\n    }`;
  const newFriends = `    // V2/V2-ref: friend graph keeps platform identity internally but public\n    // response omits raw uid. Legacy bare ref ids remain readable.\n    if (req.method === 'GET' && url.pathname === '/api/friends') {\n      const user = (url.searchParams.get('user') ?? '').slice(0, 64);\n      const platform = (url.searchParams.get('platform') ?? '').toLowerCase();\n      if (!user || !KNOWN_PLATFORMS.has(platform)) {\n        return send(res, 400, { ok: false, error: 'bad request' });\n      }\n      const meKey = \`\${platform}:\${user}\`;\n      const friends = new Map(); // identity -> { platform, uid, relation }\n      const addFriend = (identity, relation) => {\n        if (!identity?.uid) return;\n        const key = identity.key;\n        const prev = friends.get(key);\n        friends.set(key, { ...identity, relation: prev && prev.relation !== relation ? 'both' : relation });\n      };\n\n      for (const r of store.refs) {\n        const from = parseStoredIdentity(r.from);\n        const to = parseStoredIdentity(r.to);\n        const legacyFromMe = from?.platform == null && from?.uid === user;\n        if (r.from === meKey || legacyFromMe) addFriend(to, 'invited');\n        if (r.to === meKey) addFriend(from, 'inviter');\n      }\n\n      const out = [];\n      for (const friend of friends.values()) {\n        let best = null;\n        for (const score of store.scores) {\n          if (score.uid !== friend.uid) continue;\n          if (friend.platform && score.platform !== friend.platform) continue;\n          if (!best || compareScores(score, best) < 0) best = score;\n        }\n        if (best) {\n          out.push({\n            relation: friend.relation,\n            platform: best.platform,\n            win: !!best.win,\n            timeMs: best.timeMs,\n            kills: best.kills,\n            level: best.level,\n            dateKey: best.dateKey,\n          });\n        }\n      }\n      out.sort(compareScores);\n      return send(res, 200, { ok: true, platform, friends: out.slice(0, 10) });\n    }`;
  s = replaceOnce(s, oldFriends, newFriends, 'friends privacy/ref v2');
  write(p, s);
}

// ---- server tests: public uid redaction + platform-aware referral ----
{
  const p = 'server/test.mjs';
  let s = read(p);
  s = replaceOnce(
    s,
    `  const aliceRows = top.top.filter((t) => t.uid === '111');\n  assert.equal(aliceRows.length, 1);\n  assert.equal(aliceRows[0].timeMs, 320_000);\n  assert.equal(top.top.length, 2);\n  assert.equal(top.top[0].uid, '111');\n  assert.equal(top.top[0].rank, 1);\n  assert.equal(top.top[1].uid, '222');`,
    `  assert.equal(top.top.length, 2);\n  assert.equal(top.top[0].timeMs, 320_000);\n  assert.equal(top.top[0].platform, 'telegram');\n  assert.equal(top.top[0].rank, 1);\n  assert.equal(top.top[1].platform, 'max');\n  assert.ok(top.top.every((row) => !Object.hasOwn(row, 'uid')));`,
    'top privacy test'
  );
  s = replaceOnce(s, `  assert.equal(daily.top[0].uid, '111');\n  assert.equal(daily.top[0].daily, true);`, `  assert.equal(daily.top[0].timeMs, 120_000);\n  assert.equal(daily.top[0].daily, true);\n  assert.ok(!Object.hasOwn(daily.top[0], 'uid'));`, 'daily top privacy');
  s = s.replace(`payload: { win: true, timeMs: 400_000, kills: 200, level: 10, ref: '111' }`, `payload: { win: true, timeMs: 400_000, kills: 200, level: 10, ref: 't_111' }`);
  s = s.replace(`assert.equal(r1.refReward.from, '111');`, `assert.equal(r1.refReward.from, 'telegram:111');`);
  s = s.replace(`body: JSON.stringify({ from: '111', to: '333', platform: 'max' }),`, `body: JSON.stringify({ from: 'telegram:111', to: '333', platform: 'max' }),`);
  s = s.replace(`const status = await j(await fetch(\`\${BASE}/api/ref?user=111&platform=max\`));`, `const status = await j(await fetch(\`\${BASE}/api/ref?user=111&platform=telegram\`));`);
  s = replaceOnce(
    s,
    `  const top = await j(await fetch(\`\${BASE}/api/top?period=all\`));\n  assert.ok(!top.top.some((t) => t.uid === 'anon-browser-12345678'));\n  const shadow = await j(await fetch(\`\${BASE}/api/top?period=all&includeUnverified=1\`));\n  assert.ok(shadow.top.some((t) => t.uid === 'anon-browser-12345678'));`,
    `  const top = await j(await fetch(\`\${BASE}/api/top?period=all\`));\n  assert.ok(!top.top.some((t) => t.platform === 'browser'));\n  const shadow = await j(await fetch(\`\${BASE}/api/top?period=all&includeUnverified=1\`));\n  assert.ok(shadow.top.some((t) => t.platform === 'browser'));\n  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));`,
    'browser privacy test'
  );
  s = replaceOnce(
    s,
    `  const invitedBy111 = as111.friends.find((f) => f.uid === '333');\n  assert.ok(invitedBy111);\n  assert.equal(invitedBy111.relation, 'invited');\n  assert.equal(invitedBy111.platform, 'max');\n  const as333 = await j(await fetch(\`\${BASE}/api/friends?user=333&platform=max\`));\n  const inviter = as333.friends.find((f) => f.uid === '111');\n  assert.ok(inviter);\n  assert.equal(inviter.relation, 'inviter');`,
    `  const invitedBy111 = as111.friends.find((f) => f.relation === 'invited' && f.platform === 'max');\n  assert.ok(invitedBy111);\n  assert.ok(as111.friends.every((row) => !Object.hasOwn(row, 'uid')));\n  const as333 = await j(await fetch(\`\${BASE}/api/friends?user=333&platform=max\`));\n  const inviter = as333.friends.find((f) => f.relation === 'inviter' && f.platform === 'telegram');\n  assert.ok(inviter);`,
    'friends privacy test'
  );
  s = s.replace(
    `  assert.ok(!top.top.some((t) => t.uid === '98765'));\n  const shadow = await j(await fetch(\`\${BASE}/api/top?period=all&includeUnverified=1\`));\n  assert.ok(shadow.top.some((t) => t.uid === '98765'));`,
    `  assert.ok(!top.top.some((t) => t.platform === 'vk'));\n  const shadow = await j(await fetch(\`\${BASE}/api/top?period=all&includeUnverified=1\`));\n  assert.ok(shadow.top.some((t) => t.platform === 'vk'));\n  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));`
  );
  s = s.replace(`assert.ok(top.top.some((t) => t.uid === '77777' && t.platform === 'vk'));`, `assert.ok(top.top.some((t) => t.platform === 'vk'));\n  assert.ok(top.top.every((row) => !Object.hasOwn(row, 'uid')));`);
  s = s.replace(
    `  assert.ok(!top.top.some((t) => t.uid === '88888'));\n  const shadow = await j(await fetch(\`\${BASE}/api/top?period=all&includeUnverified=1\`));\n  assert.ok(shadow.top.some((t) => t.uid === '88888'));`,
    `  const verifiedVk = top.top.filter((t) => t.platform === 'vk');\n  const shadow = await j(await fetch(\`\${BASE}/api/top?period=all&includeUnverified=1\`));\n  assert.ok(shadow.top.filter((t) => t.platform === 'vk').length > verifiedVk.length);\n  assert.ok(shadow.top.every((row) => !Object.hasOwn(row, 'uid')));`
  );
  s = s.replace(`assert.equal(parseStartParam('/start ref_12345'), 'ref_12345');`, `assert.equal(parseStartParam('/start ref_m_12345'), 'ref_m_12345');`);
  write(p, s);
}

// ---- Docker build env for bot usernames ----
{
  const p = 'deploy/Dockerfile';
  let s = read(p);
  s = replaceOnce(
    s,
    `COPY . ./\nRUN npm run build`,
    `COPY . ./\nARG VITE_MAX_BOT_USERNAME=""\nARG VITE_TG_BOT_USERNAME=""\nENV VITE_MAX_BOT_USERNAME=$VITE_MAX_BOT_USERNAME\nENV VITE_TG_BOT_USERNAME=$VITE_TG_BOT_USERNAME\nRUN npm run build`,
    'docker vite bot usernames'
  );
  write(p, s);
}
{
  const p = 'deploy/compose.production.yml';
  let s = read(p);
  s = replaceOnce(
    s,
    `      dockerfile: deploy/Dockerfile\n      target: static`,
    `      dockerfile: deploy/Dockerfile\n      target: static\n      args:\n        VITE_MAX_BOT_USERNAME: \${VITE_MAX_BOT_USERNAME:-}\n        VITE_TG_BOT_USERNAME: \${VITE_TG_BOT_USERNAME:-}`,
    'compose static build args'
  );
  write(p, s);
}

// ---- release metadata ----
for (const p of ['package.json', 'package-lock.json']) {
  const obj = JSON.parse(read(p));
  obj.version = '0.4.1';
  if (p.endsWith('package-lock.json') && obj.packages?.['']) obj.packages[''].version = '0.4.1';
  write(p, JSON.stringify(obj, null, 2) + '\n');
}

// ---- docs ----
{
  const p = 'README.md';
  let s = read(p);
  s = s.replace(
    `| \`VITE_SERVER_URL\` | клиент (build) | base score-сервера; пусто → относительные \`/api/*\` (dev-proxy / reverse-proxy) |`,
    `| \`VITE_SERVER_URL\` | клиент (build) | base score-сервера; пусто → relative API under current deployment prefix |\n| \`VITE_MAX_BOT_USERNAME\` | клиент (build) | public MAX bot username без @ для startapp/share/ref links |\n| \`VITE_TG_BOT_USERNAME\` | клиент (build) | public Telegram bot username без @ для startapp/share/ref links |`
  );
  s = s.replace(
    `API: \`POST /api/score\` (initData-авторизация, анти-чит: время 1с–1ч, киллы\n≤ 30/с, уровень ≤ 100; дедупликация best на юзера), \`GET /api/top?period=all|daily|weekly\`,\n\`POST /api/ref\`, \`GET /api/ref?user=\`, \`GET /health\`.`,
    `API: \`POST /api/score\` (initData-авторизация, anti-cheat и referral persistence),\n\`GET /api/top?period=all|daily|weekly|season\` (без raw platform uid), \`GET /api/ref\`\n(read-only referral stats), \`GET /api/friends\` (без raw uid), \`GET /health\`. Legacy\n\`POST /api/ref\` оставлен только для старых dev-клиентов и заблокирован production nginx.`
  );
  s = s.replace(
    `4. Шаринг-ссылка: заполнить \`SHARE.maxBot\` в \`src/game/share.ts\` (username бота\n   без @) — deep link \`https://max.ru/<бот>?startapp=<payload>\` будет в карточке\n   результата. Пустое значение → ссылка на страницу мини-аппа.`,
    `4. Для share/ref deep links перед build задать \`VITE_MAX_BOT_USERNAME=<бот>\` без @.\n   Docker/Compose передают его как build arg; пустое значение безопасно отключает bot-style startapp link.`
  );
  s = s.replace(
    `3. Шаринг-ссылка: заполнить \`SHARE.tgBot\` в \`src/game/share.ts\` —\n   deep link \`https://t.me/<бот>?startapp=<payload>\`.`,
    `3. Для share/ref deep links перед build задать \`VITE_TG_BOT_USERNAME=<бот>\` без @ —\n   deep link \`https://t.me/<бот>?startapp=<payload>\`.`
  );
  s = s.replace(
    `\`startapp=ref_<uid>\` (MAX/TG) или \`?ref=<uid>\` (web).`,
    `\`startapp=ref_<platformCode>_<uid>\` (MAX/TG) или тот же token через \`?ref=\` (web).`
  );
  write(p, s);
}
{
  const p = 'docs/PRODUCTION_ROLLOUT.md';
  let s = read(p);
  if (!s.includes('VITE_MAX_BOT_USERNAME')) {
    s += `\n## Viral deep-link build input\n\nFor full MAX share/referral rollout export the public bot username before building static image:\n\n\`\`\`bash\nexport VITE_MAX_BOT_USERNAME='<max-bot-username-without-@>'\n\`\`\`\n\nThis value is public, not a secret. If omitted, core gameplay and authenticated scores still work, but bot-style startapp share/referral links fall back/are unavailable.\n`;
  }
  write(p, s);
}

console.log('issue #20 technical followups applied');
