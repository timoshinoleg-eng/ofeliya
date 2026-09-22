import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve('.');
const badgeSource = readFileSync(join(root, 'src/ui/FounderBadge.ts'), 'utf8');
const menuSource = readFileSync(join(root, 'src/scenes/MenuScene.ts'), 'utf8');

assert.match(badgeSource, /FOUNDER_BADGE_ITEM_ID\s*=\s*'founder-badge-v1'/);
assert.match(badgeSource, /FOUNDER_BADGE_LABEL\s*=\s*'ЗНАК ОСНОВАТЕЛЯ'/);
assert.match(menuSource, /hasFounderBadge\(profile\)/, 'menu must require parsed server entitlement');
assert.doesNotMatch(menuSource, /founder-badge-v1/, 'internal entitlement id must stay out of MenuScene copy');

const forbiddenRoots = [
  'src/game',
  'src/systems/ScoreClient.ts',
  'src/systems/DailyRunClient.ts',
  'src/systems/RunCheckpoint.ts',
];

function filesUnder(path) {
  const abs = join(root, path);
  if (!statSync(abs).isDirectory()) return [abs];
  const out = [];
  for (const name of readdirSync(abs)) {
    const child = join(abs, name);
    if (statSync(child).isDirectory()) out.push(...filesUnder(child.slice(root.length + 1)));
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) out.push(child);
  }
  return out;
}

for (const target of forbiddenRoots) {
  for (const file of filesUnder(target)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /FounderBadge|founder-badge-v1/,
      `cosmetic entitlement leaked into gameplay/scoring path: ${file.slice(root.length + 1)}`
    );
  }
}

console.log('founder badge horizontal contract: ok');
