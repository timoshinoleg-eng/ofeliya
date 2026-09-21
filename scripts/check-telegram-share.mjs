import assert from 'node:assert/strict';
import { buildPreparedShareResult } from '../server/telegram-share.mjs';

const result = buildPreparedShareResult(
  'OFELIYA result',
  'https://t.me/ofeliya_bot?startapp=duel_abc'
);
assert.equal(result.type, 'article');
assert.match(result.input_message_content.message_text, /OFELIYA result/);
assert.match(result.input_message_content.message_text, /t\.me\/ofeliya_bot/);

const stripped = buildPreparedShareResult('OFELIYA result', 'https://example.com/not-allowed');
assert.equal(stripped.input_message_content.message_text, 'OFELIYA result');

assert.equal(buildPreparedShareResult('', ''), null);
console.log('telegram prepared-share contract: ok');
