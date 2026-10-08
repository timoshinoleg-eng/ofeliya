# DECISIONS — OFELIYA: STRAIN ZERO

## Latest combat continuation (08.10)
Use boot-baked local warp, fixed frame dimensions and Scene.time.now; never alter physics sprite scale/rotation for hit. Death snapshot only after disableBody, Imagepool4/2, skipdensity150, serialguards/trim/shutdown. Do not invent swarmcharge or delay player results for cosmeticdeath. Additional3.36MiBRGBA+GPU requires phone measurement; no productionHiDPI activation. Furtherfeaturemerge/deploy needs scoped ownerapproval.


Формат: `[дата] Решение — причина. Статус.`
Перенесённые решения помечены источником (документы репо). Новые решения добавляются сюда после каждой сессии.

- [2026-10-06] The control-mode smoke freezes only the Game instance update before startup and asserts UI unblocked/modal-free state before synthetic pointer routing — the original failure was a valid `uiBlocked` rejection during automatic mutation choices, not a TwinStick production defect. Production unchanged; reviewer approved; root owns CI follow-up.

- [2026-10-05] The deploy script loads its compatibility gate from fetched `origin/main` rather than a sibling path — the bastion executes an extracted standalone script from `/tmp`; keep helper policy centralized, fail closed on missing/empty policy, and retain all SHA/floor guards. Review/PR and fresh main CI pending.

- [2026-10-05] Deployment CI lookup uses the workflow-specific `ci.yml` runs endpoint filtered by exact SHA and run identity, with a pinned Ubuntu 22.04 runner and bounded diagnostic summaries — the prior broad runs query did not yield the independently verified exact-SHA green run; root cause remains unproven. Retain all fail-closed predicates. Review/publish pending.

- [2026-10-05] Deploy CI reads the Actions runs payload from a temporary file, not an environment variable — large responses exceed Linux argument/environment limits before Node starts; retain all five successful-main-CI identity criteria and fail closed. Implemented in `fix/deploy-ci-payload-20261005`; review/publish by root pending.

- [2026-09-20] Исторические спринт-документы — не источник истины; при конфликте правят `STRAIN_ZERO_PRODUCT_BIBLE.md` и `ARCHITECTURE_NOTES.md`. Причина: устаревшие планы создавали ложные требования. Действует. *(источник: PLAN.md)*
- [2026-09-20] Кампания двухактовая: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN; старый концепт 3–5 минут не использовать. Действует. *(источник: PLAN.md)*
- [ранее] Renderer остаётся Phaser-only — без GSAP / Matter.js / tsParticles / второго рендера. Причина: мобильная производительность и предсказуемость. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [ранее] Codex/mastery — информационный прогресс, не даёт постоянной силы. Причина: мета не должна ломать баланс забегов. Действует. *(источник: RELEASE_VALIDATION.md)*
- [ранее] Профиль игрока V1 — отдельный `profiles.json`, advisory-only, без billing; запись синхронная (tmp+rename). Причина: rollback-safety при откатах. Действует. *(источник: ARCHITECTURE_NOTES.md)*
- [2026-09-28] [пилот] Память проекта = файлы репозитория (`memory/`), чат — не источник истины; протокол: вход 3 файла / выход 4 файла. Причина: устранить потери контекста между сессиями и инструментами. На проверке пилотом.
- [2026-09-28] Пилот на Honor признан рабочим: OmniRoute ↔ OpenCode ↔ context-mode ↔ скиллы проверены живыми прогонами; ветка приёмки синхронизируется с main и проходит канонический гейт до merge. Действует.
- [2026-09-29] Квик-вины доставлены в main (PR #137, merge `5b74f66`); `feat/donor-quick-wins` = main + система памяти (+269, 6 файлов) — регрессий кода в ветке нет (подтверждено двумя проходами ревью и smoke-прогонами). Действует.
- [2026-09-29] Ревью-проходы пилота выполняются на отдельном комбо `BACKGROUND-REVIEW`; смена модели внутри одной сессии OpenCode сохраняет контекст (проверено на тест-цикле B). Действует.
- [2026-09-29] Служебные локальные каталоги (`.agents/`, `.openclaw/`, `.opencode/`, `.cluster/`, `config/`, `handoff-system/`, `ofelia-pilot/`, `skills/`, `*.capability.json`) в коммиты не включать; кандидаты на `.gitignore` — отдельной задачей. Действует.
- [2026-09-29] Внешнее ревью прогона приёмки выполнено внешней моделью (`nvidia/nemotron-3-ultra`, OpenRouter) — полноценный внешний прогон; ChatGPT-вариант отложен по решению Олега. Результат — `memory/06_REVIEW.md`. Действует.
- [2026-09-29] Второе внешнее мнение (`space-bunny-free`) применено: пост-ревью правки памяти (PR #154) — актуализация ссылок/метрик, worktree переведён на `main`. Правило: числа и ссылки в памяти — только из git-вывода. Действует.
- [2026-10-02] P0 mobile acceptance считается пройденной только при 16/16 воспроизводимых evidence-записях Android/iOS (device, MAX client version, timestamp, evidence); browser/CI и устное «работает» не заменяют real-device gate. Действует.
- [2026-10-02] First-run onboarding обучает продуктовым механикам, а не служебной паузе: движение → автоогонь → RNA → мутация → заражение клетки-хозяина. Действует.
- [2026-10-02] Продуктовые решения измеряются по verified actor funnel `app_open → run_start → run_60s → boss1 → heart → replay`, D1 и referral open → run_start; share-click/views сами по себе не являются итоговой метрикой. Действует.

## Telegram deployment isolation 03.10
- Telegram is an optional dedicated production profile, not a replacement for or credential-sharing extension of the MAX bot.
- Any partial Telegram configuration fails deployment closed. MAX-only deployment remains valid with all Telegram values empty.
- Telegram bot and score server may share only the OFELIYA persistent data volume needed for referral/user state; bot identities/tokens remain separate.

## Versioned edge policy 03.10
- Production Caddy site/TLS wrapper may stay host-local, but OFELIYA route/security policy must be rendered from versioned deploy/Caddyfile.ofeliya on every release.
- Edge changes are validated before activation; reload failure restores the previous local dedicated file and fails the deployment.

## Telegram Bot API mode 04.10
- Cloud.ru production default is webhook, not long polling, because outbound Telegram API routing is not sufficiently reliable.
- Keep long polling as an explicit fallback mode only for hosts with verified outbound Telegram API connectivity.
- Never disable Telegram TLS verification. Webhook authenticity is independently protected by TG_WEBHOOK_SECRET.


## 2026-10-05: продолжение Sol6.1 remediation

- Основа origin/main edb1b9a (Telegram webhook), ветка fix/sol61-review-remediation-20261005. Восстановлены R01/R02 и незавершённый R03 из отдельного checkout без изменения исходного каталога.
- R01 wall clock Daily; R02 резерв verified capacity; R03 ID-aware ordinary outbox; R04 reload отложен до завершения Game (internal game reference, production без QA hook).
- R05 outbound defaultoff + explicit Compose env; R06 webhook-compatible SHA floor в workflow/select/rollback и direct deploy; R07 shared polling/webhook direct-link payload и group-safe кнопки.
- R08 onboarding completion callback; R09 analytics actor60/min; R10 credentials scrub+7dayTTL обоих outboxes.
- Независимое GPT-6.1 Sol ревью дополнительно выявило Daily409 blocking, смену uid внутри одной платформы и ack-before-durable. Исправлены terminal Daily409, exact-ID Daily settlement, local ownerId replay guard, fresh-user Daily slot supersession и synchronous atomic flush score/run/start/daily/run до non5xx ответа. Unknown legacy ordinary entries не replay: истекают поTTL, предотвращая присвоение чужому пользователю.
- Проверки: server75, outbox24, новые release4/onboarding/rollback/server-policy/renderedCompose; браузер score/comprehension6viewport. Полный локальный набор43гейта: первый startup5.124s при параллельной браузерной нагрузке и Caddy sh ENOENT; serial startup и Caddy с GitBash PATH прошли. Исходные failures сохранены в evidence.
- Cloud creation недоступен аккаунту; пользователь разрешил local. Deploy/merge не выполнены. Публичный release.json недоступен; текущая productionSHA НЕ подтверждена. Real-device MAX Android/iOS16/16 остаётся открытым.
- Анализ второго вложения: WOFF2 валиден, кириллица отсутствует. Не считать разрешённые словарём ФОРМА МУТАЦИИ/MAX ИЛИ TG/СТАНДАРТ ошибками; предложить небольшой кириллический typography trial, затем RU catalog; fullEN i18n после продуктового решения.


## 2026-10-05: делегированные UI follow-up

Ветка refactor/ui-copy-layout-followup-20261005 собрана поверх PR168 HEAD4f65c4f. PR168 остаётся отдельным remediation пакетом, его CI прошёл; merge/deploy не выполнены.

Space Bunny через OpenCode (opencode/space-bunny-free) создал типизированные варианты control labels и каталог rarity/build-summary: исходный code7a7d08e, здесь cherry-pickd63b80c. Существующие RU strings и поведение сохранены; full/compact/tiny намеренно различаются. Upgrade-id completeness контролируется runtime контрактом, не исчерпывающим TS union.

GPT-6 Sol создал рекурсивный диагностический collector для видимого текста в Container и18Legendary regression cases: исходныйcodeea086d1, здесь4f5cbfc. Production UI/Legendary layout не переделывался: actualPhaser18cases без overflow, max2lines. Matrix fixture теперь учитывает автоматический startuplevel-up pause и проверяет checkpointsave явно.

GPT-6 Luna независимо проверил обе задачи; no functional findings. Coordinator подключил новые Node/browser gates кCI и закрепил равные stackcounts в golden test. Browser suite budget15мин вместо10 из-за дополнительной18-case проверки, пороги assertions не увеличены.

Локальная отдельная приёмка: catalog/language/tsc; layout diagnostics; Legendary18/18; mobile matrix320x568,360x640,360x760,390x844,412x915 + restart-safe resume/result resize. Итоговый CI этой ветки нужно смотреть по headSHA draftPR, не переносить результат PR168.

Шрифтовой prototype находится отдельно в PR169: opt-inPlay400/700, no productiondefaultflip. CI обнаружил import.meta/CommonJS regression и отсутствие releaseSHA в visualworkflow; автор исправляет отдельно. Не считать старый Play CI зелёным.

Текущее второе мнение: MAX ИЛИ TG прямо разрешён languageBible100; PR168 меняетUIScene;452/419 без методики не новый замер; T-КИЛЛЕР/T-КЛЕТКИ действительно расходятся вproductBible. Имена/редкости/юридические тексты/fulli18n не изменять без продуктового решения.

Внешние релиз-гейты: реальные MAX Android/iOS16/16, TG launch/referral/Daily и publicrelease.json exactSHA остаются неподтверждёнными. Не выполнять merge/deploy автоматически.

## Legendary card wrapping at 320px (05.10)
- Allocate room by measured copy wrapping at the actual card width: allow 3 lines and a bounded taller panel only for compact Legendary effects that need line 3. Keep fixed card height, preserve the copy, and leave other cards at existing 2-line limits. Do not globally shrink UI typography to solve this edge case.

- Three-line panel uses center-y=21 to clear the Legendary footer at y=43; center-y=31 was rejected after review showed overlap. Focused probe fails on missing description/footer or any intersection.

## Compact Legendary card vertical budget (05.10)
- If compact Legendary effect text needs 3 lines, allocate space in the reward modal's card height (136px vs ordinary compact 124px) so the longer effect plate clears both description and footer. Keep the badge at y=6..48 relative to card, footer beginning at y=49; do not reduce type size or edit copy.
- Keep the Linux visual gate early in CI and emit measured effect/description/footer rectangles so remaining intersections are diagnosable.

## Viewport gate for compact Legendary expansion
- Increase compact Legendary card height only when the proposed entire stack clears the actual subtitle bounds plus the card gap and stays above the viewport bottom margin. This preserves the portrait 320x568 fix while denying expansion when the group cannot fit, including short landscape.

## Release workflow stamp guard (05.10)
- Every workflow that runs `npm run build` must pass an explicit 40-character `VITE_RELEASE_SHA`. `scripts/stamp-release.mjs` deliberately throws rather than stamping an ambiguous dev build, so a missing env is a build failure, not a silent fallback. The Release Visual Matrix workflow was the one remaining build step without it; it now uses `${{ github.sha }}`, matching the `ci.yml` build gate. Do not relax the stamp guard to make a workflow pass.

## Release documentation honesty (05.10)
- The documented `npm run` lists in `README.md` and `RELEASE_VALIDATION.md` are an explicitly labelled quick check subset, not the release gate. `.github/workflows/ci.yml` is the authoritative complete gate; on divergence `ci.yml` wins. Do not present a local short-list run as release validation.
- State plainly in the release docs that passing CI does not imply real MAX Android/iOS or Telegram acceptance: automated gates run against a mocked MAX bridge in a desktop browser and cannot produce native client behavior, real signed `initData`, real haptics/audio unlock, real restart lifecycles, real deployment values, or real network/thermal conditions.
- Document `npm run test:mobile-evidence -- PATH` with its 16 required check ids and the five required per-check fields, and separately list the manual requirements it does not cover. Keep the existing 16-point manual matrix unchanged and complete.
- Describe the validator by what it enforces, not by a total row count. It iterates only its own `required` array, so 16 is the mandatory minimum; extra `checks[]` rows are permitted and uninspected, and a `pass` does not certify them. `testedAt` is validated with `Date.parse`, so ISO 8601 is a readability recommendation rather than an enforced format. Never write "exactly 16" or "checks only these" for a validator with that shape.
- Real-device acceptance evidence lives outside the repository in external release-evidence storage; the repo records only the path or URL. Gitignore the single local convenience file `artifacts/mobile-acceptance.json` rather than the whole `artifacts/` directory, so no unrelated artifact is silently hidden or removed.

## Probe coverage contract: multi-card Legendary
- Keep actual trophy coverage tied to the production contract of two guaranteed Legendary choices. A three-Legendary fixture is explicitly synthetic stress coverage and must not be described as a reachable trophy offer.
- For every card, find its own effect, plate, description, and footer under that card's container. Do not reuse global text matches across cards; this can make duplicate footer labels hide per-card defects.
- The expanded-height assertion must follow the same geometry as production: proposed stack top below measured subtitle bottom plus gap, and stack bottom above viewport bottom margin. Also assert card-to-card separation and visible-text viewport bounds.
- Keep failures visible. Syntax/static checks do not establish browser layout correctness; root browser run and independent review remain required.

- First browser run for the expanded probe passed 87/88: all single and two-choice pair scenarios passed; only the synthetic three-card fixture at 320x480 overlapped the subtitle. Move that fixture to 320x520 so the compact stack can fit while the expanded proposal fails the lower viewport guard; rerun passed 88/88: 24 singles, 60 pairs, 3 synthetic-three scenarios, and 1 short-portrait guard. At 320x520 the guard retained 124px cards with a 9px subtitle gap and no overflow. Independent review and Linux CI are still pending. This was a fixture-boundary correction, not a production layout change or weakened assertion.

- The first Linux CI attempt failed before the probe ran: its fallback URL pointed to 127.0.0.1:5197 while CI serves Vite on 5173 (connection refused at work/multicard-linux-plain.log:190). Restore 5173 as the default and preserve OFELIYA_URL for local overrides. Classify this as probe/CI URL wiring, not a layout assertion failure; rerun Linux CI before claiming it passes.

- Linux run of the expanded browser probe passed 87/88 after fixing the fallback port. All 15 real definition pairs across every tested viewport, including 320x520, passed. The only failure was the synthetic three-choice short-height fixture: one 3-line effect met the intended 2-line cap on 124px compact cards. This is an unreachable synthetic content/layout combination (trophy contract is two choices), while the longer 3-card stress case remains at taller heights. Use only 2-line effects in the 320x520 guard to isolate height-fit logic; keep all 15 actual pairs there. No production UI change and no relaxed assertion. Rerun pending.

- Linux wrap measurements showed the previous 320x520 short guard still included a 3-line effect: definition index 3. The six measured counts are `[2,3,2,3,3,2]`. Use indices 0, 2, and 5 for this guard; index 5 is the last-life-saving Legendary. Base the selection on measured wrapping, not inferred string length. Keep all other scenarios/assertions unchanged; latest Linux status is 87/88 and rerun is pending.

## VO-01 decisions — 07.10.2026
- Diagnostics only, no overall DPR/framebuffer multiplier. Use existing DEV/release-matrix-QA gate and detached on-demand readback, never timers or history.
- Snapshot fixed Menu/Game/UI scope, bounded recursive visible Text sampling, numeric geometry/resolution only; no content/identity/user fields.
- Phaser Text style.resolution and TextureSource.resolution are independent observed facts. Production renderer tests use numeric renderer.type because constructor names are minified.
- Browser fixture freezes Game.update before start and pauses physics after ready to isolate logical camera mapping from collision shake. Production controls/gameplay stay untouched; existing multitouch suite is separate evidence.
- Kimi failed invocation is not a review. Coordinator owns frozen candidate review; no other workers, push, merge or deploy.

## VO01 fix1 decisions — 07.10.2026
- Diagnostic snapshot returns a stable empty scene record when a canonical key is missing. Focused test removes actual Phaser scenes, avoiding mocks.
- Ordinary production means PROD without VITE_RELEASE_MATRIX_QA=1; both literal hook string absence across JS chunks and behavioral opacity required. Existing build-time gate remains unchanged.
- Preserve pre-start update freeze based on validated control-smoke lifecycle; narrow dimensions/input evidence, no progression/performance claim. Destroy nested Text/container before later samples.
- Scene pause/resume plus already-visible handler dispatch only; no actual hidden transition acceptance. Intrinsic size expectations explicitly baseline-specific.
- Successful Kimi text-only review supersedes failed invocation artifact; coordinator owns final acceptance.


## VO02 combat decisions — 07.10.2026
- Use baked palette atlas frames instead of tint or TextureSource.resolution compensation: Phaser3.90 Canvas particles ignore tint/resolution. Preserve all gameplay art/source dimensions for Task5.
- Retain exactly four emitters; two death silhouettes split one existing VfxBudget grant rather than taking independent full requests. Nearest RGB palette preserves unlisted event colors approximately; known colors map exactly. Particle RNG remains Phaser cosmetic RNG, no gameplay RNG use.
- Retain a lazy circle pool full12/reduced6, reserves3/2 for important feedback. Preemption cancels prior tweens, resets circle geometry/style/transforms and guards late completion by generation. If all slots are important, newest important feedback replaces oldest. Gameplay warning geometry lives outside VfxSystem and is unaffected.
- Keep ordinary hit feedback local and globally throttled; surface spray and short contact ring improve legibility without camera shake. Do not alter hitStop/ImpactDirector policy.
- Focused tests execute production TS modules with rendering-boundary adapters and real EventEmitter3; they establish calls/policy/recipes, not pixel parity or real-phone performance. Root-owned browser and Kimi review are still required.


## VO02 Kimi fix1 coverage decisions — 07.10.2026
- Resolve reviewer test gaps with boundary tests, no speculative production rewrite. Existing sort `Number(false)-Number(true)` correctly puts ordinary entries before important; Q2 interpretation does not warrant changing it.
- Exercise a stale callback despite cancellation, then permit new ordinary traffic to prove replacement remains active through public allocation behavior. Assert current completion releases visibility normally.
- Tie fixture is literal RGB(242,246,244): hand-checked squared distances 237 to white/immune, all other palette distances > 10,000. Expect white as first declaration-order tie winner, with both spark/chip frames; no duplicate nearest-color loop in tests.
- Mutation verification modifies production source strings only in the temporary loader memory, never tracked source: wrong shedding, absent serial guard, <= tie update and disabled ordinary cap each fail the corresponding new case. Regression additions passed existing code; do not describe their mutation RED as preimplementation feature RED.


## VO03 organ atmosphere decisions — 07.10.2026
- Keep logical background256px geometry and existing keys. Bake periodic sine flow and0.5-slope Heart fibres; broad warm detail stays below gameplay without postFX. Leave actor, host shadow and combat atlas dimensions/recipes to their existing owners.
- Allocate all three RBC bands at construction (full8/4/2, reduced4/3/1). Proportional visible budget preserves at least one per available band; Heart uses ceil(runtimeBudget/2), subject to the same three-band floor, preventing quality/stage switches from removing near depth.
- Retain one pulse Rectangle behind gameplay. Clamp composite alpha<=.075 and decay by actual elapsed milliseconds, separate from movement's50ms clamp. Split elapsed time at pending190ms second beat to preserve overlay decay with large frame intervals; store only latest pending numeric schedule and cancel on stage/reset/shutdown.
- Separate the cosmetic Heart envelope from authoritative heartbeat logic: first exp(-phase*14), second absent beforephase.22 then .52*exp(-(phase-.22)*18). Do not alter real heartbeat, director or AI timers.
- Focused test adapters record Phaser/Canvas calls while production logic and real EventEmitter3 execute. Four in-memory source mutations verify gate/decay/band/cancellation coverage. Root browser screenshots/independent review remain separate evidence.


## VO04 mix and lifecycle decisions — 07.10.2026
- Place per-bed loudness correction on a dedicated retained gain, separate from .65 music bus duck automation. Route all buses through .8master and one configured compressor. Keep existing procedural stinger/heartbeat filter and direct bio path.
- Cache decoded SFX normalization at successful load; role gain is its only event coefficient, replacing legacy manifest vol. Invalid/nonfinite samples or silent/empty data use trim1; bounded boost max12. Existing fallback oscillators and event throttles retain their values.
- Store desired deterministic bed independently from decoded fallback index. Diagnostics return frozen snapshots of actual node values and lifecycle booleans; decoded actual index is null before success/after stop. Emit bounded generic decode errors instead of arbitrary environment error messages.
- Visibility owns suspension even before AudioContext exists; also check document.hidden because director binds its listener after bedStart and teardown calls setSuspended(false). Never resume/spawn while hidden; cache legitimate hidden decode for visible restart. Recheck visibility after asynchronous resume to prevent pending resume overriding hide.
- Call ctx.resume() inside the gesture callback stack; deduplicate its pending promise and rearm one listener per event after failure. Keep manual pause from suspending shared UI audio. Stop outstanding adaptive layer tones on run teardown while leaving SFX transient cleanup on ended.
- Focused WebAudio adapter must distinguish scheduled oscillator stop from immediate teardown; otherwise live-node lifecycle assertions are vacuous. Restart tests assert bio plus four live layer oscillators before explicit cleanup. Browser/sample/device acceptance remains coordinator-owned.


## VO05 core art recovery decisions — 07.10.2026
- Resume saved `fdacc92` rather than repeat asset generation or replace stable implementation. Keep canonical logical metrics and bounded4x backing explicit; do not use TextureSource.resolution to compensate sprite/body geometry.
- Extend coverage at Boot loader/canonical-key and create-sequencing boundaries; validate generated asset byte hashes against recorded provenance. XHR completion and Phaser body rounding require separate actual browser acceptance.
- Retain intentional untracked `.vo05-mutant.mjs` unchanged; its finite-timeout failure is coverage evidence, not a tracked feature or failing production gate. Coverage additions were green on existing implementation; no claim of new feature RED.
- Keep recovered changes scoped to Task5 tests/memory; no unnecessary source rewrite, package/CI wiring, browser operation or deployment. Coordinator owns root integration/scoped review and actual Phaser checks.


## VO05 stalled-art follow-up — 07.10.2026
- Root actual-browser regression exposed >6000ms stalled startup. Phaser3.90 Loader defaults maxRetries2; File.onError reloads twice, creating3x1800ms windows. Desktop parallel32; Android parallel6 can additionally batch seven assets.
- `9dc9650` sets optional-art retries0 while queueing (restores prior value in finally for unrelated future files) and Boot concurrency max(existing,7). Per-file1800ms timeout unchanged. Core art contract now16/16 includes retry capture/restore and Android6/desktop32 batching policy.
- With root-authorized browser follow-up, actual Chromium Canvas startup available1335ms/missing1102ms/stalled2501ms/Android-UA stalled2673ms, all unchanged6000ms gate. Stalled modes each requested exactly7distinct assets, no retries; Android config default6 and Boot loader7 explicitly confirmed. Private extended copy of root startup test remains untracked for coordinator import.
- Elite fixture now compares actual halfWidth/halfHeight to floor(sourceWorldRadiusX/Y), matching Phaser Body.setCircle/updateBounds; logical tolerance1.01, markers/signatures/centers unchanged. Actual elite script passed against own Vite server with only URL substituted in temporary copy. No physics production changes.
- Typecheck, core16/16, nonbrowser startup-renderer, viewport/tokens/impact-budget and whitespace passed after fix. No push/merge/deploy. Root still owns full geometry/controls/matrix/scoped review and external device gates.

## VO06 restrained framing decisions — 07.10.2026
- Reuse existing BORDER/PANEL/ROLE tokens without modifying frozen recipes. Specimen radius=min(82,H*.105) keeps circular decoration below title/copy; low-alpha warm plate and pink halo are behind hero, with fixed geometry and alpha-only animation.
- Add panel illumination as static noninteractive hairlines inside existing selector bounds; preserve every text/touch callback and launch-once guard.
- Draw highlights inside the retained XP/HP/boss Graphics (3px side inset,2px top inset,2px height), so existing hide/pulse/cinematic handling applies automatically. Leave fill/text updates immediate and geometry unchanged.
- No new implementation-mirroring test for cosmetic decoration. Existing non-browser contracts establish unrelated token/copy/math stability; root actual Phaser acceptance must assess visible layout, teardown and pixel quality.

## 2026-10-07: Recovery and acceptance decisions

Preserve saved implementations rather than restart. Disable optional-art retries only while queueing and restore prior policy. Freeze live progression in density-capture fixture, preserving Sprite.preUpdate/rendering and all assertions. Isolate font900ms gate from optional art; separate real artstartup6sec evidence. Keep general1xcanvas and compensated4xart; a fullHiDPI renderer is outside this contained presentation change.

## Hosted CI determinism decisions

Use real production tier override before test modules load, restoring global storage descriptor. Sample real production animation at shared1000ms, seed only creation cosmetics and restore Math.random. Prepare lazy group sprites idempotently; explicitly apply existing depthSort before exact ordered input snapshots. Require finite poses, retained windup telegraphs, before/after stability and same-tier renderer input equality; preserve raster thresholds. Scope lysis-radius spy to actual lysis rather than unrelated hit rings; assert complete108/150 array and original damage bounds. These are fixture corrections, not gameplay/rendering changes.

## 2026-10-08 presentation continuation rulings
Ruling: keep canonical art and bake only two6frame atlases at boot; equal source frame size/factor4 preserves physics. No gameplayRNG or new per-frame objects. Ruling: cap combo pulse by availableHPgutter and compact numbers; separate boss title/bar within unchangedplate and preserve input targets. Ruling: portable filesystem paths in testsource loaders, assertions unchanged. Ruling: HiDPI production default stays1x; followup QA-only proof until device/performance/context/offscreen evidence. Kimi route connectivity is separate from a successful review: use available authenticated direct fallback when OmniRoute timeout/empty response prevents review.

- [2026-10-08] Keep density2 explicit DEV/release-matrix-only, maximum2x/4Mpx and static/runtime1x fallback, pinned Phaser3.90 internals. Quadrupled framebuffer area requires device evidence before rollout; preserve logical input/camera/body geometry. No automatic production activation.

- [2026-10-08] Isolate Legendary ceremony from autonomous progression by freezing fixture Game.update, while preserving real UI/choice/Scene lifecycle. Keep Cardiac real updater and explicitly clear initial progression/UI. Do not claim the isolated ceremony tests resumed gameplay simulation; other gameplay contracts cover it.

## Cardiac clock isolation follow-up
PR182 initial head e1c058e CI37768249337 passed ceremony but failed Cardiac8s. Diagnostic-only14b6d3c CI37769887253 remains running. A local synthetic sparse RAF35ms plus explicit cooldown240 reproduced the timeout: Game active/notpaused/UI clear, boss phase2, stage2649 versus scene16936, nextTelegraph13575 already due, heartbeat3216 safeIndicator true; zero page errors. This demonstrates the mixed-clock scheduling mechanism, not the exact hosted runner conditions (default cooldown120).

Fixture now uses the real heartbeat.restore with nextImpact=stageTime+60000 and bossWasActive=true, with exact60000 setup assertion. Game.update, real Cardiac scheduler and canSchedule, original4700/850/280 source timing,8s/2s/1.5s browser deadlines, exact14damage and heartbeatClear remain. It intentionally does not validate live heartbeat concurrency; unchanged test:pacing separately tests1980/1981 boundary and exclusion. Native exactscript plus paired synthetic stressed fixture PASS; pacing PASS. Independent Codex source review PASS. Additional Kimi OmniRoute review returned empty content and is NOT approval. Await fresh PR/main CI before deploy.

## Hosted progression cause captured and pool reset
Diagnostic-only14b6d3c CI37769887253 failed with Game inactive/paused, UI modalOpen/uiBlocked, awaitingChoice true, stage149ms, bossactivephase2, hazard disabled/serial0 and no errors. This directly proves a new progression choice paused the updater; it does not identify the individual RNA drop. The only ordinary queued-level source is onGemCollected; stage transition was not occurring.

The fixture now uses production-standard deactivateForStageReset for existing bullets/RNA gems, resets host cells and excludes their update/rewards from this beam contract. It asserts zero active bullets/gems. Paired local inherited-RNA100 fixture: baselinef292dc7 paused atstage33ms/queued3/awaitingChoice and failed8s; corrected fixture PASS. Exact corrected script alsoPASS. Thus no onGemCollected/Game.update/hazard method is stubbed, no assertion or timeout is loosened. Host-cell/RNA integration is outside this scoped beam test; other unchanged gameplay/browser suites cover it. Mixed-clock synthetic finding remains separately documented and was not the captured hosted cause.

## Dense readability fixture lifecycle recovery
Final6c84b89 CI37771605821 passed Legendary, Cardiac and controls, then dense-readability failed target150/cache150 with allalpha1. Enemy preUpdate reads prior density; Game.update refreshes cache afterward. Original fixed150ms sleep need not contain both real frames.

Density fixture now waits two actual Scene POST_UPDATE frames with cache>=target, bounded1500ms, before unchanged150/200targets/alpha assertions. This replaces a synchronization assumption, NOT an unchanged performance/timing gate. No manual Game/Enemy update or cache writes. Startup accepts an already-paused real Game, resumes then clears progression/UI; new unblocked assertion added. Exact native finalscript PASS; original native Game.active-only wait had stopped at startup30s. Paired sparseRAF240ms with shared corrected startup: old150ms sleep failed cache100/target150/allalpha1; completed-frame wait PASS. This demonstrates synchronization sensitivity, not the exact hosted scheduling. Independent Codex source review PASS. Additional Kimi nonstream diagnostic HTTP504; no routed approval.
