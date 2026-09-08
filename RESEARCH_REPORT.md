# Отчёт: open-source проекты для усиления OFELIYA

Дата: 2026-09-07 · Промт: RESEARCH_PROMPT.md v2 · Проверено вручную (GitHub/официальные сайты)

## 1. Сводная таблица (сортировка по скорингу)

**Шкала скора — 0–36** = Влияние (0–4) × Перенос (0–3) × Дешевизна (0–3); порог ≥12
(в `RESEARCH_PROMPT.md` §6 раньше ошибочно значилось «0–10 … порог ≥4» — исправлено).

| # | Кат. | Проект + URL | Лицензия | Что переносим | Перенос % | Куда встраиваем | Скор |
|---|------|--------------|----------|---------------|-----------|-----------------|------|
| 1 | Джус | **Встроенные постэффекты Phaser 3.60+** — [FX docs](https://docs.phaser.io/phaser/concepts/fx), [changelog](https://github.com/phaserjs/phaser/blob/master/changelog/v3/60/FX.md) | MIT (часть Phaser) | Bloom/Glow/Vignette через `camera.postFX` и `obj.postFX` — ноль зависимостей | 100% | `BootScene`/`GameScene` (камера), пули/игрок | **36** |
| 2 | Джус | **phaser3-rex-notes** — [repo](https://github.com/rexrainbow/phaser3-rex-notes) | MIT (LICENSE подтверждён), 1.3k★, 10k+ коммитов, живой (ребрендинг под phaser4) | Точечные плагины: твины/тряска/частицы/UI-виджеты (модалки, слайдеры) | 90% | `UIScene`, `GameScene` (смерти, хиты) | **27** |
| 3 | Визуал | **Kenney** — [kenney.nl/assets](https://kenney.nl/assets) | **CC0** (подтверждено [официально](https://kenney.nl/support)), атрибуция не нужна | Иконки апгрейдов, спрайты взрывов/эффектов, UI-кит. Не заменить наш стиль, а дополнить | 100% | `UpgradeSystem` (иконки карточек), частицы | **24** |
| 4 | Дуэли A | **Seeded-дуэли** на **seedrandom** — [repo](https://github.com/davidbau/seedrandom) (MIT, заморожен с 2019 — стабилен) | MIT | PRNG-либа 100%; логика матча — наша. Детерминизм волн+апгрейдов по seed, вызов ссылкой `?startapp=duel:<seed>` | 70% (фича целиком наша, PRNG готовый) | `WaveDirector`, `UpgradeSystem`, `MaxBridge`, новая сцена DuelResult | **16** |
| 5 | Дуэли C | **Colyseus** — [repo](https://github.com/colyseus/colyseus) | MIT (README: «MIT licensed, even for commercial games»), 7.3k★ | Комнаты, матчмейкинг, реконнект, delta-синхронизация состояния, TS сервер+клиент | 90% неткода (геймплей дуэли — наш) | Новый Node-процесс рядом с ботом MAX | **18** |
| 6 | Аналитика | **Umami** — [repo](https://github.com/umami-software/umami) | **MIT** (проверено, не AGPL), 38.7k★ | Self-host аналитика воронки (источник установки, retention) | 100% (свой инстанс) | Docker на РФ-хостинге; нужен PostgreSQL | **18** |
| 7 | Звук | **Tone.js** — [repo](https://github.com/Tonejs/Tone.js) | MIT, 14.7k★ | Генеративная музыка без семплов (синтезаторы) | 90% | Новый MusicSystem поверх `Sfx.ts`; ⚠ бандл **74.8 КБ gzip** (замерено) — только lazy-load в меню | **12** |
| 8 | Аналитика | **PostHog core** — [repo](https://github.com/PostHog/posthog) | MIT (каталог `ee/` исключён; есть чистый `posthog-foss`), 39.6k★ | Альтернатива Umami, богаче, но Docker ≈4 ГБ RAM | 100% (свой инстанс) | РФ-хостинг | **6** |
| 9 | Дуэли C | geckos.io — [repo](https://github.com/geckosio/geckos.io) | BSD-3 | WebRTC-«UDP», но: свои STUN/TURN, проброс UDP, «ненадёжен by design», ESM-only | — | Исключён: для 1v1 на 2 игроков WebSocket (Colyseus) проще и надёжнее | ✕ |
| 10 | Дуэли C | nengi — [repo](https://github.com/timetocode/nengi) | Apache-2.0 | Неткод-движок, но master завязан на **Node 14** (у нас Node 24), демо устарели | — | Исключён: несовместим со средой | ✕ |
| 11 | Лидерборд | Supabase self-host | Apache-2.0 | Для одной таблицы рекордов — тяжеловес | — | Не кандидат: свой endpoint Node+SQLite за вечер | ✕ |

## 2. Топ-3 «взять первым»

**1) Постэффекты Phaser (bloom/glow) — ~2–4 часа, ноль зависимостей.**
Неоновый стиль получит главный выигрыш: `cameras.main.postFX.addBloom()` в GameScene + мягкий
`addVignette()`. Шаги: включить в `GameScene.create` → профилировать на слабом GPU → при
просадках перевести на точечный `postFX.addGlow()` на игроке/пулях вместо камеры целиком.
Флаг в `config.ts` (ON/OFF по производительности).

**2) Seeded-дуэли на seedrandom — 2–4 дня, главная вирусная фича для MAX.**
«Кинул ссылку в чат → друг играет тот же забег → сравнение счёта». Работы: (а) детерминизм —
заменить `Math.random` в `WaveDirector`/`UpgradeSystem`/`rollChoices` на seeded-PRNG
(seedrandom, MIT); наш движок уже доказал детерминизм (QA-прокачка кадров с фиксированным dt);
(б) парсинг `startapp=duel:<seed>:<name>` в `MaxBridge`; (в) экран результата дуэли
(победа/поражение + текст в `shareContent`). Реал-time (Colyseus) — вторая очередь, после
проверки спроса на формат.

**3) Kenney CC0 — прицельно: иконки 10 улучшений + спрайты взрывов — ~1 день.**
Карточки левелапа сейчас текстовые — иконки дадут самый заметный UX-рост. Базовый неон-стиль
не трогаем. Проверить читаемость иконок на 360 px.

Полка утилит: rex-plugins — брать точечно под конкретную задачу (виджет модалки, продвинутые
твины), когда встроенного не хватит.

## 3. Дыры — пишем сами

- **Survivors-референсы на Phaser 3 + TS** не найдены: найденные клоны — Unity, Godot или
  React-обёртки (красный флаг). Наш код — уже референс; идеи оружий/врагов черпать из геймплея
  оригинала, не из чужого кода.
- **Ghost-режим и daily-seed события** — готовых реализаций под веб не найдено; ядро (seedrandom)
  уже закрыто п.2, механика — наша.
- **Share-карточка результата** — проще нарисовать на канвасе самому (~1 день: счёт, ник,
  диплинк), готовые генераторы OG-картинок тянут DOM/шрифты и не стоят зависимости.
- **Лидерборд** — тривиален на нашем Node+SQLite; готовых «взять и поставить» решений нет
  (Supabase — из пушки по воробьям).

## 4. Непроверенное / требует внимания при внедрении

- rex-plugins: совместимость **конкретных плагинов** с Phaser 3.90 (сам репо жив и уходит в
  сторону phaser4) — проверять per-plugin при выборе.
- Colyseus: даты релизов на странице GitHub не видны (экосистема заведомо активна, версия 3.x),
  монтирование в наш существующий http-сервер бота — проверить по докам транспорта.
- jsfxr (параметризованные SFX-вариации): точная лицензия npm-пакета не подтверждена — у нас
  уже есть свой синтезатор, кандидат опциональный.
- Tone.js: вес замерен (Bundlephobia, `tone@15.1.22`) — **74.8 КБ gzip** / 329 КБ minified
  (`standardized-audio-context` 36.7% + собственно Tone 62.7%), а не ~150 КБ, как предполагалось.
  Это половина бюджета в 150 КБ, так что вывод тот же: **только lazy-load**, и не раньше,
  чем появится реальная потребность в генеративной музыке.
- Umami требует PostgreSQL (отдельный сервис на РФ-хостинге); PostHog — 4 ГБ RAM. Выбор
  аналитики отложить до публикации.

## 5. Источники

GitHub: [colyseus/colyseus](https://github.com/colyseus/colyseus),
[rexrainbow/phaser3-rex-notes](https://github.com/rexrainbow/phaser3-rex-notes),
[davidbau/seedrandom](https://github.com/davidbau/seedrandom),
[geckosio/geckos.io](https://github.com/geckosio/geckos.io),
[timetocode/nengi](https://github.com/timetocode/nengi),
[umami-software/umami](https://github.com/umami-software/umami),
[PostHog/posthog](https://github.com/PostHog/posthog),
[Tonejs/Tone.js](https://github.com/Tonejs/Tone.js);
[докам Phaser FX](https://docs.phaser.io/phaser/concepts/fx);
[Kenny support (CC0)](https://kenney.nl/support);
поиск: GitHub topics (`phaser3`, `colyseus`, `survivors`), npm (jsfxr), itch.io.
