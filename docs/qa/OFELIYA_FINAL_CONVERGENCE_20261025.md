# OFELIYA final Muse + lifecycle + UTC convergence — 2026-10-25

## Identity

- Repository: `timoshinoleg-eng/ofeliya`.
- #241: `5725cbed7ff425aa7789d45d98aeaf730a749361`.
- #242: `466536ba49c87303eb6c27a5c17cf2d4ae38011b`.
- #243: `5ba7652d6749c628e682c381aa89537ca81ec81c`.
- Branch: `qa/ofeliya-p11-final-convergence-20261025`.
- Base: `qa/minimax-muse-convergence-20261025`, never main.
- Final product/test commit: `08ec7c1e01a28185eddeeb8a5ae62feeb2fb6b65` (subsequent commits only QA report/project memory).
- Draft PR / final exact HEAD / hosted conclusions: PENDING. The final immutable
  SHA and run IDs will also be recorded in the Draft PR body, avoiding a document
  self-hash cycle. Do not infer a final verdict from this pending snapshot.

## Provenance

Linear history: #241 -> eight commits of #243 -> `3bc9ef5` (exact cherry-pick of
#242) -> `edb8d0d` (confirmed P2 reset-unit repair) -> combined QA evidence.

#241 supplies the Muse client, synchronous host pause ownership (P1), Collection
ledger cap (P2), responsive presentation, telemetry and safe client integration.
#242 supplies the Telegram adapter-return lifecycle repair (P2): the existing
idempotent binder also listens to resize, with symmetric cleanup. #243 supplies
issue #237 UTC attribution (P2), optional persisted `lastTickAtMs`, and UTC tests
and mutation gates. Existing F5 terminal-force behavior is retained.

Additional confirmed P2 found during independent convergence review: the
positive-reset branch of `trackNoDamageStreak` assigned seconds to `progress`,
then divided by 1000 as milliseconds. Runtime samples at midnight -800ms
(59000/59000), +300ms (60100/60100), +2200ms (62000/1200) reproduced RED `0 !== 1`.
The one-line fix converts that branch to milliseconds before the shared floor;
the new regression passes. An independent paired exact-#241 engine probe also
showed the older engine crediting 10 seconds where #243 credited zero. Normal
GameScene damage hooks emit explicit zero; no physical-client incident is claimed.

## File overlap and structural verification

Live PR HEADs and actual git diffs were independently checked before integration.
#242 is exactly one commit with parent #241. Its seven files (lifecycle, crossflow,
QA report and four project memory files) do not intersect the nine #243 files
(quest engine/state/types, UTC suites, core mutation patterns, package and evidence).

Lifecycle source remains byte-identical to #242, including #241 synchronous
Scene Manager pause/resume. Quest state/types/runtime and package remain identical
to #243; engine differs only by the documented P2 unit fix. Mutation files and
matrix definitions are unchanged. No merge commits, conflict markers, duplicate
package script keys, source rollback, server/payment/deploy modifications or new
product functionality were introduced. CI still runs Muse client/adversarial and
crossflow gates; the existing quest-core commands include both UTC gates.

## Combined regression

| Command | Local result | Seconds (latest completed) |
|---|---|---:|
| `npm run build` | PASS | 25.7 |
| `npm run test:analytics` | PASS | 3.4 |
| `npm run test:bundle-shape` | PASS | 1.2 |
| `npm run test:impact-budget` | PASS | 2.5 |
| `npm run test:muse-client` | PASS | 6.7 |
| `npm run test:muse-convergence` | PASS | 2.5 |
| `npm run test:muse-convergence-crossflow` | PASS | 21.3 |
| `npm run test:presentation` | PASS | 14.7 |
| `npm run test:quest-core` | PASS | 5.7 |
| `npm run test:quest-core-mutations` | PASS | 282.8 |
| `npm run test:quest-runtime` | PASS | 3.2 |
| `npm run test:quest-scenes` | PASS | 37.3 |
| `npm run test:quest-utc-attribution` | PASS | 3.4 |
| `npm run test:quest-utc-attribution-mutations` | PASS | 57.3 |
| `npm run test:review-browser` | PASS | 18.9 |
| `npm run test:rng` | PASS | 3.8 |
| `npm run test:runtime-quality` | PASS | 2.4 |
| `npm run test:save` | PASS | 3 |
| `npm run test:startup` | PASS | 15.9 |
| `npm run test:streaks` | PASS | 1.6 |
| `npm run test:telegram-runtime` | PASS | 2.6 |
| `npm run test:telegram-share` | PASS | 1.1 |
| `npm run test:telegram-tma` | PASS | 6.4 |
| `npm run test:viewport` | PASS | 2.3 |
| 
px tsc --noEmit | PASS | separate explicit invocation |
| git diff --check | PASS | structural + final |

Raw local logs are retained outside the repository in
`C:/Users/Имярек/Downloads/ofeliya-final-evidence-20261025/`.

The existing Muse crossflow now retains one QuestRuntime/run ID across host
pause/resume and three complete Telegram -> MAX -> Browser -> Telegram cycles.
It checks restored `deactivated=1`, closing confirmation and stable subscription
counts. Injected quest wall-clock/elapsed samples are explicitly synthetic. After
return, +300ms across midnight earns zero whole seconds; terminal force delivers
59 -> 60, the exact elapsed/wall timestamps and exactly one tick plus completion.
Repeated finish preserves QuestState, and cleanup removes the lifecycle handler.
Existing late SDK, one-ready, viewport, UI-owned/manual pause and UI paths remain.

The initial added terminal fixture mistakenly used 120100 -> 121050 (different
producer seconds), so the second sample was immediately delivered: RED60!==59.
Corrected to the established 125000 -> 125950 F5 interval; no product code changed
for that harness mistake. The P2 product RED above is a separate finding.

## Mutation gates

Completed GREEN: core **86/86 caught + 1 control unchanged**; UTC **13/13 caught + 3 equivalent + 1 control unchanged**, Asia/Tokyo. The final unchanged-tree repeat also passed86/86 and13/13, including all equivalents/controls. Required matrices are retained: core86 mutants plus
one unchanged control; UTC13 non-equivalent mutants, documented equivalents and
unchanged control. A compile/infra failure must not count as a killed mutant.

## Persisted anchor and Collection compatibility

`QUEST_SAVE_VERSION` remains4. Added tests cover old v4 without anchor, new v4 with
anchor, null/string/negative/NaN/Infinity/object/array malformed fields, and
rollback-like loss of the optional field followed by real checkpoint resume and
re-upgrade. Invalid fields drop gracefully without discarding other progress;
resume across UTC days starts with zero credit, then earns one fresh second and
persists a new anchor. A separate in-memory probe transpiled the actual #241
parser: it reads new v4, retains streak/elapsed progress, drops the unknown anchor
on write, and the new parser reads that output. This models format compatibility,
not a promise that old executable code gains the new UTC fix.

Collection source is byte-identical to #241; existing adversarial checks retain
bounded1024 IDs,2000 counted runs, and recent duplicate idempotency. Evicted old
run IDs can still count again and potentially unlock a local cosmetic. No normal
source of such late redelivery has been identified: existing P3, no redesign.

## CI

PENDING exact combined HEAD. Previous #242/#243 GREEN runs are provenance only.
Release Visual Matrix and Render Density QA have path filters; record NOT_TRIGGERED
if this PR does not touch their paths, never claim those workflows passed.

## Remaining P3 / physical gate

- Collection1024 eviction semantics remain bounded-window, not lifetime dedup.
- Existing harness retries and broad expected-network console filtering remain
  QA limitations; no new retry/filter relaxation was added.
- Windows startup/review-browser and cloud quest-scene/crossflow failures require
  exact-base paired signatures before classification as pre-existing.
- Old v4 readers discard the optional anchor on write. Current resume gracefully
  re-establishes it; old executables retain their old UTC semantics. No additional
  reproducible P1/P2 was found in the compatibility paths tested here.
- Real Telegram WebView, real MAX WebView, native close dialog, Android keyboard /
  safe-area, and OS background/eviction: **NOT_RUN**.

Initial local build omitted mandatory `VITE_RELEASE_SHA` and failed only at stamp-release after TypeScript/Vite. This is an operator invocation error, not a product defect or a pre-existing flake. Corrected explicit-SHA build, bundle-shape and separate TypeScript all PASS. All browser suites, including Windows startup/review-browser and quest-scenes, passed; no environment flake was invoked.

No merge to main, production deploy, Render production action, real Stars/payment,
live D1 or live user data access. #241/#242/#243 branches remain unchanged.

Local gates: GREEN. Verdict: PENDING exact-head hosted CI. The next acceptance stage is physical Telegram
WebView on Samsung S20+; desktop Chromium is not physical acceptance.
