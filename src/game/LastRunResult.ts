import type { ChallengePayload } from './Challenge';
import type { DailyResultBranch } from './DailyRunIntent';
import type { DuelChallengeSnapshot } from './Duel';
import type { RunResult } from './RunContracts';

/**
 * A finished run kept alive across the Codex transition, so the result
 * screen can be re-shown from the Menu without starting the Game scene.
 * Written at the opening-row tap (and only there), before the Game scene
 * is stopped: the Game SHUTDOWN handler removes `runResult` from the
 * registry, so the re-show cannot read it back.
 *
 * `dailyBranch` is the branch resolved at the first render. The first
 * render clears the daily intent and ticket (`clearDailyIntent`), so a
 * re-show cannot re-resolve the branch from the registry: without the
 * snapshot a daily result would re-render as a ranked standard one.
 *
 * `duelChallenge` and `challengeTarget` are snapshotted for the same
 * reason: the Menu's `create()` resets both when it starts after the
 * Codex transition (`duelChallenge` to null, `challengeTarget` to the
 * incoming link, usually null). Without them the re-shown result could
 * not offer a duel rematch or a challenge share. The snapshot is a
 * render-only fact — it never re-runs `finish`, `recordRun`, the score
 * submit, or the video interstitial.
 *
 * Lives in its own module, not in `RunContracts`: the snapshot's types
 * come from the daily/duel/challenge modules, and `RunContracts` is
 * imported by clients and systems (and by the Node unit tests, whose
 * `tsc --module commonjs` invocation cannot type-check the
 * `import.meta.env` in the transitively reached `VideoInterstitial`).
 * Only the two scenes that read/write the snapshot import this module.
 */
export interface LastRunResult {
  result: RunResult;
  dailyBranch: DailyResultBranch;
  duelChallenge: DuelChallengeSnapshot | null;
  challengeTarget: ChallengePayload | null;
}
