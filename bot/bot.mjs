import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { BOT_USERNAME } from './config.mjs';

const launchButton = () => Keyboard.button.openApp('⚡ Играть в OFELIYA', BOT_USERNAME, undefined, 'ofeliya');
const launchKeyboard = () => Keyboard.inlineKeyboard([[launchButton()]]);

async function answer(ctx, text) {
  await ctx.reply(text, { attachments: [launchKeyboard()] });
  if (ctx.callback) {
    try { await ctx.answerOnCallback({}); } catch { /* already answered */ }
  }
}

export function createBot() {
  const bot = new Bot(process.env.BOT_TOKEN || 'stub');
  const welcome = (name) => `${name ? `${name}, ` : ''}OFELIYA ждёт. Удержите ядро до финального босса.`;

  bot.command(/^start(?:\s+\S+)?$/, async (ctx) => answer(ctx, welcome(ctx.user?.first_name)));
  bot.command('help', async (ctx) => answer(ctx, 'Откройте OFELIYA и начните забег. Управление — касанием или свайпом.'));
  bot.on('bot_started', async (ctx) => answer(ctx, welcome(ctx.user?.first_name)));
  bot.on('message_created', async (ctx) => {
    const text = (ctx.message?.body?.text || '').trim();
    if (!text || text.startsWith('/')) return;
    await answer(ctx, 'Открывайте OFELIYA — игра уже готова.');
  });
  return bot;
}

export const commands = [
  { name: 'help', description: 'Как запустить OFELIYA' },
];
