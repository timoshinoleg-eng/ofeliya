/**
 * Invite + collab contract — монетизация v3 (этапы 3/5).
 *
 * Covers (pure, Phaser-free):
 * - buildInvitePayload: `t_<uid>`; null для невалидных id;
 * - buildInvitePayloadFromInitData: id из initData (user.id);
 * - parseCollabStartPayload: `collab_<id>` → id; null для прочего;
 * - COLLAB_REGISTRY пуст в v1 (партнёров нет, фейковые не создаются);
 * - getCollab: undefined для любого id (пока реестр пуст).
 *
 * Ссылка-приглашение собирается из пейлоада через
 * PlatformBridge.buildStartLink (Telegram: t.me/<bot>?startapp=<payload>)
 * — сам билдер ссылки тестируется в platform-тестах, здесь только пейлоад.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-invite-collab-'));
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'commonjs' }));
const require = createRequire(import.meta.url);

const assert = (condition, message) => {
  if (!condition) throw new Error(`invite-collab: ${message}`);
};
const eq = (actual, expected, message) =>
  assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

function buildInitData(userId) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000)));
  params.set('query_id', 'AAE-invite-test');
  params.set('user', JSON.stringify({ id: userId, first_name: 'Test' }));
  params.set('hash', 'deadbeef');
  return params.toString();
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/game/shop/invite.ts',
      'src/game/shop/collabs.ts',
      '--target',
      'ES2021',
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--strict',
      'true',
      '--outDir',
      temp,
      '--skipLibCheck',
      'true',
      '--esModuleInterop',
      'true',
    ],
    { stdio: 'inherit' }
  );

  const { INVITE_PLATFORM_CODE, buildInvitePayload, buildInvitePayloadFromInitData, INVITE_SHARE_TEXT } = require(
    join(temp, 'game', 'shop', 'invite.js')
  );
  const { COLLAB_REGISTRY, getCollab, parseCollabStartPayload } = require(
    join(temp, 'game', 'shop', 'collabs.js')
  );

  // --- invite payload: t_<uid> ---
  eq(INVITE_PLATFORM_CODE, 't', 'invite platform code is t (telegram)');
  eq(buildInvitePayload(123456), 't_123456', 'payload format t_<uid>');
  eq(buildInvitePayload(1), 't_1', 'payload for uid 1');
  eq(buildInvitePayload(0), null, 'uid 0 → null');
  eq(buildInvitePayload(-5), null, 'negative uid → null');
  eq(buildInvitePayload(1.5), null, 'non-integer uid → null');
  eq(buildInvitePayload(Number.NaN), null, 'NaN uid → null');
  eq(buildInvitePayload(Number.MAX_SAFE_INTEGER + 1), null, 'unsafe integer → null');
  // Пейлоад обязан совпадать с серверным parseReferralRef
  // (server/index.mjs: ^[tmbv]_[A-Za-z0-9-]{1,48}$).
  const serverRe = /^[tmbv]_[A-Za-z0-9-]{1,48}$/;
  assert(serverRe.test(buildInvitePayload(123456)), 'payload matches server referral regex');
  assert(!serverRe.test('ref_123456'), 'brief format ref_<uid> does NOT match server regex');

  // --- invite payload from initData ---
  eq(buildInvitePayloadFromInitData(buildInitData(777)), 't_777', 'payload from initData');
  eq(buildInvitePayloadFromInitData(''), null, 'empty initData → null');
  eq(buildInvitePayloadFromInitData('auth_date=1&hash=x'), null, 'initData without user → null');
  eq(buildInvitePayloadFromInitData('user=not-json'), null, 'bad user JSON → null');

  // --- share text: без обещания бонуса (в v1 его нет) ---
  assert(typeof INVITE_SHARE_TEXT === 'string' && INVITE_SHARE_TEXT.length > 0, 'share text exists');
  assert(!/бонус/i.test(INVITE_SHARE_TEXT), 'share text promises no bonus');

  // --- collab payload ---
  eq(parseCollabStartPayload('collab_partner-1'), 'partner-1', 'collab id parsed');
  eq(parseCollabStartPayload('collab_x'), 'x', 'short collab id');
  eq(parseCollabStartPayload(null), null, 'null startParam → null');
  eq(parseCollabStartPayload(undefined), null, 'undefined startParam → null');
  eq(parseCollabStartPayload(''), null, 'empty startParam → null');
  eq(parseCollabStartPayload('collab_'), null, 'empty collab id → null');
  eq(parseCollabStartPayload('duel_abc'), null, 'duel payload is not collab');
  eq(parseCollabStartPayload('t_123456'), null, 'referral payload is not collab');
  eq(parseCollabStartPayload('collab_a b'), null, 'space in id → null');
  eq(parseCollabStartPayload(`collab_${'a'.repeat(49)}`), null, 'id over 48 chars → null');
  eq(parseCollabStartPayload(`collab_${'a'.repeat(48)}`), 'a'.repeat(48), 'id of 48 chars ok');

  // --- registry: пуст в v1 ---
  eq(Object.keys(COLLAB_REGISTRY).length, 0, 'collab registry is empty in v1 (no partners yet)');
  eq(getCollab('anything'), undefined, 'unknown collab → undefined');
  // CR2: ключи прототипа — не коллабы (без own-check 'constructor'
  // возвращал унаследованный конструктор, truthy → витрина с баннером).
  eq(getCollab('constructor'), undefined, "getCollab('constructor') → undefined");
  eq(getCollab('toString'), undefined, "getCollab('toString') → undefined");
  eq(getCollab('__proto__'), undefined, "getCollab('__proto__') → undefined");
  eq(getCollab('hasOwnProperty'), undefined, "getCollab('hasOwnProperty') → undefined");
  // Позитивный контроль: легальный id продолжает работать.
  COLLAB_REGISTRY['test-collab'] = { id: 'test-collab', title: 'T', description: 'D' };
  eq(getCollab('test-collab')?.id, 'test-collab', 'registered collab still resolves');
  delete COLLAB_REGISTRY['test-collab'];
  eq(getCollab('test-collab'), undefined, 'removed collab → undefined');

  console.log('invite-collab: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
