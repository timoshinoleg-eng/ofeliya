const value = (name) => String(process.env[name] || '').trim();

// OFELIYA owns a dedicated MAX bot identity. Never fall back to Hub/Chatbot24 credentials:
// mixing bot audiences invalidates initData trust and makes launch links ambiguous.
export const BOT_TOKEN = value('OFELIYA_BOT_TOKEN');
export const BOT_USERNAME = value('OFELIYA_BOT_USERNAME');
