'use strict';

// The same decision must gate result-screen advancement and the score
// contract: a replay of an --until recording stopped before that window.
function shouldAdvancePostRun({ runEnded, untilReached, isReplay, recordedPostRunAdvance }) {
  return Boolean(runEnded && !untilReached && (!isReplay || recordedPostRunAdvance !== false));
}

// Missing flag is a legacy recording (which advanced after a completed run).
// A null flag marks a failed advance: the frame checkpoint is untrustworthy.
function parseRecordedPostRunAdvance(value) {
  if (value === null) {
    throw new Error('inputs.json: postRunAdvance is uncertain; replay is unsafe');
  }
  return value !== false;
}

module.exports = { shouldAdvancePostRun, parseRecordedPostRunAdvance };
