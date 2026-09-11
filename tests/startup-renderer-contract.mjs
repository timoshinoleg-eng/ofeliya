import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');

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
