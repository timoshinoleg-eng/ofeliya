/**
 * Production image contract: every server module a container entrypoint imports must
 * actually be present in that container image.
 *
 * Why this exists
 * ---------------
 * `deploy/Dockerfile` does NOT copy the whole `server/` tree. Each image stage copies
 * the individual `server/*.mjs` modules it needs:
 *
 *   FROM node:22-alpine AS score
 *   COPY --chown=node:node server/index.mjs ./server/index.mjs
 *   COPY --chown=node:node server/durable-state.mjs ./server/durable-state.mjs
 *   ...
 *
 * Adding a new module to `server/` therefore does NOT add it to the image. A missing
 * COPY line produces a container that starts and then dies with
 * `ERR_MODULE_NOT_FOUND` — a failure that only surfaces when the image is built and
 * booted, i.e. in the slowest and most expensive possible place.
 *
 * This check resolves the entrypoint of every Dockerfile stage, computes the transitive
 * closure of its local (relative) imports, and asserts that each required file is
 * covered by that stage's COPY sources. It is a static check: no Docker, no network,
 * and it fails in under a second.
 *
 * Wired into `npm run server:test` (which the `production-contract` CI job runs), and
 * deliberately placed FIRST in that chain so a missing module fails immediately
 * instead of after a full image build.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = join(ROOT, 'deploy', 'Dockerfile');

/** Parse `FROM <image> AS <name>` stages out of a Dockerfile. */
function parseStages(source) {
  const stages = [];
  let current = null;
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const from = line.match(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i);
    if (from) {
      current = { name: (from[2] ?? from[1]).toLowerCase(), copies: [], cmd: null };
      stages.push(current);
      continue;
    }
    if (!current) continue;
    const copy = line.match(/^COPY\s+(.*)$/i);
    if (copy) {
      const tokens = copy[1].split(/\s+/).filter(Boolean);
      const sources = tokens.filter((token) => !token.startsWith('--'));
      // The last token is the destination; everything before it is a source.
      for (const src of sources.slice(0, -1)) current.copies.push(src.replace(/^\.\//, '').replace(/\/$/, ''));
      continue;
    }
    const cmd = line.match(/^CMD\s+(\[.*\]|\S.*)$/i);
    if (cmd) {
      try {
        current.cmd = JSON.parse(cmd[1]);
      } catch {
        current.cmd = cmd[1].split(/\s+/);
      }
    }
  }
  return stages;
}

/** Local (relative) module specifiers imported by a file. */
function localImports(absolutePath) {
  if (!existsSync(absolutePath)) return [];
  const source = readFileSync(absolutePath, 'utf8');
  const specifiers = new Set();
  const pattern = /from\s+['"](\.[^'"]+)['"]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) specifiers.add(match[1]);
  return [...specifiers];
}

/** Transitive closure of the relative imports of a file, as repo-relative paths. */
function importClosure(absolutePath) {
  const seen = new Set();
  const queue = [absolutePath];
  while (queue.length > 0) {
    const file = queue.shift();
    const key = relative(ROOT, file);
    if (seen.has(key)) continue;
    seen.add(key);
    for (const specifier of localImports(file)) {
      const resolved = resolve(dirname(file), specifier);
      if (existsSync(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

/** Does a stage COPY cover this repo-relative file? */
function isCovered(copies, repoRelativePath) {
  const parts = repoRelativePath.split('/');
  return copies.some((copy) => {
    if (copy === '.') return true;
    if (copy === repoRelativePath) return true;
    // A directory COPY covers everything beneath it.
    if (!copy.includes('.')) return repoRelativePath.startsWith(copy + '/');
    return false;
  });
}

const dockerfile = readFileSync(DOCKERFILE, 'utf8');
const stages = parseStages(dockerfile);
assert.ok(stages.length > 0, 'deploy/Dockerfile must declare at least one stage');

let checkedStages = 0;
let checkedModules = 0;
const problems = [];

for (const stage of stages) {
  const cmd = Array.isArray(stage.cmd) ? stage.cmd : [];
  // The entrypoint is the first argument that looks like a local .mjs file.
  const entry = cmd.find((token) => typeof token === 'string' && token.endsWith('.mjs') && !token.startsWith('/'));
  if (!entry) continue;

  const entryPath = resolve(ROOT, entry);
  if (!existsSync(entryPath)) {
    problems.push(`stage "${stage.name}": entrypoint ${entry} does not exist in the repository`);
    continue;
  }

  checkedStages++;
  const required = importClosure(entryPath);
  for (const modulePath of required) {
    if (modulePath === relative(ROOT, entryPath)) continue; // the entrypoint itself
    checkedModules++;
    if (!isCovered(stage.copies, modulePath)) {
      problems.push(
        `stage "${stage.name}" (CMD ${entry}) does not COPY ${modulePath} — ` +
          `the image would fail with ERR_MODULE_NOT_FOUND`,
      );
    }
  }
}

assert.ok(checkedStages > 0, 'no Dockerfile stage with a local .mjs entrypoint was verified');

if (problems.length > 0) {
  for (const problem of problems) console.error('[server-image] ' + problem);
  console.error(
    `[server-image] ${problems.length} missing module(s). Add a COPY line to deploy/Dockerfile for every stage that needs it.`,
  );
  process.exit(1);
}

console.log(
  `[server-image] OK — ${checkedStages} image stage(s), ${checkedModules} imported module(s) all present in deploy/Dockerfile`,
);
