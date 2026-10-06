# Проверка доноров для текущего этапа

Проверены исходники и лицензии; OFELIYA base d7797bc. Готовый модуль аналитики понимания в этих двух проектах не найден. Не переносим лишние системы ради объёма заимствования.

| Донор | Commit | Полезное | Решение |
|---|---|---|---|
| [Relaywake](https://github.com/leeseomin/Relaywake) | c57374e2ea13895206d18c8b8e3ac818ce6a0cab | src/game/e2e/testBridge.ts, tests/e2e/game.helpers.ts: управление детерминированным тестом и проверка сохранения | MIT, Phaser 4.2.1/Vue. Reference test approach only; OFELIYA уже имеет свой Playwright smoke. Не переносить второй тестовый runtime |
| [poke-survivors](https://github.com/giovanneluna/poke-survivors) | 188329a4eabe93072d3d18f740e4ce76ed4662da | src/systems/RunRecorder.ts: итоговая статистика | MIT, Phaser 3.90. Нет chronology/network delivery; OFELIYA имеет собственный RunState. Не копировать Pokémon assets |

Для нового отчёта переиспользовать существующий funnel, для доставки — HMAC signing и isolated server harness проекта, для браузера — существующий comprehension smoke. На следующих этапах брать донорский код после подтверждения конкретной потребности и проверки exact file/commit/license, сохраняя notices при копировании.
