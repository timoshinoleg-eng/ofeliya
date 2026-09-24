import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-analytics-client-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/AnalyticsClient.ts',
      'src/platform/PlatformBridge.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--rootDir', 'src',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { buildAnalyticsSubmission } = require(join(temp, 'systems/AnalyticsClient.js'));
  const platform = (kind, initData = '') => ({
    kind,
    available: true,
    platform: kind,
    version: '',
    initData,
    getUser: () => null,
    getDisplayName: () => null,
    getStartParam: () => null,
    buildStartLink: () => null,
    getViewportSize: async () => null,
    setBackHandler: () => {},
    shareResult: async () => false,
    haptic: () => {},
    notify: () => {},
  });

  assert.deepEqual(
    buildAnalyticsSubmission('first_rna_pickup', platform('telegram', 'signed'), { value: 4 }),
    { platform: 'telegram', initData: 'signed', event: 'first_rna_pickup', props: { value: 4 } }
  );
  assert.deepEqual(
    buildAnalyticsSubmission('first_enemy_hit', platform('max', 'signed-max'), { kind: 'swarm' }),
    { platform: 'max', initData: 'signed-max', event: 'first_enemy_hit', props: { kind: 'swarm' } }
  );
  assert.equal(buildAnalyticsSubmission('app_open', platform('max', '')), null);

  assert.equal(
    buildAnalyticsSubmission('app_open', platform('browser'), { release: 'r1' }),
    null
  );

  console.log('analytics client contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
