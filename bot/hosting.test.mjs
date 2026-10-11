import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

process.env.OFELIYA_BOT_TOKEN = 'hosting-test-token';
process.env.OFELIYA_BOT_USERNAME = 'id100000000000_test_bot';
const { createBot } = await import('./bot.mjs');
const { createHostedMaxWebhook } = await import('./hosting.mjs');
const env = { OFELIYA_BOT_TOKEN: process.env.OFELIYA_BOT_TOKEN,
  OFELIYA_BOT_USERNAME: process.env.OFELIYA_BOT_USERNAME,
  OFELIYA_BOT_MODE: 'dedicated',
  OFELIYA_BOT_WEBHOOK_DOMAIN: 'https://example.test',
  OFELIYA_BOT_WEBHOOK_PATH: '/ofeliya/bot/webhook',
  OFELIYA_BOT_WEBHOOK_SECRET: '0123456789abcdef0123456789abcdef' };

assert.equal(createHostedMaxWebhook({}), null);
assert.throws(() => createHostedMaxWebhook({ ...env, OFELIYA_BOT_USERNAME: '' }), /USERNAME/);
assert.throws(() => createHostedMaxWebhook({ ...env, OFELIYA_BOT_WEBHOOK_SECRET: '' }), /secret/);
assert.throws(() => createHostedMaxWebhook({ ...env, OFELIYA_BOT_MODE: 'shared' }), /dedicated/);

const bot = createBot();
const replies = [];
bot.api.sendMessageToUser = async (...args) => { replies.push(args); return {}; };
bot.api.sendMessageToChat = async (...args) => { replies.push(args); return {}; };
// Startup must not subscribe/unsubscribe or launch polling during a preview deploy.
bot.start = () => { throw new Error('must not start'); };
bot.api.subscribe = () => { throw new Error('must not subscribe'); };
bot.api.unsubscribe = () => { throw new Error('must not unsubscribe'); };
const server = createServer(createHostedMaxWebhook(env, () => bot));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/ofeliya/bot/webhook`;
const post = (body, secret = env.OFELIYA_BOT_WEBHOOK_SECRET) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-max-bot-api-secret': secret }, body });
try {
  assert.equal((await post('{}', 'wrong-secret')).status, 404);
  assert.equal((await post('{')).status, 400);
  assert.equal((await fetch(url)).status, 404);
  const update = { update_type: 'message_created', timestamp: Date.now(), message: {
    body: { mid: 'hosting-test-message', text: '/start' },
    sender: { user_id: 42, first_name: 'Тест', is_bot: false },
    recipient: { chat_id: 7, user_id: 42 } } };
  assert.equal((await post(JSON.stringify(update))).status, 200);
  // Complete the request handler before checking the real SDK command reply.
  for (let n = 0; !replies.length && n < 20; n++) await new Promise(r => setTimeout(r, 10));
  assert.equal(replies.length, 1);
  assert.match(replies[0][1], /OFELIYA/);
  assert.ok(replies[0][2]?.attachments?.length);
} finally { await new Promise(resolve => server.close(resolve)); }
console.log('Hosted MAX webhook authentication and /start: ok');
