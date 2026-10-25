# Independent final release gate: PR #244, 2026-10-25

## Verdict on the submitted candidate: BLOCK

Candidate: `de6a74afd80607e6df24801a819d7e6cfa60af4f`.
Base: `qa/minimax-muse-convergence-20261025`,
`5725cbed7ff425aa7789d45d98aeaf730a749361`.
Live GitHub checks independently confirmed open, draft, mergeable/clean,
13 commits and 17 changed files. The entire product/test diff from this base
was reviewed, along with the inherited GameHostLifecycle, TelegramLifecycle,
QuestRuntime, Collection, scene ownership/cleanup and cross-flow harness.

## P2: a non-equivalent pre-hit flush mutation is accepted as equivalent

`scripts/check-quest-utc-attribution-mutations.mjs` classifies
`the final suppressed sample is omitted` as equivalent. Its explanation assumes
that a sample inside one run second cannot complete a whole streak second.
Damage can offset these two clocks, so that assumption is false.

Real QuestRuntime reproduction, with a monotonically advancing wall clock:

| run time ms | no-damage ms | action |
|---:|---:|---|
| 500 | 0 | forced damage/reset sample |
| 60000 | 59500 | delivered sample: 59 whole streak seconds |
| 60800 | 60300 | suppressed inside the same run second |
| 60900 | 0 | forced hit/reset |

Unchanged candidate: `dayMetrics.q_nodmg = 60`, `streakLast = 0`.
Exactly the existing omitted-flush mutant: `q_nodmg = 59`, `streakLast = 0`.
The catalog's `ghost` quest target is 60. This is an observable missed threshold,
not just a diagnostic event-count difference. An independent read-only reviewer
reproduced the counterexample and agreed with the classification.

This finding concerns regression protection. The candidate runtime itself retains
the correct pre-hit flush. Under the requested release rules, a gate that permits
this P2 regression blocks approval even though the original CI is green.

## Minimal follow-up

Branch: `review/codex-pr244-final-gate-20261025`, created from exact candidate.
No product code changes. Add the offset-streak threshold regression and remove
only the incorrect equivalent classification/comment. All 17 UTC entries remain:
14 required catches, 2 equivalents, 1 unchanged control. The core matrix retains
all 86 mutants plus its control.

RED: the new regression with the old equivalent classification causes
`the final suppressed sample is omitted: the equivalent mutation changed the result`.
The unmutated product passes the regression. The independent source-overlay probe
also demonstrates 60 versus 59 directly.

GREEN: the complete corrected UTC package gate passed locally: **14/14 caught,
2 equivalent, 1 control unchanged (Asia/Tokyo)**. No entries were removed.

The remaining equivalents were inspected: zero advance does not change credited
progress; checkpoint restoration restores the streak before the first sample
overwrites the old wall-clock anchor. Their equivalence is with respect to the
current product producer/resume path, not arbitrary out-of-contract engine calls.

## Independent historical RED/GREEN

- Actual Phaser 3.90, minimal live scenes: pre-`cc6bcfd` same-turn deactivate/activate
  leaves Game paused after the SceneManager update; candidate stays active.
- Actual Phaser 3.90: #241 returns with zero deactivated handlers after three
  Telegram/MAX/Browser/Telegram cycles; candidate returns with exactly one each
  time and still pauses/resumes. Duplicate events, deactivate/activate/deactivate,
  UI/manual ownership, cleanup to zero and reinstallation to one pass.
- Exact #241 engine overlay with the candidate UTC suite: case A fails `1 != 0`.
  Candidate passes: 23:59:59.200Z to 00:00:00.300Z credits zero new-day seconds.
- Exact pre-`edb8d0d` engine overlay: positive-reset regression fails `0 != 1`;
  candidate passes. The reset path converts seconds to milliseconds before floor.

The Phaser probe uses the installed real Phaser bundle and SceneManager;
host signals/adapter selection are controlled fixtures. Full native host behavior
is not inferred from those fixtures.

## Code and harness conclusions

Lifecycle uses synchronous SceneManager pause/resume, not queued ScenePlugin
operations. Scene shutdown/finish detach the installer. Resume clears host ownership;
UI blockers prevent releasing a pause they own. Resize rebinding uses SDK identity
and symmetric cleanup. The live cross-flow measures host state immediately after
the emitted events; readiness retries occur before that measurement. It does not
retry a failed host invariant. UI tap/reveal recovery and broad expected network
noise filtering remain limitations, but no reproducible hidden P1/P2 was found
there. Synthetic quest clocks/state preparation are explicitly distinct from the
real kill/pickup/mutation/hit/finish paths being asserted.

Quest review covered elapsed milliseconds, streak seconds, wall-clock epoch
milliseconds, persisted optional anchors, stale/equal ticks, terminal force and
old/malformed records. No additional reproducible runtime P1/P2 was established.
UTC pause intervals use the documented bounded-attribution policy; observations
cannot locate exact running subintervals during a long suspension.

Collection is unchanged by #244. Both parse and append retain the newest 1024
validated run IDs; repeated finish is guarded and storage failures are best effort.
Evicted historical IDs can be counted again; no normal replay path was found.
That bounded-window idempotency and optional-storage persistence remain P3 risks.

The 17-file candidate diff contains no payment, Stars, wallet, ledger, storefront
authority, permanent paid power, server-economy or monetization runtime changes.
PR #245 is not in this diff. The larger pre-existing main-to-staging history is
not the same diff: it includes earlier Daily receipt work, not a new #244 payment
feature. Direct merge-to-main integration must be assessed against the then-current
main; #244 itself targets the QA branch.

## Exact-head hosted evidence

Independently fetched GitHub run metadata, jobs/steps and raw build logs:
[CI 40181931371](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/40181931371),
`.github/workflows/ci.yml`, pull_request event, exact candidate SHA, completed SUCCESS.
`build`, `browser-smoke`, `production-contract` all completed SUCCESS.
Raw log confirms 86/86 + control and 13/13 + 3 equivalent + control.
These counts are authentic but do not prove the false equivalent assertion.

## Local verification and limits

Raw independent evidence is outside the repository:
`C:/Users/Имярек/Downloads/pr244-independent-gate-20261025/`.
The results ledger and logs distinguish every exit code; no infra failure counts
as a killed mutant. Local full-green evidence is not claimed where absent.

PASS: Muse client/convergence; quest core/runtime/UTC; Telegram runtime/TMA/share;
viewport; save; streaks; RNG; presentation; runtime quality; analytics;
review-browser; separate TypeScript and diff-check. The fresh cross-flow passed
with a dedicated Vite server rooted in this candidate, including final 59->60,
exact event count/timestamps, three adapter cycles and handler cleanup.
The sequential build retry and post-build bundle-shape check also passed with the
explicit immutable candidate stamp. Startup renderer contract passed separately.

Initial build and exact-base build both failed natively with
`memory allocation ... failed`, exit -1073740791. Initial Vite also died with
`Committing semi space failed ... heap out of memory`; dependent browser failures
are retained, not called passes. Local mutation attempts rejected infra failures
(candidate and exact base) rather than counting them as catches.

Startup font-readiness assertion failed identically on candidate and exact base:
`font readiness must not block the Mini App startup`, true != false, line 47.
No threshold, timeout, filter or runtime code was relaxed for this review.

## Physical acceptance and release decision

User-supplied acceptance evidence (not independently rerun here): Samsung S20+,
Android 13, Telegram 13.1.1, WebView 155, staging stamp `mini-app · android · de6a74a`;
launch/gameplay/mutation/touch and repeated background/manual-pause checks passed.
Native close confirmation remains inconclusive; OS/WebView eviction recovery
and physical MAX WebView remain NOT_RUN.

Original candidate must not be approved under the requested test-quality gate.
Review/merge the narrow follow-up into the #244 branch, verify the new exact SHA
and its full CI, then make the release decision. No merge or deploy performed.
