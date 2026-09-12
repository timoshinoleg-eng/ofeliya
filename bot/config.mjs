const value = (name) => String(process.env[name] || '').trim();

// Shared mode is explicit: Ofeliya reuses the Hub/MAX bot identity for signed
// initData and links, while the Hub process remains the only webhook owner.
const shared = value('OFELIYA_BOT_MODE') === 'shared';

export const BOT_TOKEN = value('OFELIYA_BOT_TOKEN') || (shared ? value('BOT_TOKEN') : '');
export const BOT_USERNAME = value('OFELIYA_BOT_USERNAME') || (shared ? value('HUB_BOT_USERNAME') : '');
