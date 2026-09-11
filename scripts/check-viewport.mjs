import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'ofeliya-viewport-'));
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      'src/platform/ViewportMath.ts',
      '--target', 'ES2020',
      '--module', 'commonjs',
      '--moduleResolution', 'node',
      '--outDir', temp,
      '--skipLibCheck', 'true',
      '--esModuleInterop', 'true',
    ],
    { stdio: 'inherit' }
  );

  const { computeViewportFrame } = require(join(temp, 'ViewportMath.js'));

  const noInsets = computeViewportFrame(
    { width: 390, height: 844 },
    { top: 0, right: 0, bottom: 0, left: 0 }
  );
  assert(JSON.stringify(noInsets) === JSON.stringify({ left: 0, top: 0, width: 390, height: 844 }), 'zero inset frame failed');

  const safe = computeViewportFrame(
    { width: 390, height: 844 },
    { top: 47, right: 0, bottom: 34, left: 0 }
  );
  assert(safe.top === 47 && safe.height === 763, 'portrait safe-area subtraction failed');

  const landscape = computeViewportFrame(
    { width: 844, height: 390 },
    { top: 0, right: 47, bottom: 21, left: 47 }
  );
  assert(landscape.left === 47 && landscape.width === 750 && landscape.height === 369, 'landscape safe-area subtraction failed');

  const hostile = computeViewportFrame(
    { width: 0, height: Number.NaN },
    { top: 9999, right: -3, bottom: 9999, left: 9999 }
  );
  assert(hostile.width === 1 && hostile.height === 1 && hostile.left === 0 && hostile.top === 0, 'malformed values must clamp safely');

  console.log('viewport math smoke: ok');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
