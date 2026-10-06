## Comprehension evidence phase (06.10.2026)

- [x] Implement run context, retry metadata and comprehension report on local feature branch.
- [x] Add real signed delivery/persisted-store/CLI fixtures and npm/CI integration.
- [x] Prepare 5–8 newcomer protocol, blank session table and pinned donor audit.
- [ ] Review/publish feature branch and run canonical full CI before release; no publication in this task.
- [ ] Conduct 5–8 real newcomer MAX phone sessions on an exact build SHA; record observed actions/explanations/help separately.
- [ ] Select three gameplay/UI changes from observed evidence; reroll/new enemies/chat ranking remain candidates.
- [ ] Verify actual production release marker and MAX Android/iOS acceptance independently of local tests.

# BACKLOG — OFELIYA: STRAIN ZERO

Обновлено: 2026-10-05. Отмечайте сделанное галочкой; новые пункты добавляйте сюда, а не в чат.

## Control-mode browser smoke (06.10)
- [ ] Root review/publish `fix/control-smoke-preconditions-20261006` and rerun full main CI; focused browser smoke passed locally.

## Deploy CI payload fix (05.10)
- [x] PR #173 merged the file-backed deploy CI payload fix; target branch inherits it from main `b174b40`.
- [x] PR #174 merged targeted CI lookup and Ubuntu 22.04 pin; target branch inherits it from main `18e6f05`.
- [ ] Root review/PR for `fix/deploy-standalone-policy-20261005`, then wait for full main CI at the new SHA before deployment retry. No deploy performed by this task.

## Сейчас (P0)

- [x] Синхронизировать worktree с origin/main — выполнено 28.09 (main @ 480c67b).
- [x] Подтянуть origin/main в `feat/donor-quick-wins` — merge `45712e9` (без конфликтов, запушено).
- [x] Канонический гейт на синхронизированной ветке — пройден 28.09 (9 тестов + release:check + build).
- [x] Тест-цикл B в OpenCode (два прохода, смена модели) — пройден 29.09.
- [x] Внешнее ревью (внешняя модель — `memory/06_REVIEW.md`) + merge PR #151 — выполнено 29.09 (+2-е мнение `space-bunny-free`; пост-ревью правки PR #154). [ ] ChatGPT-вариант ревью — опционально, позже.
- [ ] Внешний релиз-гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). Evidence validator реализован 02.10; реальные 16/16 ещё не сняты.
- [x] Merge PR #151: система памяти (квик-вины уже в main через #137) — выполнен 29.09 после внешнего ревью.
- [x] `.gitignore` для служебных каталогов — добавлено 29.09 (13 записей: 9 каталогов + 4 `*.capability.json`).
- [x] Проверить служебные untracked-каталоги (скан 29.09: 13 записей, ~55 файлов — совпадений 0). Исходная запись: - [ ] Проверить служебные untracked-каталоги (`config/`, `skills/`, `.cluster/`, `handoff-system/`, `ofelia-pilot/`, `*.capability.json`) на ключи/секреты перед этапом 3 (правило AGENTS.md — пока только на дисциплине).
- [ ] Балансировка по полным реальным прогонам (9+ минут).

## Далее (P1)

- [x] Реализовать продуктовую funnel-инструментацию и CLI-отчёт (02.10): app_open → run_start → run_60s → boss1 → heart → replay, onboarding timing/exits, D1, referral open → run_start.
- [x] Перестроить first-run tutorial вокруг RNA/мутации/заражения клетки-хозяина; удалить pause как обязательный шаг (02.10).
- [ ] Провести наблюдаемый плейтест новых первых 60 секунд на людях; собрать completion/time/exit reasons, не подменять smoke-тестом.
- [ ] Пройти реальный MAX Daily invite path на двух устройствах: send → open → run_start → result; сохранить evidence.

- [ ] Heart safe-pocket timing — плейтест читаемости; оба боя боссов — по ощущениям, не только технически.
- [ ] Twin-stick эргономика на реальных устройствах.
- [ ] Dense readability 100/150/200 — держать при любых визуальных изменениях.
- [x] Пилот памяти, Honor: тест-цикл B пройден 29.09; [ ] HP — блок A чек-листа (этап 3).
- [ ] Синхронизация двух ноутов: протокол pull/push в ежедневной работе.
- [ ] Правило: числа и ссылки в файлах памяти — только из git-вывода (по итогам 2-го внешнего ревью, 29.09).

## Отложено (не трогать без отдельной миграции)

- Третий орган / дополнительный акт кампании; сложность выше Strained; крупная экспансия Legendary;
  постоянная stat-прокачка; широкая внешняя арт/аудио-пайплайн; крупный рефакторинг или смена рендера.

## Audit follow-up 03.10
- [x] Revalidate D1 elite hitbox: false positive; Phaser scales the Arcade circle from source pixels. Added runtime regression assertion.
- [x] Fix D2 resize with blocking UI: level-up/result overlays now fit the new viewport and scrims remain full-screen; level-up runtime smoke passed.
- [ ] Keep D3 suspended-audio burst as a real-device acceptance check; do not refactor audio without reproduction.
- [ ] Complete real MAX Android/iOS 16/16 evidence gate; browser smoke does not close P0.

## Telegram release
- [x] Add Telegram WebApp SDK/Web origins to production CSP.
- [x] Add dedicated optional Telegram bot service and fail-closed deploy wiring.
- [x] Fix `/start <payload>` dispatch and add regression contract.
- [x] Dedicated Telegram bot identity supplied (`ofeliya_game_bot`); production secret staging pending final deploy gate.
- [ ] Configure BotFather Main Mini App URL to `https://ofeliya.freeveol.dpdns.org/ofeliya/`.
- [ ] Deploy Telegram-enabled main SHA and run real Telegram Android/iOS/Web acceptance.

## Telegram edge rollout
- [x] Diagnose #158 parity rollback: stale host-local Caddyfile.dedicated.
- [x] Add deterministic dedicated-Caddy renderer and CI contract.
- [x] Add validate/reload/restore edge synchronization to deployment.
- [x] Merge hotfix #159 and restore versioned Caddy rollout.\n- [x] Diagnose Cloud.ru Telegram API egress; add explicit reachable endpoint fallback.\n- [ ] Stage production Telegram secret/config after egress PR is green, then deploy and run real Telegram acceptance.

## Telegram webhook release
- [x] Add authenticated /api/telegram/webhook route and inline Bot API response.
- [x] Add webhook/polling deploy mode and fail-closed webhook secret validation.
- [x] Add fast client-side t.me/share/url fallback when outbound prepared-share is disabled.
- [ ] Merge/deploy webhook branch.
- [ ] Register webhook/menu button/commands through a network path that can reach Telegram Bot API.
- [ ] Verify real Telegram /start -> Web App -> initData -> run -> score and challenge share.


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

## Compact Legendary card clipping
- [x] Fix the three Legendary effect panels proven clipped at 320x568 with a bounded conditional third line.
- [x] Update the focused layout probe to identify the expanded panel and keep its text-containment assertion.
- [ ] Root rerun full branch CI/browser review from commit `997b6eee2403505e1a416fd5d2755496c30728e`; no release action is included.


- [ ] Root rerun final focused Legendary probe with mandatory desc/footer fixture checks on `997b6eee2403505e1a416fd5d2755496c30728e` before push.

## Compact Legendary spacing CI
- [x] Add 12px to compact Legendary reward card height only; keep three-card 320x568 stack within y=122..548.
- [x] Include effect/description/footer bounds in focused probe JSON and fail on missing fixtures/intersections.
- [ ] Linux focused regression after run37293956036 reported effect/description overlap; verify the 136px card correction on final candidate `29457d658e309ee87fadffd30c565528a11d6405`.

- [ ] Re-run focused Linux Legendary CI after commit `c01019f0708d9740cfc7a3f84da29bba149eed55`; latest Linux pass predates its viewport-fit guard.
- [ ] Track compact landscape Legendary panel density/layout separately; viewport-fit guard preserves the original 124px card treatment when expansion cannot fit and does not claim a full landscape redesign.

## Release closure (05.10)
- [x] Add `VITE_RELEASE_SHA: ${{ github.sha }}` to the Release Visual Matrix build step (`a32b3f2`) so `stamp-release.mjs` stops aborting that workflow.
- [x] Label the documented `npm run` lists as a quick check subset and name `.github/workflows/ci.yml` as the authoritative gate in `README.md` and `RELEASE_VALIDATION.md`.
- [x] Document `npm run test:mobile-evidence -- PATH`, its 16 required check ids, required fields, the manual requirements it does not cover, and external evidence storage.
- [x] Gitignore only `artifacts/mobile-acceptance.json`.
- [x] Correct the two inaccurate validator claims in README/RELEASE_VALIDATION: 16 is the mandatory minimum, extra `checks[]` rows are permitted and uninspected, and `testedAt` is validated by `Date.parse` rather than strict ISO (`d976778`). Documentation only; validator semantics unchanged.
- [ ] Coordinator/Cline/Hoplite independent review of `a32b3f2`; at most two fix iterations. No Codex reviewer.
- [ ] Verify the Release Visual Matrix workflow actually goes green on GitHub after the env fix — it was never confirmed green locally, since that job needs Ubuntu + Playwright.
- [ ] Remaining report findings stay backlog, out of this bounded scope: no redesign of docs structure, no validator semantics change, no fabricated evidence.
- [ ] Unchanged external gates: real MAX Android/iOS 16/16, Telegram launch/referral/Daily, public `release.json` exact SHA.

## Multi-card Legendary layout regression coverage (05.10)
- [x] Preserve existing single-card Legendary cases and add all distinct two-definition pairs across the three existing viewports.
- [x] Add a clearly labelled synthetic three-Legendary stress case and a 320x520 short-portrait non-expansion guard.
- [x] Assert per-card fixtures and bounds, card separation, measured subtitle gap, fit-guard decision, and visible-text viewport containment.
- [x] Initial root browser run: 87/88 passed; singles and all two-card pairs passed. One synthetic-three 320x480 failure was caused by subtitle overlap in the stress fixture.
- [x] Root rerun with guard fixture at 320x520: 88/88 passed (24 singles, 60 pairs, 3 synthetic-three, 1 guard); short guard stayed at 124px with 9px subtitle gap and no overflow.
- Linux rerun after URL correction: 87/88; the first revised short guard still failed because definition index 3 wraps to three lines. Linux measured all six as `[2,3,2,3,3,2]`; latest fixture correction uses indices 0, 2, and 5. See `work/multicard-linux-plain2.log`; rerun pending.
- [x] Linux probe ran after URL correction: 87/88; all 15 real Legendary pairs across all viewports passed. The only failure was the short synthetic-three guard selecting a 3-line effect against the intended 2-line compact cap on 124px cards (`work/multicard-linux-plain2.log`). This is an unreachable stress content limit, not a trophy defect (trophy offers two). Long-content three-card stress stays on taller heights.
- [ ] Rerun with the short guard using three two-line effects (definitions 0, 2, 5); keep all 15 actual pairs at 320x520 and leave assertions/production UI unchanged. Independent review approved this bounded fixture adjustment. No real-device acceptance claim.
- [x] Linux measurement found short-guard definition index 3 also wraps to 3 lines; measured six single wrap counts are `[2,3,2,3,3,2]` (`work/multicard-linux-plain2.log`).
- [ ] Rerun short guard with measured two-line definitions 0, 2, and 5 (index 5 is last-life-saving Legendary); all other cases remain unchanged. Latest Linux is 87/88; do not claim pass until rerun.
