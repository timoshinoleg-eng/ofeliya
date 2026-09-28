# STATE — OFELIYA: STRAIN ZERO

Обновлено: 2026-09-28 (пилот памяти). Только факты; решения — в `02_DECISIONS.md`.

## Репозиторий

- GitHub: `https://github.com/timoshinoleg-eng/ofeliya`
- Ветки: `main`, `feat/donor-quick-wins` (активная), `fix/audit-blockers`, `backup/audit-blockers-0ecbf3c`
- Remote: `origin/main` @ 480c67b (28.09, PR #150 hardening — 8 фаз); `origin/feat/donor-quick-wins` @ a131d7c (26.09) — совпадает с локальной веткой.
- Worktrees (локально): `…\work\ofeliya-audit` (main @ 480c67b — синхронизирован с origin/main 28.09), `…\work\ofeliya-audit-fixes` (ветка @ a131d7c).
- Осталось: подтянуть origin/main в активную ветку (feat/donor-quick-wins) перед merge.

## Продукт

- OFELIYA: STRAIN ZERO, `v0.4.1-rc.1` (по локальной копии от 26.09), portrait roguelite-survivor для MAX Mini Apps.
- Кампания: КРОВОТОК → IMMUNE PRIME → СЕРДЦЕ → CARDIAC TITAN (≈9+ мин до боссов).
- Стандарт/Strained сложности; Legendary ≤2 за прогон; trusted score backend.

## Гейты

- CI: build gate + browser gate (`ci.yml`); `release-visual-matrix.yml` (100/150/200 × WebGL/Canvas × full/reduced).
- Внешний гейт: реальные MAX Android/iOS — 16 пунктов (`RELEASE_VALIDATION.md` §8). **Не пройден.**

## Инфраструктура и прод

- Деплой: Cloud.ru (`deploy/deploy-cloudru.sh`, `compose.production.yml`, `Caddyfile.ofeliya`, `nginx.conf`).
- Ремарка: зелёный CI означает консистентность репозитория, не «на VM крутится именно этот коммит» — проверять отдельно.

## Инструменты (пилот)

- Ноут 1 (Honor): OpenCode (основной), Cline (запасной), Codex desktop.
- Ноут 2 (HP): OpenCode (второй), Cline (запасной).
- ChatGPT web: Project «Офелия» — внешний ревьюер (обычный чат, не Work).
- Память: `memory/` в репозитории; контекст: плагин context-mode (проверен: v1.0.169 отвечает в сессии); доп. слой: cross-agent-memory MCP.
- Пилот, статус 28.09.2026: этап 0 — архив копий; этап 1 — память в репо; этап 2 (Honor) — OmniRoute сервер работает, OpenCode 1.18.32 → комбо `omniroute/OFELIYA-CODE` (живой тест ✓), скиллы gamedev 74+router (единый источник `~/.agents/skills`), Superpowers установлен плагином; этап 4 начат: ветка синхронизирована с main — merge `45712e9`; канонический гейт пройден (9 тестов + release:check + build ✓).
- Дальше: тест-цикл B (OpenCode) + внешнее ревью ChatGPT → PR/приёмка; затем этап 3 — HP.

## Открытые вопросы / риски

- Баланс полных прогонов и Heart timing — только через плейтест (CI не решает).
- Термика/перформанс на целевых телефонах — внешний гейт.
- Статус CI remote main (#150) в этой сессии не проверялся; локальный worktree main отстаёт от origin/main.
