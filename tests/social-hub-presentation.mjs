import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/ui/SocialHub.ts', import.meta.url), 'utf8');
const module = { exports: {} };
const palette = Object.fromEntries(['ivory','muted','host','danger','warning','panelRaised','line','ink','panel'].map(key => [key, key]));
new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText)(name => name.endsWith('/config') ? { fmtTime: n => `${Math.floor(n / 1000)}с` }
  : name.endsWith('/visualTokens') ? { VISUAL: palette, VISUAL_TEXT: palette }
  : name.endsWith('/UiCopy') ? {
      META_COPY: {
        player: platform => `Игрок (${platform})`,
        networkError: 'Нет соединения с сервером. Твой прогресс сохраняется.',
        serverError: 'Сервер не ответил. Твой прогресс сохраняется.',
        friendsEmpty: 'Здесь появятся результаты друзей, которые играют в OFELIYA.',
        inviteFriends: 'ПРИГЛАСИТЬ ДРУЗЕЙ',
        retry: 'ПОВТОРИТЬ',
        dailyCta: 'НАЧАТЬ ЗАБЕГ ДНЯ',
        dailyEmpty: 'Сегодня ты ещё не играл',
        dailyRow: (name, time, kills, rank) => `${name} · ${time} · уничтожено ${kills} · ★ место #${rank}`,
        seasonTitle: (index, daysLeft) => `СЕЗОН ${index} · осталось ${daysLeft} дн.`,
        seasonRow: (rank, name, time, kills) => `#${rank} · ${name} — ${time} · ${kills} кл.`,
        streak: (current, best) => `Серия: ${current} дн. · Рекорд: ${best} дн.`,
        streakEmptyWithBest: (best) => `Сыграй забег дня, чтобы начать серию · Рекорд: ${best} дн.`,
      },
      buildInviteText: () => 'OFELIYA — сыграй и сравни результат. @ofeliya_game_bot',
    }
  : name.endsWith('/UiFormat') ? { fmtInt: n => String(n) } : {}, module, module.exports);
const { SocialHub } = module.exports;
const hub = Object.assign(Object.create(SocialHub.prototype), {
  platform: { kind: 'max', initData: 'fixture' }, dailyLaunchStatus: 'idle',
  scene: { scale: { width: 320, height: 568 } }, panelW: 298, panelLeft: 11, panelTop: 12,
  body: { removeAll() {} }, sectionTitle() {}, addDailyButton() {},
  addRetryButton() { this.retry = true; }, addInviteButton() { this.invite = true; },
  rows: [], addText(x, y, value, size, color, align, width, name) { this.rows.push({ x,y,value,size,width,name }); },
});
for (const status of ['idle','loading','unavailable','denied','incompatible','capacity','http','network']) {
  hub.dailyLaunchStatus = status;
  const state = hub.dailyButtonState(false);
  assert.equal(state.enabled, ['idle','capacity','http','network'].includes(status), `${status} interaction policy`);
  assert.ok(state.label.length > 0);
}
hub.platform.kind = 'browser';
assert.equal(hub.dailyButtonState(false).enabled, false, 'unsigned browser must stay disabled');
hub.platform.kind = 'max';
const entry = { rank: 99999, platform: 'telegram', timeMs: 9999999, kills: 999999, relation: 'inviter' };
const detail = { status: { daily: 'empty', season: 'ok', seasonTop: 'ok', friends: 'ok' },
  snapshot: { daily: null, season: { index: 99, daysLeft: 99 }, seasonTop: Array(4).fill(entry), friends: Array(4).fill(entry) } };
hub.render(detail);
const table = hub.rows.filter(row => /-(?:season|friend)-row-/.test(row.name ?? ''));
assert.equal(table.length, 6, 'preserve three visible rows per channel');
const seasonRows = table.filter(row => /-season-row-/.test(row.name ?? ''));
const friendRows = table.filter(row => /-friend-row-/.test(row.name ?? ''));
// One line per player in the season table; the friend rows keep the relation
// on its own line.
assert.ok(
  seasonRows.every(row => row.size >= 11 && row.value.split('\n').length === 1),
  'the season table is one line per player'
);
assert.ok(
  seasonRows.every(row => /^#\d+ · .+ — .+ · .+ кл\.$/.test(row.value)),
  'the season row states the place, the name, the time and the kills'
);
assert.ok(
  friendRows.every(row => row.size >= 11 && row.value.split('\n').length === 2),
  'readable two-line friend records'
);
assert.equal(table[1].y - table[0].y, 32, 'reserve both lines before next record');
assert.ok(hub.rows.some(row => row.name === 'ofeliya-social-friends-more' && row.value === 'ЕЩЁ +1'));
hub.rows = []; hub.retry = false;
hub.render({ ...detail, status: { daily: 'network', season: 'http', seasonTop: 'http', friends: 'network' } });
assert.equal(hub.retry, true, 'failed channels retain retry action');
assert.ok(hub.rows.every(row => row.size >= 11));
assert.ok(
  hub.rows.filter(row => /-status$/.test(row.name ?? '')).every(row => /соединени|не ответил/i.test(row.value)),
  'errors state what happened'
);
assert.ok(
  hub.rows.filter(row => /-status$/.test(row.name ?? '')).every(row => /Твой прогресс сохраняется\./.test(row.value)),
  'the network error says that the progress is preserved'
);
assert.ok(source.includes('META_COPY.retry'), 'the retry action is copy driven');
assert.ok(source.includes('META_COPY.friendsEmpty'), 'the friends empty state is copy driven');
assert.ok(source.includes('META_COPY.inviteFriends'), 'the friends invite action is copy driven');

// An empty friends list offers the invite action instead of a dead end.
hub.rows = []; hub.invite = false;
hub.render({ ...detail, status: { daily: 'ok', season: 'ok', seasonTop: 'ok', friends: 'ok' },
  snapshot: { daily: null, season: null, seasonTop: [], friends: [] } });
assert.equal(hub.invite, true, 'an empty friends list offers the invite action');
assert.ok(hub.rows.some(row => row.value.includes('друзей, которые играют в OFELIYA')), 'the friends empty state explains itself');
console.log('SocialHub: daily permission/loading/retry policy; 320px metadata sizes, bounded record count and explicit row separation passed');
