import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-social-client-'));
const require = createRequire(import.meta.url);

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/systems/SocialClient.ts',
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

  const { socialIdentity, socialRequestPaths } = require(join(temp, 'systems/SocialClient.js'));
  const platform = (kind, id) => ({
    kind,
    available: true,
    platform: kind,
    version: '',
    initData: '',
    getUser: () => (id == null ? null : { id }),
    getDisplayName: () => null,
    getStartParam: () => null,
    buildStartLink: () => null,
    getViewportSize: async () => null,
    setBackHandler: () => {},
    shareResult: async () => false,
    haptic: () => {},
    notify: () => {},
  });

  assert.deepEqual(socialIdentity(platform('telegram', 123)), {
    platform: 'telegram',
    user: '123',
  });
  assert.equal(socialIdentity(platform('browser', 'anon')), null);

  const paths = socialRequestPaths(platform('max', 'abc-1'));
  assert.equal(paths.season, 'api/season');
  assert.equal(paths.seasonTop, 'api/top?period=season');
  assert.equal(paths.daily, 'api/daily?user=abc-1&platform=max');
  assert.equal(paths.friends, 'api/friends?user=abc-1&platform=max');

  const browserPaths = socialRequestPaths(platform('browser', 'anon'));
  assert.equal(browserPaths.daily, null);
  assert.equal(browserPaths.friends, null);

  console.log('social client contract: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
