#!/usr/bin/env node
/**
 * Player language guard (Wave 1 "language foundation").
 *
 * Static, zero-dependency check: extracts string literals from the
 * player-facing copy sources and fails when internal/implementation
 * vocabulary or English leakage reaches player-visible text.
 *
 * Canonical vocabulary: docs/GAME_LANGUAGE_BIBLE.md
 * Scope note: this guard OWNS its own token list and does not modify
 * scripts/visual-readability-smoke.cjs (owned by PR #92).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Files whose string literals are treated as player-facing copy.
const SCOPED_FILES = [
  'src/game/identity.ts',
  'src/game/UpgradeSystem.ts',
  'src/game/LegendarySystem.ts',
  'src/game/StageDefinitions.ts',
  'src/game/DifficultyProfile.ts',
  'src/game/ControlMode.ts',
  'src/game/AchievementSystem.ts',
  'src/scenes/MenuScene.ts',
  'src/scenes/UIScene.ts',
  'src/ui/SocialHub.ts',
  'src/legal/LegalOverlay.ts',
];

// Rule A: internal/implementation vocabulary and EN leakage — never in player copy.
const FORBIDDEN_ANY = [
  'Core Window',
  'host cell',
  'host cells',
  'enemy pool',
  'projectile pool',
  'heartbeat impact',
  'radial wave',
  'mutation form',
  'RULESET',
  'CHECKPOINT RESUME',
  'TWIN-STICK',
  'IMMUNE PRIME',
  'CARDIAC TITAN',
  'Fixed-Seed',
  'Pre-release',
  'npm run',
  'survivor',
  /\bCodex\b/,
  /\bLEGENDARY\b/,
];

// Rule B: EN tokens inside Cyrillic copy (internal ids live in non-Cyrillic literals).
const FORBIDDEN_IN_CYRILLIC = [
  /\bswarm\b/i,
  /\belite\b/i,
  /\bboss(es)?\b/i,
  /\bheart\b/i,
  /\blysis\b/i,
  /\bseed\b/i,
  /\bstandard\b/i,
  /\bstrained\b/i,
  /\bHP\b/,
  /\bXP\b/,
  /\bRNA\b/,
];

const CYRILLIC = /[\u0400-\u04FF]/;

// Documented exception: the legal overlay carries an operator-facing publication
// note that mentions the build command. It is not gameplay copy.
const ALLOWLIST = [
  { file: 'src/legal/LegalOverlay.ts', token: 'npm run' },
];

/** Extract string literals (', ", `) skipping comments; returns [{value, line}]. */
function extractLiterals(source) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = source.length;
  const lineOf = (idx, from) => from + (source.slice(from, idx).match(/\n/g)?.length ?? 0);
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const upto = end === -1 ? n : end + 2;
      line += (source.slice(i, upto).match(/\n/g)?.length ?? 0);
      i = upto;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const startLine = line;
      let value = '';
      i++;
      while (i < n) {
        const ch = source[i];
        if (ch === '\\') {
          const r = source[i + 1];
          value += r === 'n' ? '\n' : r;
          line += r === 'n' ? 0 : 0;
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        if (ch === '\n') {
          if (quote !== '`') break; // unterminated single-line literal: stop
          line++;
        }
        value += ch;
        i++;
      }
      out.push({ value, line: startLine });
      continue;
    }
    if (c === '\n') line++;
    i++;
  }
  return out;
}

function isAllowed(file, token) {
  return ALLOWLIST.some((a) => a.file === file && a.token === token);
}

/** Remove `${...}` template expressions: they contain code (ids, conditions), not copy. */
function stripTemplateExpressions(literal) {
  return literal.replace(/\$\{[^}]*\}/g, ' ');
}

function tokenMatches(token, literal) {
  if (token instanceof RegExp) return token.test(literal);
  return literal.toLowerCase().includes(token.toLowerCase());
}

const violations = [];
let scanned = 0;

for (const file of SCOPED_FILES) {
  const abs = join(root, file);
  let source;
  try {
    source = readFileSync(abs, 'utf8');
  } catch {
    violations.push(`${file}:0 file missing from scoped set`);
    continue;
  }
  for (const { value, line } of extractLiterals(source)) {
    const copyPart = stripTemplateExpressions(value);
    // Neutralize allowed brand proper nouns, then skip non-letter strings.
    const testable = copyPart.replaceAll('OFELIYA', 'БРЕНД').replaceAll('STRAIN-0', 'ШТАММ0');
    if (!/[A-Za-z\u0400-\u04FF]/.test(testable)) continue;
    scanned++;
    const cyrillic = CYRILLIC.test(copyPart);
    for (const token of FORBIDDEN_ANY) {
      if (tokenMatches(token, testable) && !isAllowed(file, token instanceof RegExp ? token.source : token)) {
        violations.push(`${file}:${line} forbidden token '${token instanceof RegExp ? token.source : token}' in: ${value.slice(0, 90)}`);
      }
    }
    if (cyrillic) {
      for (const token of FORBIDDEN_IN_CYRILLIC) {
        if (token.test(testable)) {
          violations.push(`${file}:${line} forbidden token '${token.source}' in cyrillic copy: ${value.slice(0, 90)}`);
        }
      }
    }
  }
}

const guardSource = readFileSync(join(root, 'src/ui/MobileLayoutGuard.ts'), 'utf8');
const structuralSources = [
  ['src/scenes/MenuScene.ts', [
    'ofeliya-menu-title',
    'ofeliya-menu-hook',
    'ofeliya-menu-subtitle',
    'ofeliya-menu-carrier',
    'ofeliya-menu-challenge-header',
    'ofeliya-menu-challenge-target',
    'ofeliya-menu-challenge-meta',
    'ofeliya-menu-action',
    'ofeliya-menu-action-hint',
  ]],
  ['src/scenes/UIScene.ts', [
    'ofeliya-result',
    'ofeliya-result-title',
    'ofeliya-result-time',
    'ofeliya-result-stats',
    'ofeliya-result-retry',
    'ofeliya-result-share',
    'ofeliya-result-menu',
  ]],
];

for (const [file, anchors] of structuralSources) {
  const source = readFileSync(join(root, file), 'utf8');
  for (const anchor of anchors) {
    if (!source.includes(anchor)) violations.push(`${file}: missing structural layout anchor ${anchor}`);
    if (!guardSource.includes(anchor)) violations.push(`src/ui/MobileLayoutGuard.ts: anchor not consumed ${anchor}`);
  }
}
for (const legacySelector of ['RESULT_BUTTONS', 'RESULT_TITLES', 'byExact(', 'text.text.startsWith(']) {
  if (guardSource.includes(legacySelector)) {
    violations.push(`src/ui/MobileLayoutGuard.ts: mutable-copy selector remains: ${legacySelector}`);
  }
}

if (violations.length > 0) {
  console.error(`player language guard: ${violations.length} violation(s)`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`player language guard: ok (${scanned} literals scanned)`);