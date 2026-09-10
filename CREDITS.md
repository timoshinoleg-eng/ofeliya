# CREDITS — лицензии и атрибуции

Правило проекта: только открытые лицензии (MIT, CC0, OFL, ISC). GPL-код не используется
(он форсил бы открытие исходников всей игры).

## Движок и зависимости (npm)

| Зависимость | Лицензия | Примечание |
|---|---|---|
| [Phaser 3](https://phaser.io/) | MIT | игровой движок |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 (совместимо) | только компилятор, runtime-кода не добавляет |
| [Vite](https://vite.dev/) | MIT | сборка/дев-сервер |

## Аудио (CC0 1.0 — атрибуция не требуется, указана добровольно)

| Ассет | Источник | Путь |
|---|---|---|
| SFX (12 файлов: shoot, hit, pickup, levelup, hurt, click, nova, elite, boss, gameover, victory) | [Kenney — Audio CC0](https://kenney.nl/assets/audio) | `public/audio/sfx/` |
| Музыка, 7 треков (loop0–6) | [OpenGameArt — CC0 Music](https://opengameart.org/content/cc0-music-0) | `public/audio/music/` |

Процедурные blip'ы-фолбэки (WebAudio, `src/systems/Sfx.ts`), в т.ч. звук рывка `dodge` —
написаны в проекте с нуля, паттерн — как в [jsfxr](https://sfxr.me/)/[zzfx](https://savezero.cc/zzfx.js)
(обратный синтез коротких SFX осцилляторами); никакого их кода в репозитории нет.

## Шрифты

| Ассет | Лицензия | Источник |
|---|---|---|
| Chakra Petch (400, 700) | [OFL 1.1](https://openfontlicense.org/) | [Google Fonts / fonts.google.com/specimen/Chakra+Petch](https://fonts.google.com/specimen/Chakra+Petch) |

## Графика

Вся игровая графика (игрок, враги, пули, частицы, иконки, фон) генерируется кодом
(`src/scenes/BootScene.ts`) — внешних ассетов нет, лицензионных рисков нет.

## Паттерны и референсы (код НЕ копировался, применяются идеи)

Подробности — в [docs/OPEN_SOURCE_REFERENCES.md](docs/OPEN_SOURCE_REFERENCES.md):
клоны Vampire Survivors (структура волн, эволюции оружия), Phaser mobile performance
guides (пулы, адаптивное качество), jsfxr/zzfx (процедурный звук), Kenney.nl и
OpenGameArt (CC0-ассеты).
