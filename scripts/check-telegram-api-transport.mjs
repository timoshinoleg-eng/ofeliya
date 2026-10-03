import assert from 'node:assert/strict';
import { telegramApiRequestOptions } from '../server/telegram-api.mjs';

const pinned = telegramApiRequestOptions({
  token: '123:test',
  method: 'getMe',
  apiIp: '149.154.167.220',
});
assert.equal(pinned.host, '149.154.167.220');
assert.equal(pinned.servername, 'api.telegram.org');
assert.equal(pinned.headers.Host, 'api.telegram.org');
assert.equal(pinned.minVersion, 'TLSv1.2');
assert.equal(pinned.maxVersion, 'TLSv1.2');
assert.equal(pinned.path, '/bot123:test/getMe');

const direct = telegramApiRequestOptions({
  token: '123:test',
  method: 'getMe',
  apiIp: '',
});
assert.equal(direct.host, 'api.telegram.org');
assert.equal(direct.servername, 'api.telegram.org');

const invalid = telegramApiRequestOptions({
  token: '123:test',
  method: 'getMe',
  apiIp: '999.1.1.1',
});
assert.equal(invalid.host, 'api.telegram.org');

console.log('Telegram API pinned transport contract: ok');
