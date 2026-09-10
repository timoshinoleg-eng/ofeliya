import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');

assert.match(
  source,
  /type:\s*Phaser\.CANVAS/,
  'MAX startup must bypass unreliable WebGL framebuffer initialization'
);
