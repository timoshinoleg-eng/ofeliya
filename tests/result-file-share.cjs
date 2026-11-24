const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const out = mkdtempSync(join(tmpdir(), 'ofeliya-share-'));
(async () => {
  try {
    execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), 'src/platform/ResultFileShare.ts', '--target', 'ES2020', '--module', 'commonjs', '--lib', 'ES2020,DOM', '--outDir', out, '--skipLibCheck']);
    const { shareFile, shareFileForPlatform, PreparedShare } = require(join(out, 'ResultFileShare.js'));
    const file = {};
    let calls = 0;
    assert.equal(await shareFile({ canShare: () => true, share: () => { calls++; return Promise.resolve(); } }, file, 'text'), 'shared');
    assert.equal(calls, 1);
    let checks = 0, shares = 0;
    const capableHost = { canShare: () => { checks++; return true; }, share: () => { shares++; return Promise.resolve(); } };
    for (const kind of ['telegram', 'max']) {
      assert.equal(await shareFileForPlatform(kind, capableHost, file, 'challenge link'), 'unsupported');
    }
    assert.deepEqual([checks, shares], [0, 0], 'native hosts must not probe or consume Web Share activation');
    assert.equal(await shareFileForPlatform('browser', capableHost, file, 'result'), 'shared');
    assert.deepEqual([checks, shares], [1, 1]);
    assert.equal(await shareFile({ canShare: () => false, share: () => { throw Error(); } }, file, 'text'), 'unsupported');
    assert.equal(await shareFile({ canShare: () => { throw Error(); }, share: () => Promise.resolve() }, file, 'text'), 'unsupported');
    assert.equal(await shareFile({ canShare: () => true, share: () => Promise.reject(Error()) }, file, 'text'), 'error');
    assert.equal(await shareFile({ canShare: () => true, share: () => Promise.reject(Object.assign(Error(), { name: 'AbortError' })) }, file, 'text'), 'cancelled');
    assert.equal(await shareFile({ canShare: () => true, share: () => { throw Object.assign(Error(), { name: 'AbortError' }); } }, file, 'text'), 'cancelled');
    let complete;
    let disposed = 0;
    const prepared = new PreparedShare();
    const pending = prepared.prepare(new Promise((r) => { complete = r; }));
    prepared.dispose();
    complete({ file, dispose: () => disposed++ });
    await pending;
    assert.equal(prepared.file, null);
    assert.equal(disposed, 1);
    console.log('result file share contracts passed');
  } finally { rmSync(out, { recursive: true, force: true }); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
