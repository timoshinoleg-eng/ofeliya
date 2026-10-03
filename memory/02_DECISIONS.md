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

## Telegram TLS egress 04.10
- Keep certificate verification and SNI for `api.telegram.org`; do not disable TLS verification to work around Cloud.ru egress.
- Scope TLS 1.2 forcing to Telegram Bot API requests only. Do not change global Node TLS settings because MAX/VK and unrelated HTTPS traffic do not need this workaround.