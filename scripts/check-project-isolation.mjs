#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function walkTextFiles(root) {
  const out = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  };
  visit(root);
  return out;
}

const files = [
  'index.html',
  ...walkTextFiles('src'),
  ...walkTextFiles('server'),
  ...walkTextFiles('bot'),
  ...walkTextFiles('deploy'),
];

const sources = Object.fromEntries(files.map((path) => [path, readFileSync(path, 'utf8')]));
const combined = files.map((path) => `--- ${path} ---\n${sources[path]}`).join('\n');

for (const [pattern, reason] of [
  [/quiz\.chatbot24\.su/i, 'runtime/deploy must not use the retired Chatbot24 host'],
  [/id402806822924_1_bot/i, 'runtime/deploy must not use the retired Chatbot24 MAX bot'],
  [/\/opt\/hub(?:\/|\b)/i, 'runtime/deploy must not read Hub filesystem state'],
  [/HUB_BOT_/i, 'runtime/deploy must not inherit Hub bot identity or webhook config'],
  [/OFELIYA_BOT_MODE\s*=\s*shared/i, 'shared bot ownership is retired'],
  [/OFELIYA_BOT_MODE:-shared/i, 'shared bot ownership must not be a default'],
]) {
  assert.doesNotMatch(combined, pattern, reason);
}

assert.match(
  sources['deploy/ofeliya.env.example'],
  /OFELIYA_BOT_USERNAME=id402806822924_5_bot/,
  'env example must identify the canonical OFELIYA MAX bot'
);
assert.match(
  sources['deploy/ofeliya.env.example'],
  /OFELIYA_GAME_URL=https:\/\/ofeliya\.freeveol\.dpdns\.org\/ofeliya\//,
  'env example must identify the canonical OFELIYA production URL'
);
assert.match(
  sources['index.html'],
  /https:\/\/ofeliya\.freeveol\.dpdns\.org\/ofeliya\//,
  'QA redirect must target canonical OFELIYA production'
);
assert.match(
  sources['src/platform/MaxPlatform.ts'],
  /wa\.ready\?\.\(\)/,
  'MAX adapter must signal WebAppReady'
);
assert.match(
  sources['src/platform/MaxPlatform.ts'],
  /wa\.disableVerticalSwipes\?\.\(\)/,
  'MAX adapter must suppress shell vertical swipes for drag controls'
);
assert.match(
  sources['src/platform/MaxPlatform.ts'],
  /navigator\.share/,
  'MAX adapter must retain a browser share fallback'
);

console.log('OFELIYA project identity isolation: ok');
