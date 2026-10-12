// P0-3 (daily mutator): bumped 2 → 3. Server daily tickets are stamped with
// CURRENT_RULESET_VERSION, and the daily submit rejects a ruleset mismatch
// (422), so cached v2 clients can no longer submit after this lands. Legacy
// run checkpoints (v2) stay readable — see RunCheckpoint.validateRunCheckpoint.
export const SCORE_RULESET_VERSION = 3;
export const SCORE_CAMPAIGN_VERSION = 2;
