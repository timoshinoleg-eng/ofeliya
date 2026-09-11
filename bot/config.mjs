const value = (name) => String(process.env[name] || '').trim();

// Ofeliya must never silently inherit Hub's bot identity. In MAX an open_app
// button launches the Mini App attached to this username.
export const BOT_TOKEN = value('OFELIYA_BOT_TOKEN');
export const BOT_USERNAME = value('OFELIYA_BOT_USERNAME');
