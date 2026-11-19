#!/usr/bin/env node
// Production builds must not contain the autonomous campaign harness Test API:
// the main.ts gate (DEV || VITE_QA_TOOLS=1) is dead-code eliminated by Vite,
// and this script proves the elimination actually happened. Run after
// `npm run build` with a clean environment (no VITE_QA_TOOLS /
// VITE_RELEASE_MATRIX_QA). The same strings are asserted in
// scripts/check-build-shape.mjs (second layer, design §1.4).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = ['__ofeliyaTest', 'installAutonomousHarness', 'VITE_QA_TOOLS', 'test-support'];

const assetsDir = 'dist/assets';
assert.ok(existsSync(assetsDir), 'dist/assets missing — run `npm run build` first');
const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
assert.ok(files.length > 0, 'no JS chunks in dist/assets — run `npm run build` first');

const hits = [];
for (const name of files) {
  const text = readFileSync(join(assetsDir, name), 'utf8');
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) hits.push(`${name}: ${needle}`);
  }
}
assert.equal(
  hits.length,
  0,
  `harness Test API leaked into the production bundle:\n${hits.join('\n')}`
);

console.log(`harness absent: ok (${files.length} chunks scanned)`);
