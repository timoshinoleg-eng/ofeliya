# OFELIYA — открытые референсы и паттерны (Этап 6)

Правило: **чужой код не копируем** — берём проверенные паттерны и
архитектурные решения, проверяем лицензию источника и указываем её в CREDITS.
Ниже — что нашли, где применили и почему.

## 1. Клоны Vampire Survivors на GitHub

| Референс | Лицензия | Что взяли (паттерн) | Где в OFELIYA |
|---|---|---|---|
| [ricardo-foundry/canvas-vampire-survivors](https://github.com/ricardo-foundry/canvas-vampire-survivors) | MIT | **Wave director** как отдельный класс, управляющий темпом/составом волн и боссами; **эволюции оружия** как отдельный слой (не в main-пуле улучшений); PWA/шаринг-карточка; `docs/CONTRIBUTING` | `WaveDirector.ts`, `EvolutionSystem.ts` (рецепты → «ЭВОЛЮЦИЯ ГОТОВА»), share-карточка |
| [sephirxth/SurvivorDemo](https://github.com/sephirxth/SurvivorDemo) (Phaser 3 + TS) | MIT | Авто-атака по ближайшему врагу; **ограничение активных тел физикой** (<200 на мобильном); мобильный виртуальный джойстик «под пальцем» | `GameScene.nearestEnemy()`, cap 240 enemies, `Joystick.ts` |
| [getsentry/sentaur-survivors](https://github.com/getsentry/sentaur-survivors) | MIT (архив) | Тактические item-pickups с ограниченным числом слотов | Стек-лимиты `UpgradeDef.max` (dmg 6, rate 6, …) |

> Баланс «база → элита → босс на фиксированном времени» и hit-stop/game-feel —
> собственные решения OFELIYA (см. `config.ts`, `JUICE`), не взяты из чужого кода.

## 2. Оптимизация Phaser для мобильных

Источники: [Phaser Performance Optimization Guide](https://generalistprogrammer.com/tutorials/phaser-performance-optimization-guide),
[Phaser.js 2026 build guide](https://www.seeles.ai/resources/blogs/phaser-js-game-development-2026),
вопросы о лагах Phaser на мобильных в StackOverflow. Паттерны → реализация:

| Паттерн (из гайдов) | Реализация в OFELIYA |
|---|---|
| **Object pooling** для пуль/врагов/частиц (убрать GC-hitches) | `physics.add.group({ classType, maxSize })` для bullets/enemies/gems; пулы dmg-текстов и трейлов; постоянные emitters без пересоздания |
| **Адаптивное качество** (снижать эффекты при просадке FPS) | `GameScene` — эвристика устройства + замер FPS первые 6с, <45 → снять bloom/vignette postFX, вернуть виньетку-текстуру |
| **Аркадная физика** (не Matter.js) | `arcade` уже |
| **Ограничить тела физики** (мобильный <200) | cap 240 enemies, `spawn` early-returns при переполнении |
| **roundPixels: true / powerPreference: high-performance / antialias** | в `main.ts` |
| **Минимизировать перерисовку Graphics** (GPU-стейт) | `UIScene` — бары перерисовываются только по изменению `barKey` |
| **Переиспользовать объекты** (не аллоцировать в update) | snapshot `run` — один объект на забег, мутируется |
| **Чистить event-listeners на SHUTDOWN** | в сценах/системах (`SHUTDOWN`-обработчики) |
| **Меньше blend-mode переключений** | trail/blade/ring используют `ADD`, но их мало и они мелкие |

## 3. Процедурный звук (jsfxr / zzfx)

- [sfxr (jsfxr)](https://sfxr.me/) и [zzfx](https://savezero.cc/zzfx.js) — паттерн
  «короткий SFX синтезом из осциллятора (blip) с огибающей».
- Применили: `Sfx.fallback()` — WebAudio-blip на каждый SFX (работает оффлайн, если
  CC0-файл не загрузился), в т.ч. новый `dodge`. **Никакой чужой код не импортирован**,
  только идея синтеза. Лицензии: jsfxr — zlib, zzfx — zlib (совместимы), но код не
  копировался.

## 4. CC0-ассеты (Kenney / OpenGameArt)

- [Kenney.nl — Audio](https://kenney.nl/assets/audio): 12 SFX, CC0 1.0.
- [OpenGameArt — CC0 Music](https://opengameart.org/content/cc0-music-0): 7 музыкальных
  треков, CC0 1.0.
- Атрибуция не обязательна (CC0), но указана в CREDITS. Графику Kenney НЕ использовали —
  весь визуал процедурный (см. CREDITS).

## 5. Чего НЕ делали сознательно

- **Не тянули** чужие ассеты/код из GPL-репозиториев (форс открывания исходников).
- **Не дублировали** баланс из конкретных клонов — кривая `difficulty()`, HP/урон и
  timing босса расчитаны под 5-минутный цикл OFELIYA (см. `config.ts`).
- **Не добавляли** тяжёлых зависимостей (Matter.js, atlas-генераторы, частиц-движки) —
  текущий бандл 363 KB gzip достаточно.
