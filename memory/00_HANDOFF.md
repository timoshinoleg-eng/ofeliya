# HANDOFF — OFELIYA: STRAIN ZERO — 2026-09-28

> Файл памяти (пилот). Прочитай меня и `01_STATE.md` перед задачей.
> В конце сессии перепиши меня для следующего исполнителя.

## Инструкция для принимающего агента

Ты продолжаешь работу над OFELIYA: STRAIN ZERO.
До начала работы прочитай: этот файл + `01_STATE.md` (+ `02_DECISIONS.md` при сомнениях).
Факты бери из файлов — не проси пересказывать проект заново.

## Текущая задача

- Ветка `feat/donor-quick-wins` (локально и на GitHub — `a131d7c`, 26.09.2026): донорские квик-вины —
  онбординг-стейт-машина, daily streak, comprehension hints, сохранение подсказок при resume.
- ВАЖНО: `origin/main` ушёл вперёд — `480c67b` (28.09, PR #150 «hardening: production integrity and
  release safety», 8 фаз: run capabilities, score-store fsync, input lifecycle, layout cache,
  release identity, deploy rollback, nginx headers, аудио-кэш + vendor chunk).
  Локальный worktree `main` (@ `4aa1e9c`) отстаёт от remote.
- Ближайшая цель: подтянуть `origin/main` в ветку (merge/rebase), прогнать канонический гейт,
  разрешить конфликты с hardening-волной, затем приёмка и merge в `main`.
- Ограничения: release-контракт MAX (публикационный билд только `npm run build:max`);
  не менять `Joystick`; renderer Phaser-only.

## Состояние на момент передачи

- Версия: `0.4.1-rc.1` (по локальной копии; remote main уже содержит hardening #150).
- Worktree: `ofeliya-audit` (main @ `4aa1e9c` — отстаёт от origin/main), `ofeliya-audit-fixes` (ветка @ `a131d7c` = remote).
- Remote: `origin/main` @ `480c67b` (28.09), `origin/feat/donor-quick-wins` @ `a131d7c` (26.09).
- CI: `ci.yml` (build gate + browser gate), `release-visual-matrix.yml`, `deploy-cloudru.yml`.
- Прод: Cloud.ru (см. `deploy/`: `deploy-cloudru.sh`, `compose.production.yml`).

## Сделано в этой сессии (пилот памяти)

- Этап 0: старые копии проекта проверены и перенесены в архив `Documents\Archive\ofeliya-2026-09\` (ничего не удалялось; у старого клона в `Downloads\ofeliya` были несохранённые правки — сохранены как diff и копии файлов в архиве).
- Этап 1: файлы памяти (`memory/`), `AGENTS.md` и `opencode.json` добавлены в репозиторий, ветка `feat/donor-quick-wins`.
- Дальше: подтянуть `origin/main` (#150) в ветку, затем этап 2 — OmniRoute + OpenCode на Honor (чек-лист SETUP-CHECKLIST.md).

## Проверено / не проверено

- Проверено: структура репо, ветки, конфиги, состав CI (по локальной копии от 28.09).
- Не проверено: статус CI последних коммитов remote main (проверить перед merge);
  реальные MAX-устройства (внешний гейт VIR-16 не пройден).

## Режим проверки (для второго агента)

Перепроверь, не доверяя на слово:

- изменения ветки `feat/donor-quick-wins` против списка квик-винов (онбординг / streak / hints) — есть ли регрессии?
- проходят ли профильные smoke-тесты: `test:onboarding`, `test:daily-history`, `test:comprehension`;
- сохраняются ли подсказки при resume (последний коммит заявлен как исправление именно этого).

Формат ответа: подтверждено / опровергнуто / вопросы.

## Следующие шаги (в порядке приоритета)

1. Синхронизировать worktrees с origin/main (`git fetch`; pull в worktree main; затем подтянуть main в активную ветку).
2. Прогнать канонический гейт локально (`npm ci` + тесты из README) и проверить CI после слияния с #150.
3. Ревью и merge `feat/donor-quick-wins` в `main`.
4. Подготовить список для внешнего гейта RELEASE_VALIDATION §8 (реальные MAX Android/iOS).
5. Продолжить балансировку по полным прогонам.

## Обязанности в конце сессии

1. Обнови `01_STATE.md` — только факты.
2. Допиши решения в `02_DECISIONS.md`.
3. Обнови `03_BACKLOG.md` — вычеркни сделанное, добавь новое.
4. Перепиши этот файл для следующего исполнителя.
