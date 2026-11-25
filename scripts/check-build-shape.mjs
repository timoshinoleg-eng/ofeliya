#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

function scanImports(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scanImports(path);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) assert.ok(!/rexuiplugin|templates\/ui/i.test(readFileSync(path, 'utf8')), 'forbidden Rex UI import: '+path);
  }
}
scanImports('src');
const assetsDir = 'dist/assets';
const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
const vendor = files.filter((name) => /^vendor-phaser-.*\.js$/.test(name));
const app = files.filter((name) => !name.startsWith('vendor-phaser-'));

assert.equal(vendor.length, 1, `expected exactly one Phaser vendor chunk, got: ${files.join(', ')}`);
assert.ok(app.length >= 1, 'expected at least one non-Phaser application chunk');

const vendorBytes = statSync(join(assetsDir, vendor[0])).size;
const largestAppBytes = Math.max(...app.map((name) => statSync(join(assetsDir, name)).size));
assert.ok(vendorBytes > 500_000, `Phaser vendor chunk unexpectedly small: ${vendorBytes} B`);
assert.ok(
  largestAppBytes < 900_000,
  `application chunk still carries too much vendor payload: ${largestAppBytes} B`
);

const gzipBytes = files.reduce((total, name) => total + gzipSync(readFileSync(join(assetsDir, name))).length, 0);
assert.ok(gzipBytes <= 564053, `aggregate JS gzip exceeds 564053 B: ${gzipBytes} B (baseline 533333 B)`);

const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /vendor-phaser-[^"'<>]+\.js/, 'index.html must reference the Phaser vendor chunk');

// Production bundle must not contain the autonomous campaign harness Test API
// (same strings as scripts/check-harness-absent.mjs — second layer, §1.4).
const FORBIDDEN_HARNESS_STRINGS = [
  '__ofeliyaTest',
  'installAutonomousHarness',
  'VITE_QA_TOOLS',
  'test-support',
];
for (const name of files) {
  const text = readFileSync(join(assetsDir, name), 'utf8');
  assert.ok(!/rexuiplugin|templates\/ui/i.test(text), `forbidden UI dependency in ${name}`);
  for (const needle of FORBIDDEN_HARNESS_STRINGS) {
    assert.ok(!text.includes(needle), `harness Test API leaked into ${name}: ${needle}`);
  }
}

console.log(
  `bundle shape: ok (vendor=${vendorBytes} B, largest-app=${largestAppBytes} B, js-chunks=${files.length})`
);
