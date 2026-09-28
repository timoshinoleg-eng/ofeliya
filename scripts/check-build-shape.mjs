#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /vendor-phaser-[^"'<>]+\.js/, 'index.html must reference the Phaser vendor chunk');

console.log(
  `bundle shape: ok (vendor=${vendorBytes} B, largest-app=${largestAppBytes} B, js-chunks=${files.length})`
);
