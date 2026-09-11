const PATH_PATTERN = /^\/[A-Za-z0-9._~\/-]+$/;
const HTTPS_PATTERN = /^https:\/\/[^/]+(?:\/.*)?$/i;
const value = (env, name) => String(env[name] || '').trim();

function port(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

export function botStartConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return { mode: 'polling' };

  const domain = value(env, 'OFELIYA_BOT_WEBHOOK_DOMAIN');
  const webhookPort = port(value(env, 'OFELIYA_BOT_WEBHOOK_PORT'));
  const path = value(env, 'OFELIYA_BOT_WEBHOOK_PATH');
  const secret = value(env, 'OFELIYA_BOT_WEBHOOK_SECRET');
  const errors = [];
  if (!HTTPS_PATTERN.test(domain)) errors.push('webhook domain must be HTTPS');
  if (webhookPort == null) errors.push('webhook port must be valid');
  if (!PATH_PATTERN.test(path)) errors.push('webhook path must start with /');
  if (path !== '/ofeliya/bot/webhook') errors.push('webhook path must be /ofeliya/bot/webhook');
  if (secret.length < 32) errors.push('webhook secret must be at least 32 characters');
  if (errors.length) throw new Error(`Unsafe production bot config: ${errors.join('; ')}`);

  return {
    mode: 'webhook',
    options: {
      domain,
      port: webhookPort,
      path,
      secret,
      allowedUpdates: ['bot_started', 'message_created'],
    },
  };
}
