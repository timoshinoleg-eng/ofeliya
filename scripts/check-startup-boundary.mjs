import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'ofeliya-startup-boundary-'));
try {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), 'src/systems/StartupBoundary.ts', '--target', 'ES2020', '--module', 'commonjs', '--outDir', temp, '--skipLibCheck', 'true'], { stdio: 'inherit' });
  const { runStartupBoundary } = createRequire(import.meta.url)(join(temp, 'StartupBoundary.js'));
  for (const failedStep of ['release', 'bridge', 'boot']) {
    const calls = [];
    const failures = [];
    assert.equal(await runStartupBoundary(async () => {
      for (const step of ['release', 'bridge', 'boot']) {
        calls.push(step);
        if (step === failedStep) throw new Error(step);
      }
    }, error => failures.push(error)), false);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].message, failedStep);
    assert.equal(calls.at(-1), failedStep);
  }
  let signal, failures = 0;
  assert.equal(await runStartupBoundary(async s => { signal = s; await new Promise(() => {}); }, () => failures++, 20), false);
  assert.equal(signal.aborted, true);
  assert.equal(failures, 1);
  assert.equal(await runStartupBoundary(async () => {}, () => { throw new Error('unexpected failure'); }), true);
  console.log('Startup boundary: PASS (all stages, stall, abort, success)');
} finally { rmSync(temp, { recursive: true, force: true }); }
