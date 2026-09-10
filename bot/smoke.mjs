#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Context } from '@maxhub/max-bot-api';

process.env.BOT_TOKEN = 'smoke-token';
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
assert.equal(buttons[0].web_app, process.env.OFELIYA_BOT_USERNAME, 'launch targets the bot username, not a raw URL');
assert.match(buttons[0].text, /OFELIYA/, 'launch button names OFELIYA');

console.log('OFELIYA MAX bot contract: ok');
