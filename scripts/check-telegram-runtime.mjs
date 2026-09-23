import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-telegram-runtime-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/platform/TelegramBridgeLoader.ts',
      'src/platform/TelegramLinks.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { hasTelegramLaunchHint } = require(join(temp, 'platform/TelegramBridgeLoader.js'));
  const { buildTelegramStartLink, resolveTelegramBotName } = require(
    join(temp, 'platform/TelegramLinks.js')
  );

  assert.equal(
    hasTelegramLaunchHint({
      hash: '#tgWebAppData=signed&tgWebAppVersion=10.1&tgWebAppPlatform=android',
    }),
    true
  );
  assert.equal(hasTelegramLaunchHint({ hash: '#foo=bar' }), false);
  assert.equal(hasTelegramLaunchHint({ hash: '' }), false);

  assert.equal(
    resolveTelegramBotName({
      VITE_TG_BOT_USERNAME: ' deployed_bot ',
      VITE_TELEGRAM_BOT_NAME: 'legacy_bot',
    }),
    'deployed_bot'
  );
  assert.equal(
    resolveTelegramBotName({ VITE_TELEGRAM_BOT_NAME: 'legacy_bot' }),
    'legacy_bot'
  );
  assert.equal(
    buildTelegramStartLink('duel_abc', resolveTelegramBotName({ VITE_TG_BOT_USERNAME: 'ofeliya_bot' })),
    'https://t.me/ofeliya_bot?startapp=duel_abc'
  );
  assert.equal(
    buildTelegramStartLink('duel_abc', 'ofeliya_bot', 'strain_zero'),
    'https://t.me/ofeliya_bot/strain_zero?startapp=duel_abc'
  );

  console.log('telegram runtime contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
