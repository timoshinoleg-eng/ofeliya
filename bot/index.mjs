#!/usr/bin/env node
import { createBot, commands } from './bot.mjs';
import { BOT_USERNAME } from './config.mjs';
import { botStartConfig } from './runtime.mjs';

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !BOT_USERNAME) {
  console.error('OFELIYA_BOT_USERNAME or HUB_BOT_USERNAME is required in production');
  process.exit(1);
}

const bot = createBot();
bot.catch((error, ctx) => console.error('Bot handler error:', ctx?.update?.update_type, error?.message || error));
try { await bot.api.setMyCommands(commands); }
catch (error) { console.error('Cannot set bot commands:', error?.message || error); }
await bot.start(botStartConfig());
