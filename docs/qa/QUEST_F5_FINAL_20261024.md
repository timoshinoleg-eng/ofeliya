# F-5 Q2/Q3 standalone repair — 2026-10-24

Base: `5a2e04332ee3bc03b9683ef29543b81d121490bd`; local branch `fix/f5-q2-q3-20261024`.
Only this clone was edited. No push, merge, deployment, production requests, rewards, server or Daily changes. `memory/*` is deliberately unchanged per task instruction. Existing/unrelated untracked files are not part of this patch.

## Cause and repair

Invalid noDamageMs was coerced to zero, which cleared the inherited UTC streak baseline. A delayed smaller streak had the same effect because the engine did not track run-tick freshness. Runtime rounded both counters to seconds, hiding subsecond hits.

The engine now persists optional v4 `lastTickTimeMs`, rejects nonfinite/negative elapsed time and equal/older ticks, and ignores invalid streak payloads without resetting baseline. Freshness survives UTC rotation and storage reload; only new run/checkpoint restoration opens a new elapsed-time timeline. Checkpoint restoration preserves the q_time peak. Older v1–v4 records remain readable; no save-version bump.

Streak/baseline retain millisecond precision in their existing seconds fields; subtraction converts operands back to milliseconds before flooring progress, including 31001→32001. Producer tracks exact samples, rejects stale input and flushes the latest suppressed sample before a hit. A trusted same-time hit uses the existing streak-reset seam without forging time or admitting equal-time core events.

## RED / GREEN evidence

RED was run against unchanged production source at the required base before implementation; tests were added first. Exact first reproduction: quest-core exit 1, five F5 checks failed. quest-runtime exit 1 after adding the direct delivery assertion (an initial maximum-only assertion passed and did not prove hit delivery).

| RED: base source | GREEN: repaired source |
| --- | --- |
| Missing noDamageMs after rollover/reload: actual 102, expected 2 | PASS in final core/runtime run |
| NaN noDamageMs after rollover/reload: actual 102, expected 2 | PASS in final core/runtime run |
| Stale timeMs=50000 after 101000: actual 102, expected 2 | PASS in final core/runtime run |
| Equal timeMs: accepted=true, expected=false | PASS in final core/runtime run |
| Same-second stale 1010 after 1099: accepted=true, expected=false | PASS in final core/runtime run |
| Subsecond hit delivery 100→900→950/reset: producer dropped it | PASS in final core/runtime run |
| 31001→32001 boundary: base control passed; subsequent equal tick failed | PASS in final core/runtime run |
| Existing valid hit, resume, v3→v4 migration tests: retained controls | PASS in final core/runtime run |

The final expanded suite was also replayed against source extracted with `git show 5a2e043…:src/quests/...` into a disposable fixture under this clone (not a worktree). Core exit 1: seven failing groups, including stale-after-reload accepted=true and checkpoint q_time peak 1 instead of 33. Runtime exit 1: same-second hit delivery assertion. This replay happened after implementation; the initial five-group RED and runtime delivery RED above preceded production edits. Valid increasing hit and 31001→32001 were passing base controls, while the existing v3→v4 migration coverage remains intact.

| Additional base RED | Repaired GREEN |
| --- | --- |
| Reload then stale 50000 after persisted 101000: accepted=true | accepted=false; new-day streak=2 |
| Restore checkpoint at 1000 after peak 33000: q_time=1 | q_time=33; advancing 1010 tick accepted |

## Validation

- `npm.cmd ci --offline --no-audit --no-fund`: exit 0, 46 packages.
- `npm.cmd run test:quest-core`: exit 0, complete original suite + F5 checks.
- `npm.cmd run test:quest-runtime`: exit 0, original producer contracts + subsecond hit, stale producer, ordinary equal-time rejection and trusted equal-time reset.
- `npm.cmd run test:quest-core-mutations`: exit 0, **86/86 caught, 1 control unchanged**, Asia/Tokyo. Original 83 mutants retained; 3 freshness mutants added. An intermediate 85/86 run exposed a compile-only failure in the peak-ID mutant. The freshness guard now narrows by event.kind independently of the ID bookkeeping flag, so that mutant is killed by an assertion, not compilation.
- `npx.cmd --no-install tsc --noEmit`: exit 0.
- `npm.cmd run build` with explicit `VITE_RELEASE_SHA=5a2e04332ee3bc03b9683ef29543b81d121490bd`: initial sandbox attempt exit 1 (esbuild parent-directory read denied), escalated local retry exit 0; 118 modules, Vite build 13.78s. Base SHA is only a local artifact label for the tested dirty tree, not a claim that base source contains the fix. Warnings: runtime-config.js lacks type=module; two Chakra Petch URLs unresolved at build time. No publication.
- `npm.cmd run test:quest-scenes`: exit 0 using installed Chrome against isolated local Vite port 5187. PASS actual GameScene/Enemy/Gem/choice/damage/end + board x10 at widths **320, 390, 768, 1080**. Synthetic localStorage only; existing screenshots restored byte-for-byte. Original assertions/timeouts unchanged.
- `git diff --check`: exit 0. No tracked files outside the four quest sources and three test scripts changed; this report is the only additional artifact.

Mutation infrastructure: initial native Node 22.23.0 `cpSync` crash (`0xC0000409`) occurred before assertions, also outside sandbox. With a workspace TMP, copying exposed EIO/access-denied; overwrite exposed a native unlink failure. Harness now copies every fixture file using read/write and uses a Windows junction for node_modules. No mutations, control, assertion or thresholds were removed. These infrastructure failures are not counted as killed mutants.

No `build:max` or publication was requested or performed. Browser/device and hosted CI evidence remain distinct from local tests.

## Remaining limits

No hosted CI, physical MAX/Telegram WebView acceptance or release validation was established during this local Codex run. This repair does not add a reward gateway or change score/ruleset/campaign versions. At Codex handoff, its single staging attempt failed with `.git/index.lock: Permission denied` inside its sandbox; the worktree was left unstaged on `fix/f5-q2-q3-20261024`, at original HEAD `5a2e04332ee3bc03b9683ef29543b81d121490bd`. Subsequent authorized QA-only git commits/pushes, if performed, must be verified separately against the actual Git history and CI; they are not claimed by this report. Existing unrelated untracked task/MiniMax artifacts were untouched. The local Vite server was stopped.

## Terminal force follow-up — 2026-10-24

Base/head before repair: `d4a73c1bbb41997aa3f57a47e758d224a9ac5b96`.
Branch: `fix/f5-q2-q3-20261024`; existing Draft PR #233 targets `qa/ofeliya-muse-quests-staging-20261023` (verified through GitHub before edits).
This section supersedes the earlier local-only handoff for this follow-up only.

Cause: producer freshness (`lastTimeMs`) already included the suppressed 60950ms observation, so equal-time force returned before delivery even though engine freshness (`sentTimeMs`) remained 60000ms. The engine's strict increasing-time guard is unchanged. Equal-time force now accepts only the identical pending observation (or the existing trusted damage reset); it cannot increase the observed streak, replay delivered ticks or manufacture +1ms.

RED before production edits: `npm.cmd run test:quest-runtime`, exit **1**, assertion `terminal force preserves 60 real seconds (not 59)`, actual **59**, expected **60**. Exact requested sequence: begin; 900/900; forced 950/0; 60000/59050; 60950/60000; forced 60950/60000; end.
GREEN runtime: same command exit **0**, `q_nodmg=60`, `lastTickTimeMs=60950`. Added invalid/missing/NaN/stale/inflated force, duplicate final force, duplicate end, terminal checkpoint reload, no claims, active checkpoint across UTC midnight and equal-time damage reset regressions. Original tests retained.
Browser scene regression additionally uses actual `onPlayerHit` and `finish` after an observed pending sample, asserts the exact final timestamp/streak, and retains duplicate-finish and LocalStorage checkpoint lifecycle checks at all four widths.

Sequential local validation of this follow-up:
- `npm.cmd run test:quest-core`: exit 0, full catalog/storage/UTC/accounting/idempotency suite PASS.
- `npm.cmd run test:quest-runtime`: exit 0, original contracts and new terminal regressions PASS.
- `npm.cmd run test:quest-core-mutations`: exit 0, **86/86 caught, 1 control unchanged**, Asia/Tokyo; no mutants/control/thresholds changed.
- `npx.cmd --no-install tsc --noEmit`: exit 0.
- `$env:VITE_RELEASE_SHA='d4a73c1bbb41997aa3f57a47e758d224a9ac5b96'; npm.cmd run build`: exit 0, 118 modules. SHA labels the base plus tested working-tree patch, not immutable release acceptance. Warnings: runtime-config.js lacks type=module; two Chakra Petch URLs resolve at runtime.

Independent Luna read-only review approved the final runtime/test diff. Review conclusions were checked against the guard and passing assertions. No core/state/GameScene production changes were needed.

Remaining limits: physical Telegram/MAX WebView **NOT_RUN**; local browser automation is not device/release acceptance. UTC accounting still uses the clock at event delivery; this narrow repair does not introduce per-observation wall-clock timestamps for subsecond samples across midnight. Hosted exact-commit CI must be checked separately after push. No rewards are granted by end; no merge/deploy, main, Render, server, payment, Daily, memory or user data mutations. Existing unrelated untracked artifacts remain untouched.
- `npm.cmd run test:quest-scenes` with OFELIYA_BASE_URL=http://127.0.0.1:5187/: exit 0, PASS actual GameScene/Enemy/Gem/choice/damage/end + board x10 at 320/390/768/1080. Local Vite stopped; existing screenshot artifacts restored byte-for-byte.
- Final git diff --check: exit 0. Delivery scope: exactly four files (runtime, runtime test, scene test, this report).
