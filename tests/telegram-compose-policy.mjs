import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-compose-'));
const envPath = join(temp, 'fixture.env');
writeFileSync(envPath, 'OFELIYA_TELEGRAM_OUTBOUND_ENABLED=1\n');
try {
  const fixture = { ...process.env, OFELIYA_ENV_FILE: envPath, OFELIYA_EXTRA_CA_CERT: envPath,
    OFELIYA_RELEASE: 'a'.repeat(40), OFELIYA_SHARED_NETWORK: 'ofeliya-policy-test',
    OFELIYA_BOT_USERNAME: 'test_bot', OFELIYA_DEVELOPER_LEGAL_NAME: 'Test',
    OFELIYA_DEVELOPER_REGISTRATION: 'Test', OFELIYA_DEVELOPER_ADDRESS: 'Test', OFELIYA_SUPPORT_EMAIL: 'test@example.test' };
  for (const value of ['0', '1', undefined]) {
    const env = { ...fixture };
    if (value === undefined) delete env.OFELIYA_TELEGRAM_OUTBOUND_ENABLED;
    else env.OFELIYA_TELEGRAM_OUTBOUND_ENABLED = value;
    const child = spawnSync('docker', ['compose', '-f', 'deploy/compose.production.yml', 'config', '--format', 'json'],
      { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    const config = JSON.parse(child.stdout);
    assert.equal(String(config.services.score.environment.OFELIYA_TELEGRAM_OUTBOUND_ENABLED), value ?? '0',
      'resolved process policy must override env_file; absent policy defaults off');
  }
  console.log('rendered Telegram outbound policy: ok');
} finally { rmSync(temp, { recursive: true, force: true }); }
