'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { generateReport, runFixtureMode } = require('./campaign-report.cjs');

test('untrusted run status and timeline ticks are HTML-escaped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ofeliya-report-escape-'));
  try {
    const inputRoot = path.join(root, 'fixture');
    const fixture = runFixtureMode(inputRoot);
    const runDir = path.join(inputRoot, 'input', fixture.primary.id);
    const runFile = path.join(runDir, 'run.json');
    const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    run.run.status = '<svg onload=alert(1)>';
    fs.writeFileSync(runFile, JSON.stringify(run));

    const eventsFile = path.join(runDir, 'timeline.ndjson');
    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.length > 0, 'fixture must have timeline entries');
    events[0].tick = '<img src=x onerror=alert(1)>';
    fs.writeFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join('\n') + '\n');

    const result = generateReport(path.join(inputRoot, 'input'), path.join(root, 'output'));
    const html = fs.readFileSync(result.paths.html, 'utf8');
    assert.ok(html.includes('&lt;SVG ONLOAD=ALERT(1)&gt;'), 'run status is escaped');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'timeline tick is escaped');
    assert.ok(!html.includes('<SVG ONLOAD=ALERT(1)>'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
