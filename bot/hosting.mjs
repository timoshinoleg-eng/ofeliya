import { createBot } from './bot.mjs';
import { botStartConfig } from './runtime.mjs';

// Mount the existing MAX handlers on the hosting server without polling,
// opening another public listener or changing the production subscription.
export function createHostedMaxWebhook(env = process.env, makeBot = createBot) {
  if (!String(env.OFELIYA_BOT_TOKEN || '').trim()) return null;
  if (!String(env.OFELIYA_BOT_USERNAME || '').trim()) {
    throw new Error('OFELIYA_BOT_USERNAME is required for the hosted MAX bot');
  }
  const config = botStartConfig({ ...env, NODE_ENV: 'production',
    OFELIYA_BOT_WEBHOOK_PORT: env.OFELIYA_BOT_WEBHOOK_PORT || '8788' });
  const bot = makeBot();
  bot.catch(() => console.error('[ofeliya-hosting] MAX handler failed'));
  return bot.webhookCallback(config.options);
}
