# HANDOFF — deploy CI payload fix, 05.10.2026

Branch `fix/deploy-ci-payload-20261005` starts from main `42b9f30a3feb8f219faf41014f0bfdd6bf27b5dd`. The deploy run `37362076056` failed before bastion access: exporting the GitHub Actions runs response as `RUNS_JSON` exceeded Linux `MAX_ARG_STRLEN`, causing Node spawn exit 126 (`Argument list too long`).

Changed only `.github/workflows/deploy-cloudru.yml` successful-main-CI validation: save `gh api` response to a `mktemp` file, register EXIT cleanup, and have the existing inline Node validator read it through `fs.readFileSync`. Preserve all five checks (`name=CI`, exact `head_sha`, `head_branch=main`, `event=push`, `conclusion=success`) and fail closed for malformed JSON/no match. Local regression proof executes the actual inline Node body with a >128 KiB fixture and confirms wrong name/SHA/branch/event/conclusion all reject.

No deploy, browser, push, merge, or gate bypass. Review and publish remain with root. This task requires only the deploy workflow file plus the four memory files; keep commits separate for code and memory.

## Verification

- `node work/deploy-ci-payload-regression.cjs` — exit 0; executes the extracted inline Node body from the workflow against a 407,765-byte valid fixture (accept), wrong workflow name/SHA/branch/event/conclusion (reject), and malformed JSON (reject).
- `git diff --check` — exit 0.
- The regression harness was temporary and removed after execution; no test framework or workflow gate was added.
- Code commit: `75dc7d4b78c6368556905805116f7951806b539e`; memory is committed separately afterward. No deploy, push, or merge.

---

# HANDOFF — release closure, 05.10.2026

Ограниченный release closure выполнен в отдельном checkout поверх `1d6bb37`. Кодовые коммиты:
`a32b3f2` и `d976778`.

## Что сделано

Коммиты: `a32b3f2` (код+документация), `d976778` (уточнение формулировок валидатора), плюс отдельный
коммит памяти. Всё в этом checkout, без push.

`.github/workflows/release-visual-matrix.yml`: build step имел только `VITE_RELEASE_MATRIX_QA=1`, и
`scripts/stamp-release.mjs` падал с `VITE_RELEASE_SHA must be an explicit 40-character git SHA`.
Добавлена одна строка `VITE_RELEASE_SHA: ${{ github.sha }}` — тот же источник, что уже использует
`ci.yml`. Минимальный фикс, тот же дефект, что PR169 чинит в шрифтовой ветке.

`RELEASE_VALIDATION.md` и `README.md`: документированный список `npm run` теперь явно назван quick
check subset, авторитетный полный гейт — `.github/workflows/ci.yml` (плюс visual matrix workflow).
Зафиксировано, что зелёный CI не означает приёмку на реальных MAX/iOS/Telegram клиентах.
Задокументирован `npm run test:mobile-evidence -- PATH`: 16 обязательных id, пять обязательных полей
на запись, и отдельно — требования, которые валидатор не проверяет и которые остаются ручными
(BackButton, haptics, audio unlock, restart-циклы, boss pacing, Heart timing, twin-stick ergonomics,
реальные legal values, trusted score с подписанным `initData`). Прежняя ручная матрица §8 не тронута.

Коммит `d976778` исправил две неточности в этом описании, не меняя валидатор: 16 id — обязательный
минимум, а не точное число (дополнительные строки `checks[]` разрешены и не инспектируются), и
`testedAt` проверяется через `Date.parse`, поэтому ISO 8601 рекомендуется, но не требуется.

`.gitignore`: ровно одно правило `artifacts/mobile-acceptance.json`. Проверено, что
`artifacts/other.json` остаётся видимым; tracked assets не удалялись.

## Проверки (локально, фактические exit statuses)

- `npm ci` — 0
- `git diff --check` — 0 (до и после `d976778`)
- `npm run test:tokens` — 0 (`ui tokens contract: ok`)
- `npm run build` при `VITE_RELEASE_MATRIX_QA=1` и `VITE_RELEASE_SHA=$(git rev-parse HEAD)` — 0,
  `Stamped OFELIYA release 1d6bb3789326fe6ffe937c14ae9facb6a7062225`
- Поведение валидатора проверено на синтетических fixture во временном каталоге вне репозитория:
  16 обязательных id → 0; 16 плюс две лишние строки → 0; `testedAt: "October 5, 2026"` → 0;
  15 обязательных id (даже с лишней строкой) → 1; `testedAt: "not-a-date"` → 1.

`test:mobile-evidence` против реального device evidence не запускался: таких данных нет, и
подделывать их нельзя.

## Что дальше

Coordinator/Cline/Hoplite — независимое ревью `a32b3f2` и `d976778` (не Codex reviewer), максимум две
итерации правок. Push/merge/deploy не выполнялись.

Остаётся непроверенным: сам Release Visual Matrix workflow на GitHub (нужны Ubuntu + Playwright),
реальные MAX Android/iOS 16/16, Telegram launch/referral/Daily, public `release.json` exact SHA.

---

# HANDOFF — делегированные UI-доработки, 05.10.2026

Ветка refactor/ui-copy-layout-followup-20261005 собрана поверх PR168 HEAD4f65c4f. PR168 остаётся отдельным remediation пакетом, его CI прошёл; merge/deploy не выполнены.

Space Bunny через OpenCode (opencode/space-bunny-free) создал типизированные варианты control labels и каталог rarity/build-summary: исходный code7a7d08e, здесь cherry-pickd63b80c. Существующие RU strings и поведение сохранены; full/compact/tiny намеренно различаются. Upgrade-id completeness контролируется runtime контрактом, не исчерпывающим TS union.

GPT-6 Sol создал рекурсивный диагностический collector для видимого текста в Container и18Legendary regression cases: исходныйcodeea086d1, здесь4f5cbfc. Production UI/Legendary layout не переделывался: actualPhaser18cases без overflow, max2lines. Matrix fixture теперь учитывает автоматический startuplevel-up pause и проверяет checkpointsave явно.

GPT-6 Luna независимо проверил обе задачи; no functional findings. Coordinator подключил новые Node/browser gates кCI и закрепил равные stackcounts в golden test. Browser suite budget15мин вместо10 из-за дополнительной18-case проверки, пороги assertions не увеличены.

Локальная отдельная приёмка: catalog/language/tsc; layout diagnostics; Legendary18/18; mobile matrix320x568,360x640,360x760,390x844,412x915 + restart-safe resume/result resize. Итоговый CI этой ветки нужно смотреть по headSHA draftPR, не переносить результат PR168.

Шрифтовой prototype находится отдельно в PR169: opt-inPlay400/700, no productiondefaultflip. CI обнаружил import.meta/CommonJS regression и отсутствие releaseSHA в visualworkflow; автор исправляет отдельно. Не считать старый Play CI зелёным.

Текущее второе мнение: MAX ИЛИ TG прямо разрешён languageBible100; PR168 меняетUIScene;452/419 без методики не новый замер; T-КИЛЛЕР/T-КЛЕТКИ действительно расходятся вproductBible. Имена/редкости/юридические тексты/fulli18n не изменять без продуктового решения.

Внешние релиз-гейты: реальные MAX Android/iOS16/16, TG launch/referral/Daily и publicrelease.json exactSHA остаются неподтверждёнными. Не выполнять merge/deploy автоматически.

## Handoff: compact Legendary effect panel
- Branch `refactor/ui-copy-layout-followup-20261005`, base `f71d2bb`. Fix commits: `340f38b7f8f2be2fc9be49c6b06cf49d45151d2e`, corrected geometry/probe `997b6eee2403505e1a416fd5d2755496c30728e6`.
- For actual compact Legendary text wrapping beyond 2 lines, card effect text is allowed 3 lines and its badge grows from 30 to 42px and shifts upward to center y=21, ending at y=42 before the footer at y=43. All other effects retain the two-line/30px compact treatment. No copy, gameplay behavior, or UiCopy integration changed.
- Root reports its 18-case Windows browser probe and description/footer intersection checks passed on the corrected geometry; the final probe also fails if either text fixture is absent. Local `npx tsc --noEmit`, `npm run test:legendary`, `npm run test:mutation-copy`, and `npm run test:tokens` passed.
- Next: root runs any required CI/final integration checks against the committed SHA. Do not push, merge, or deploy from this worker.


## Final overlap correction
- Current code candidate is `997b6eee2403505e1a416fd5d2755496c30728e`. Third-line badge shifted upward to center y=21; 42px panel ends y=42, before footer y=43. The earlier y=31 candidate was superseded due footer overlap.
- Probe asserts complete wrapped text fits the panel and does not intersect description/footer; missing description/footer is a failure. Root must rerun the final assertion guard and branch CI before push.

## Current compact Legendary candidate
- Final code candidate `29457d658e309ee87fadffd30c565528a11d6405`: compact Legendary cards are 136px high. Effect plate remains 42px, local y=6..48; description origin shifts to -22 and footer begins y=49. Three cards span y=122..548 at 320x568. Probe reports and asserts effect/description/footer bounds.
- Root reports Windows browser 18/18 passed. TypeScript, `test:legendary`, `test:mutation-copy`, and `test:tokens` passed. Linux focused CI is pending following earlier 3-case desc-overlap failures; root pushes the candidate and owns that CI. No worker push/merge/deploy.

## Final viewport guard handoff
- Current code: `c01019f0708d9740cfc7a3f84da29bba149eed55`. Expansion to 136px requires the proposed full card stack to fit between measured subtitle bottom plus 9px gap and viewport bottom minus 9px. Otherwise 124px compact cards and the prior two-line Legendary effect limit remain.
- Root reports 18/18 supplemental browser cases passed over 320x568, 568x320, 390x740 with one/two-card sets. Probe includes card/effect/description/footer bounds and required fixture assertions.
- Local typecheck and Legendary/copy/token checks passed before the final probe-only addition; `node --check` and diff whitespace check passed afterward. Root must rerun focused Linux CI on final candidate before push. Landscape redesign remains a separate backlog item.

## Многокарточный Legendary layout probe (05.10)
- Текущий focused probe расширен в коммите `a4fd334f1f1b319d5a6016026a6689ef757eaceb`: прежние single-card cases сохранены; добавлены все 15 пар разных реальных Legendary definitions на трёх исходных viewport, synthetic three-Legendary robustness fixture и отдельный short-portrait guard 320x520.
- Synthetic три Legendary — тестовая нагрузка layout, не утверждение о trophy-контракте: реальный гарантированный trophy предлагает две карты (`guaranteedLegendaryChoices(..., 2)`).
- Измерения и проверки теперь собираются для каждой карточки из её собственного контейнера: соответствие каждого выбора, effect/plate/description/footer, stack intersections, gap под subtitle, viewport overflow и совпадение расширения с fit guard.
- Первый browser run завершился 87/88: все single и двухкарточные пары прошли; единственный провал — синтетические три Legendary на 320x480, где карточки пересекались с subtitle. Это недостижимый trophy-сценарий и непригодная геометрия стресс-fixture, не доказанный дефект production-пути. Fixture перемещён на 320x520: там 124px stack должен помещаться под subtitle, а предлагаемая 136px stack обязана не пройти нижний viewport guard. Повторный browser run прошёл 88/88: 24 single cases, 60 пары, 3 synthetic-three и 1 short-portrait guard. На 320x520 карточки остались 124px, subtitle gap 9px, overflow отсутствует. Независимое ревью ещё выполняется; Linux CI и реальные устройства не подтверждены. `node --check` и `git diff --check` прошли.

## Probe CI URL correction (05.10)
- Linux CI failed before layout assertions because the probe's default URL had been changed to local port 5197; the workflow starts Vite on 5173. Log evidence: work/multicard-linux-plain.log, line 190, connection refused.
- Restored the default to http://127.0.0.1:5173/; retain OFELIYA_URL override for local non-default ports such as 5197. This is test integration configuration, not a layout failure. Linux CI rerun remains pending.

## Linux probe content-specific fixture follow-up (05.10)
- После восстановления default port Linux browser probe выполнил тесты: 87/88 прошли. Все real Legendary singles/pairs и остальные сценарии прошли; единственный отказ — synthetic three-card short-height guard 320x520: одна Legendary definition требует 3 строки, но compact 124px карточка корректно допускает только 2. Лог: work/multicard-linux-plain2.log.
- Это не дефект реального trophy-контракта: guaranteed trophy предлагает 2 карточки. Короткий guard теперь использует три synthetic choices с эффектами, укладывающимися в compact 2-line limit, чтобы изолировать height decision. Длинный synthetic three-card stress остаётся на остальных высотах. Assertions неизменны; rerun pending.

## Linux short-guard fixture boundary (05.10)
- After the CI-port correction, Linux ran 88 probe cases: 87 passed, including all 15 actual Legendary pairs at each viewport, singles, and the other synthetic cases. The remaining short synthetic three-card guard at 320x520 selected one effect requiring 3 lines; compact 124px cards intentionally cap that effect at 2 lines. Evidence: `work/multicard-linux-plain2.log`.
- This is an unreachable synthetic content/height combination, not a production trophy failure: the guaranteed trophy offers two Legendary choices. The known long-effect three-card stress remains at taller heights. The short-viewport guard now uses definitions 0, 2, and 5, whose effects fit the compact two-line limit, to isolate the viewport-height decision. All 15 real pairs remain covered at 320x520. No assertions or production UI were weakened/changed; rerun pending.

## Short guard fixture correction (05.10)
- The Linux rerun showed the short-portrait guard still failed because Legendary definition index 3 also needs three wrapped lines. Linux measured the six single-definition line counts as `[2,3,2,3,3,2]`; log: `work/multicard-linux-plain2.log`.
- The guard now selects indices 0, 2, and 5, the measured two-line definitions; index 5 is the last-life-saving Legendary. This isolates the height-fit behavior using observed wrapping, not string length. All other scenarios stay unchanged. Latest Linux result remains 87/88; rerun pending. No production changes or assertion reductions.
