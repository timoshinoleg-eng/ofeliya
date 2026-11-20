'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  shouldAdvancePostRun,
  parseRecordedPostRunAdvance,
} = require('./replay-postrun-policy.cjs');

const cases = [
  ['active game never advances', false, false, false, undefined, false],
  ['normal terminal run advances', true, false, false, undefined, true],
  ['normal terminal until run does not advance', true, true, false, undefined, false],
  ['replay of terminal until recording does not advance', true, false, true, false, false],
  ['replay with explicitly recorded advance does advance', true, false, true, true, true],
  ['legacy replay without flag preserves old advance', true, false, true, undefined, true],
  ['unfinished replay does not advance even with recorded flag', false, false, true, true, false],
  ['replay stopped by a new --until does not advance', true, true, true, true, false],
];
for (const [name, runEnded, untilReached, isReplay, recordedPostRunAdvance, expected] of cases) {
  test(name, () => {
    assert.equal(shouldAdvancePostRun({
      runEnded, untilReached, isReplay, recordedPostRunAdvance,
    }), expected);
  });
}

test('legacy missing post-run flag defaults to true', () => {
  assert.equal(parseRecordedPostRunAdvance(undefined), true);
});
test('explicit post-run flag remains true or false', () => {
  assert.equal(parseRecordedPostRunAdvance(true), true);
  assert.equal(parseRecordedPostRunAdvance(false), false);
});
test('uncertain post-run checkpoint is refused on replay', () => {
  assert.throws(
    () => parseRecordedPostRunAdvance(null),
    /postRunAdvance is uncertain; replay is unsafe/,
  );
});
