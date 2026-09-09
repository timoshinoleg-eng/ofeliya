const required = [
  'VITE_MAX_BOT_NAME',
  'VITE_DEVELOPER_LEGAL_NAME',
  'VITE_DEVELOPER_REGISTRATION',
  'VITE_DEVELOPER_ADDRESS',
  'VITE_SUPPORT_EMAIL',
];

const valueOf = (key) => String(process.env[key] ?? '').trim();
const placeholder = (value) => {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (
    normalized.startsWith('your_') ||
    normalized.startsWith('replace_') ||
    normalized.startsWith('change_me') ||
    normalized === 'placeholder' ||
    normalized.includes('example_placeholder')
  );
};

const missing = required.filter((key) => !valueOf(key));
if (missing.length) {
  console.error(`MAX release config missing: ${missing.join(', ')}`);
  process.exit(1);
}

const placeholders = required.filter((key) => placeholder(valueOf(key)));
if (placeholders.length) {
  console.error(`MAX release config still contains placeholders: ${placeholders.join(', ')}`);
  process.exit(1);
}

const bot = valueOf('VITE_MAX_BOT_NAME').replace(/^@/, '');
if (!/^[A-Za-z0-9_-]{1,128}$/.test(bot)) {
  console.error('VITE_MAX_BOT_NAME must contain only A-Z a-z 0-9 _ - and omit @');
  process.exit(1);
}

const email = valueOf('VITE_SUPPORT_EMAIL');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('VITE_SUPPORT_EMAIL is not a valid email address');
  process.exit(1);
}

console.log('MAX release config: ok');
