# DECISIONS — OFELIYA: STRAIN ZERO

Формат: `[дата] Решение — причина. Статус.`
Перенесённые решения помечены источником (документы репо). Новые решения добавляются сюда после каждой сессии.

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
