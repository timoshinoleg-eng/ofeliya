const value = (name) => String(process.env[name] || '').trim();

export const BOT_USERNAME = value('OFELIYA_BOT_USERNAME') || value('HUB_BOT_USERNAME');
