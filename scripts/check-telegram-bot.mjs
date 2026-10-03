import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('server/bot.mjs', 'utf8');
assert.match(source, /handleStart\(msg, parseStartParam\(msg\.text\)\)/, 'long-polling /start must parse the original Telegram message text');
process.env.TG_BOT_TOKEN ||= '7123456789:telegram-contract-test';
const { parseStartParam } = await import('../server/bot.mjs');
assert.equal(parseStartParam('/start ref_m_12345'), 'ref_m_12345');
assert.equal(parseStartParam('/start sz2_s_isn_d_0_2_9'), 'sz2_s_isn_d_0_2_9');
assert.equal(parseStartParam('/start'), null);
console.log('telegram bot command contract: ok');
