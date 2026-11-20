'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { generateReport, runFixtureMode } = require('./campaign-report.cjs');

test('hostile status and timeline/diagnosis ticks are escaped in all HTML contexts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ofeliya-report-escape-'));
  try {
    const inputRoot = path.join(root, 'fixture');
    const fixture = runFixtureMode(inputRoot);
    const runDir = path.join(inputRoot, 'input', fixture.primary.id);
    const runFile = path.join(runDir, 'run.json');
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    run.run.status = '<svg onload=alert(1)>';
    // An object-valued invariant can override firstFailAt.tick. Its value
    // reaches the first-failure summary, distinct from timeline row ticks.
    const summaryTick = '<i data-summary=alert(3)>';
    run.invariants.finiteNumbers = {
      passed: false,
      firstFailAt: { tick: summaryTick, gameMs: 307000, wallMs: 76750 },
    };
    fs.writeFileSync(runFile, JSON.stringify(run));

    const eventsFile = path.join(runDir, 'timeline.ndjson');
    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(JSON.parse);
    const start = events.find((event) => event.event === 'RUN_START');
    const invariant = events.find((event) => event.event === 'INVARIANT_FAIL');
    assert.ok(start && invariant, 'fixture requires RUN_START and INVARIANT_FAIL');
    const startTick = '<img src=x onerror=alert(1)>';
    const invariantTick = '<svg data-trace=alert(2)>';
    start.tick = startTick;
    invariant.tick = invariantTick;
    fs.writeFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join('\n') + '\n');

    const result = generateReport(path.join(inputRoot, 'input'), path.join(root, 'output'));
    const html = fs.readFileSync(result.paths.html, 'utf8');
    const escaped = [
      '&lt;SVG ONLOAD=ALERT(1)&gt;',
      '&lt;img src=x onerror=alert(1)&gt;',
      '&lt;svg data-trace=alert(2)&gt;',
      '&lt;i data-summary=alert(3)&gt;',
    ];
    for (const marker of escaped) {
      assert.ok(html.includes(marker), 'missing escaped report value: ' + marker);
    }
    // The same INVARIANT_FAIL marker must appear in the timeline table AND
    // the +/-10s failure diagnosis context, not just the timeline table.
    assert.ok(html.split(escaped[2]).length - 1 >= 2, 'diagnosis context tick missing');
    for (const marker of [run.run.status.toUpperCase(), startTick, invariantTick, summaryTick]) {
      assert.ok(!html.includes(marker), 'raw HTML was emitted: ' + marker);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
