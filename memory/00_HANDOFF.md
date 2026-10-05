# HANDOFF — release closure, 05.10.2026

Ограниченный release closure выполнен в отдельном checkout поверх `1d6bb37`. Единственный кодовый
коммит: `a32b3f2`.

## Что сделано

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

`.gitignore`: ровно одно правило `artifacts/mobile-acceptance.json`. Проверено, что
`artifacts/other.json` остаётся видимым; tracked assets не удалялись.

## Проверки (локально, фактические exit statuses)

- `npm ci` — 0
- `git diff --check` — 0
- `npm run test:tokens` — 0 (`ui tokens contract: ok`)
- `npm run build` при `VITE_RELEASE_MATRIX_QA=1` и `VITE_RELEASE_SHA=$(git rev-parse HEAD)` — 0,
  `Stamped OFELIYA release 1d6bb3789326fe6ffe937c14ae9facb6a7062225`

`test:mobile-evidence` не запускался: реальных device evidence нет, и подделывать их нельзя.

## Что дальше

Coordinator/Cline/Hoplite — независимое ревью `a32b3f2` (не Codex reviewer), максимум две итерации
правок. Push/merge/deploy не выполнялись.

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
