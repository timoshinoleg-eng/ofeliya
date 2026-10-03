import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { telegramApiRequestOptions } from '../server/telegram-api.mjs';

const opts = telegramApiRequestOptions({ token: '123456:test', method: 'getMe', apiIp: '149.154.167.220' });
assert.equal(opts.host, '149.154.167.220');
assert.equal(opts.servername, 'api.telegram.org');
assert.equal(opts.headers.Host, 'api.telegram.org');
assert.equal(opts.minVersion, 'TLSv1.2');
assert.equal(opts.maxVersion, 'TLSv1.2');
assert.equal(opts.path, '/bot123456:test/getMe');

const fallback = telegramApiRequestOptions({ token: '123456:test', method: 'getMe', apiIp: '' });
assert.equal(fallback.host, 'api.telegram.org');

for (const file of ['server/bot.mjs','server/index.mjs','server/telegram-share.mjs']) {
  assert.match(readFileSync(file,'utf8'), /telegramApiJson/, file + ' must use Telegram transport');
}

console.log('Telegram API TLS transport contract: ok');