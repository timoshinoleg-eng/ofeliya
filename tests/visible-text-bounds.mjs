import assert from 'node:assert/strict';
import { visibleTextBounds } from '../scripts/visible-text-bounds.js';

const text = (value, bounds, extra = {}) => ({ text: value, getBounds: () => bounds, ...extra });
const screen = { left: 0, top: 0, right: 320, bottom: 568 };
const nested = text('nested overflow', { left: 8, right: 330, top: 22, bottom: 44 });
const hidden = text('hidden', { left: -99, right: -1, top: 0, bottom: 20 });
const transparent = text('transparent', { left: -99, right: -1, top: 0, bottom: 20 });
const masked = text('masked', { left: -99, right: -1, top: 0, bottom: 20 });
const transformed = text('transformed', { left: 40, right: 90, top: 100, bottom: 130 });
const root = { children: { list: [
  { list: [{ list: [nested, transformed] }] },
  { visible: false, list: [hidden] },
  { alpha: 0, list: [transparent] },
  { mask: {}, list: [masked] },
] } };

const found = visibleTextBounds(root);
assert.deepEqual(found.map(({ object }) => object.text), ['nested overflow', 'transformed', 'masked']);
assert.equal(found[0].bounds, nested.getBounds(), 'use Phaser world bounds, including the parent transform');
assert.equal(found[1].bounds, transformed.getBounds());
assert.equal(found[2].masked, true, 'inherit mask scope from an ancestor');
const unmaskedOverflow = found.filter(({ bounds, masked }) => !masked && (
  bounds.left < screen.left || bounds.right > screen.right ||
  bounds.top < screen.top || bounds.bottom > screen.bottom
));
assert.deepEqual(unmaskedOverflow.map(({ object }) => object.text), ['nested overflow']);
console.log('visible text bounds traversal: ok');
