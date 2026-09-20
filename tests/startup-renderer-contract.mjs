import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
const traceSource = await readFile(new URL('../src/systems/StartupTrace.ts', import.meta.url), 'utf8');
const runtimeConfig = await readFile(new URL('../public/runtime-config.js', import.meta.url), 'utf8');

assert.match(
  source,
  /return webGLPreflight\(\) \? Phaser\.WEBGL : Phaser\.CANVAS/,
  'Renderer policy must prefer WebGL after a successful preflight and retain Canvas fallback'
);
assert.match(
  source,
  /webglcontextlost/,
  'WebGL renderer must recover to the Canvas fallback if the MAX WebView loses its context'
);
assert.match(
  source,
  /rendererType === Phaser\.CANVAS\) installCanvasTextResolutionGuard\(\)/,
  'Canvas-only text resolution guard must not degrade normal WebGL text quality'
);
assert.doesNotMatch(
  source,
  /type:\s*Phaser\.CANVAS/,
  'Production startup must not force every device into low-resolution Canvas rendering'
);

assert.match(
  source,
  /StartupTrace\.mark\('viewport\.first\.start'\)/,
  'Startup trace must cover the first platform viewport wait'
);
assert.match(
  source,
  /StartupTrace\.mark\('phaser\.construct\.start'\)/,
  'Startup trace must cover Phaser construction'
);
assert.match(
  runtimeConfig,
  /ofeliya_startup_nav_v1/,
  'Pre-module runtime config must preserve cross-navigation startup timing'
);
assert.match(
  traceSource,
  /ofeliya_startup_trace_history_v1/,
  'Startup traces must persist locally for later diagnosis'
);
assert.match(
  traceSource,
  /startupTrace/,
  'Startup trace must expose an explicit debug-view query mode'
);
for (const forbidden of ['initData', 'getUser', 'username', 'first_name', 'last_name', 'query_id']) {
  assert.doesNotMatch(
    traceSource,
    new RegExp(forbidden, 'i'),
    `Startup trace must not collect personal identity field: ${forbidden}`
  );
}
