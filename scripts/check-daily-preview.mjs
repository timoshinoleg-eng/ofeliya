import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'ofeliya-daily-preview-'));
try {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), 'src/ui/DailyPreview.ts', '--target', 'ES2020', '--module', 'commonjs', '--rootDir', 'src', '--outDir', temp, '--skipLibCheck', 'true'], { stdio: 'inherit' });
  const { dailyPreviewTitle, dailyPreviewRefreshDelay } = createRequire(import.meta.url)(join(temp, 'ui/DailyPreview.js'));
  const current = { dateKey: '2026-09-01', challengeDateKey: '2026-10-12', total: 0, rank: null, you: null, serverTime: 1791842399500, nextDayAt: 1791842400000 };
  for (const timezone of ['UTC', 'Europe/Moscow', 'America/Los_Angeles']) {
    process.env.TZ = timezone;
    assert.equal(dailyPreviewTitle(current), 'ЭЛИТНЫЙ НАПЛЫВ');
    assert.equal(dailyPreviewRefreshDelay(current), 600);
  }
  const realNow = Date.now;
  try {
    Date.now = () => 0;
    assert.equal(dailyPreviewRefreshDelay(current), 600);
    Date.now = () => 9999999999999;
    assert.equal(dailyPreviewRefreshDelay(current), 600);
  } finally { Date.now = realNow; }
  assert.equal(dailyPreviewTitle({ ...current, challengeDateKey: '2026-10-13' }), 'ПЛОТНЫЙ РОЙ');
  assert.equal(dailyPreviewRefreshDelay({ ...current, serverTime: current.nextDayAt + 500 }), 100);
  assert.equal(dailyPreviewRefreshDelay(null), 60000);
  assert.match(dailyPreviewTitle(null), /УТОЧНИТСЯ/);
  assert.match(dailyPreviewTitle({ ...current, challengeDateKey: 'invalid' }), /УТОЧНИТСЯ/);
  assert.match(dailyPreviewTitle({ ...current, challengeDateKey: undefined }), /УТОЧНИТСЯ/);
  console.log('Server-date daily preview: PASS (timezones, midnight refresh, clock skew, offline)');
} finally { rmSync(temp, { recursive: true, force: true }); }
