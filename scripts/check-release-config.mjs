const required = [
  'VITE_MAX_BOT_NAME',
  'VITE_DEVELOPER_LEGAL_NAME',
  'VITE_DEVELOPER_REGISTRATION',
  'VITE_DEVELOPER_ADDRESS',
  'VITE_SUPPORT_EMAIL',
];

const missing = required.filter((key) => !String(process.env[key] ?? '').trim());
if (missing.length) {
  console.error(`MAX release config missing: ${missing.join(', ')}`);
  process.exit(1);
}

const bot = String(process.env.VITE_MAX_BOT_NAME).trim().replace(/^@/, '');
if (!/^[A-Za-z0-9_-]{1,128}$/.test(bot)) {
  console.error('VITE_MAX_BOT_NAME must contain only A-Z a-z 0-9 _ - and omit @');
  process.exit(1);
}

const email = String(process.env.VITE_SUPPORT_EMAIL).trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('VITE_SUPPORT_EMAIL is not a valid email address');
  process.exit(1);
}

console.log('MAX release config: ok');
