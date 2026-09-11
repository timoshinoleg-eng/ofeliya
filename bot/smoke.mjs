#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Context } from '@maxhub/max-bot-api';
import { botStartConfig } from './runtime.mjs';

process.env.OFELIYA_BOT_TOKEN = 'smoke-token';
process.env.OFELIYA_BOT_USERNAME = 'id100000000000_test_bot';

const { createBot } = await import('./bot.mjs');
const bot = createBot();
const middleware = bot.middleware();
const sent = [];

const update = {
  update_type: 'message_created',
  message: {
    body: { mid: 'm1', text: '/start' },
    sender: { user_id: 42, first_name: 'Тест', is_bot: false },
    recipient: { chat_id: 7, user_id: 42 },
  },
};
const ctx = new Context(update, {}, undefined);
ctx.reply = async (text, extra = {}) => {
  sent.push({ text, attachments: extra.attachments || [] });
  return { body: { mid: 'stub' } };
};

await middleware(ctx, async () => {});
assert.equal(sent.length, 1, 'start sends one launch message');
assert.match(sent[0].text, /OFELIYA/, 'start message names the new game');

const buttons = sent[0].attachments
  .filter((attachment) => attachment?.type === 'inline_keyboard')
  .flatMap((attachment) => attachment.payload?.buttons || [])
  .flat();
assert.equal(buttons.length, 1, 'start keyboard has one focused action');
assert.equal(buttons[0].type, 'open_app', 'start launches the attached Mini App');
assert.equal(buttons[0].web_app, process.env.OFELIYA_BOT_USERNAME, 'launch targets the Ofeliya bot username');
assert.match(buttons[0].text, /OFELIYA/, 'launch button names OFELIYA');

const webhook = botStartConfig({
  NODE_ENV: 'production',
  OFELIYA_BOT_WEBHOOK_DOMAIN: 'https://example.test',
  OFELIYA_BOT_WEBHOOK_PORT: '8788',
  OFELIYA_BOT_WEBHOOK_PATH: '/ofeliya/bot/webhook',
  OFELIYA_BOT_WEBHOOK_SECRET: '0123456789abcdef0123456789abcdef',
});
assert.equal(webhook.mode, 'webhook', 'production uses webhook mode');
assert.equal(webhook.options.port, 8788, 'production webhook listens on compose/Caddy port');
assert.equal(webhook.options.path, '/ofeliya/bot/webhook', 'production webhook path matches Ofeliya Caddy route');
assert.equal(webhook.options.domain, 'https://example.test', 'production webhook requires HTTPS domain');

assert.throws(
  () => botStartConfig({ NODE_ENV: 'production' }),
  /Unsafe production bot config/,
  'production bot must fail closed when webhook env is incomplete'
);
assert.throws(
  () => botStartConfig({
    NODE_ENV: 'production',
    HUB_BOT_WEBHOOK_DOMAIN: 'https://example.test',
    HUB_BOT_WEBHOOK_PORT: '8788',
    HUB_BOT_WEBHOOK_PATH: '/hub/bot/webhook',
    HUB_BOT_WEBHOOK_SECRET: '0123456789abcdef0123456789abcdef',
  }),
  /Unsafe production bot config/,
  'Hub-only webhook settings must never configure Ofeliya'
);
assert.deepEqual(botStartConfig({ NODE_ENV: 'development' }), { mode: 'polling' }, 'non-production keeps polling mode');

console.log('OFELIYA MAX bot contract: ok');
