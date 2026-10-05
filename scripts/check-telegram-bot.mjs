import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTelegramWebhookMethod } from '../server/telegram-webhook.mjs';

const source = readFileSync('server/bot.mjs', 'utf8');
assert.match(source, /handleStart\(msg, parseStartParam\(msg\.text\)\)/, 'long-polling /start must parse the original Telegram message text');
process.env.TG_BOT_TOKEN ||= '7123456789:telegram-contract-test';
const { parseStartParam } = await import('../server/bot.mjs');
assert.equal(parseStartParam('/start ref_m_12345'), 'ref_m_12345');
assert.equal(parseStartParam('/start sz2_s_isn_d_0_2_9'), 'sz2_s_isn_d_0_2_9');
assert.equal(parseStartParam('/start'), null);
const opts = { gameUrl: 'https://example.test/ofeliya/', miniAppUrl: 'https://t.me/ofeliya_bot/game?startapp=play' };
for (const type of ['private', 'group', 'supergroup']) {
  const message = { chat: { id: 23, type }, from: { id: 23 }, text: '/start ref_m_12345' };
  const result = buildTelegramWebhookMethod({ message }, opts);
  const button = result.reply_markup.inline_keyboard[0][0];
  assert.equal(button.web_app, undefined, 'payload launch must use Telegram direct-link startapp');
  assert.equal(button.url, 'https://t.me/ofeliya_bot/game?startapp=ref_m_12345');
  message.text = '/start';
  const ordinary = buildTelegramWebhookMethod({ message }, opts).reply_markup.inline_keyboard[0][0];
  if (type === 'private') assert.equal(ordinary.web_app.url, opts.gameUrl);
  else {
    assert.equal(ordinary.web_app, undefined, 'groups cannot receive inline web_app buttons');
    assert.equal(ordinary.url, opts.miniAppUrl);
  }
}
const invalid = buildTelegramWebhookMethod({ message: { chat: { id: 23, type: 'private' }, text: '/start bad parameter' } }, opts);
assert.equal(invalid.reply_markup.inline_keyboard[0][0].web_app.url, opts.gameUrl);
console.log('telegram bot command contract: ok');

for (const text of ['/start', '/start ref_m_12345']) {
  const button = buildTelegramWebhookMethod({ message: { chat: { id: 23, type: 'private' }, text } }, { gameUrl: opts.miniAppUrl, miniAppUrl: '' }).reply_markup.inline_keyboard[0][0];
  assert.equal(button.web_app, undefined);
  assert.equal(new URL(button.url).searchParams.get('startapp'), text.includes(' ') ? 'ref_m_12345' : 'play');
}
