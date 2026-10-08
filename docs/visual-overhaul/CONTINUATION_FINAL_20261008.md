# OFELIYA — продолжение после production-релиза

Текущий опубликованный релиз: `716292b78c5b2e53485170bcb8a4cc2780f9df04`. PR [179](https://github.com/timoshinoleg-eng/ofeliya/pull/179), [180](https://github.com/timoshinoleg-eng/ofeliya/pull/180), [181](https://github.com/timoshinoleg-eng/ofeliya/pull/181), [182](https://github.com/timoshinoleg-eng/ofeliya/pull/182) объединены ранее с разрешения владельца. [Точный main CI](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37775488149) и [деплой](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37777242773) прошли. Workflow подтвердил публичный SHA и SHA256 index/service worker/runtime config. Реальный запуск в приложениях MAX/Telegram этим не подтверждается; локальный HTTPS timeout также не доказывает недоступность сайта.

Новое продолжение опубликовано в [PR #183](https://github.com/timoshinoleg-eng/ofeliya/pull/183), текущий SHA `f1aefd27a087732140dc4b3b8f4e7e51f8cb8bea`. Этот PR не объединён и не развёрнут. [Финальный CI](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37814951211) прошёл полностью: build, production-contract, browser-smoke. [Артефакт](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37814951211/artifacts/11567044096) скачан и проверен: четыре actual Phaser renderer/tier сценария, восстановление на 180 мс, release/shutdown и отсутствие page errors. PR готов к ревью, merge/deploy не выполнялись.

При попадании герой и антитело получают локальную деформацию мембраны и запаздывание внутренней структуры: четыре направления, три стадии восстановления, 180 мс. На reduced используются две позы. Кадры готовятся один раз при загрузке; физический размер, столкновения, урон, RNG и управление сохранены. При гибели антитело оставляет короткий визуальный коллапс после немедленного отключения тела и начисления kill/rewards. Пул ограничен четырьмя изображениями, двумя на reduced; при плотности от 150 новых изображений нет, штатные kill particles сохраняются. Очистка, повторное использование и устаревшие callback защищены.

Дополнительная память атласов: 3,36 МиБ RGBA плюс GPU-копия. Это ограниченный расход, но влияние на запуск, FPS и нагрев телефона не измерено.

Проверки локально прошли: исходные presentation/audio/RNG контракты, новые кадры и жизненный цикл эффектов, TypeScript/build, 76 контрольных строк геометрии Phaser, четыре комбинации WebGL/Canvas × full/reduced. Повторная проверка HiDPI: шесть renderer/DPR случаев и парная сцена с 201 противником, Text/camera/input, resize, fallback и teardown. Эти browser fixtures не являются phone/FPS acceptance.

Два первых CI выявили ошибки, исправленные до текущего SHA. Дробная метка времени оставляла hit-позу на границе 180 мс; сравнение абсолютных сроков исправлено и подтверждено воспроизведением до/после. Тест паузы поздно изолировал RNA-прогрессию; подготовка перенесена до первого настоящего Game.update без отключения игрового updater, physics, clocks или ослабления touch/time assertions. [Доказательства и ревью исправлений](https://github.com/timoshinoleg-eng/ofeliya/blob/visual/combat-organic-response-20261008/docs/visual-overhaul/COMBAT_CI_CORRECTION_20261008.md).

Независимые Codex source review и Kimi direct review, включая исправления, дали PASS с ограничениями. Запрошенный OmniRoute-маршрут вернул пустой ответ и HTTP 504; успешное ревью через него не заявляется. Исходные ответы Kimi и проверка его замечаний опубликованы в PR. Мнение ревьюера о допустимой памяти не заменяет телефонный замер.

| Требование | Текущее состояние |
| --- | --- |
| VO-01 HiDPI | Настоящий 2× подтверждён в QA; production остаётся 1×, устройство не принято |
| VO-02 попадания | Направленные частицы и новый локальный hit; телефонная заметность не проверена |
| VO-03 VFX | Бюджеты, пулы и ограниченный death-эффект проверены |
| VO-04 Кровоток | Глубина/параллакс опубликованы; комфорт на телефоне не принят |
| VO-05 Сердце | Отдельные волокна и двойной пульс опубликованы |
| VO-06 звук | Адаптивный механизм и семь треков проверены; новые согласованные stems отсутствуют |
| VO-07 арт | Семь основных 4× assets опубликованы; RNA/projectile/icon kit частичен |
| VO-08 биологическое движение | Idle и hero/antibody hit, antibody death выполнены; charge/player death/другие роли частичны |
| VO-09 UI | HUD/меню/карточки и исправления пересечений проверены в браузере |
| VO-10 приёмка | Browser QA есть; реальные MAX Android/iOS и Telegram, плотный движущийся бой/FPS/нагрев не приняты |

[Галерея, исходные кадры и ролик](https://github.com/timoshinoleg-eng/ofeliya/blob/visual/combat-organic-response-20261008/docs/visual-overhaul/COMBAT_SLICE_20261008.md), [четыре actual Phaser сценария](https://github.com/timoshinoleg-eng/ofeliya/actions/runs/37814951211/artifacts/11567044096), [парные HiDPI измерения](COMBAT_HIDPI_PAIRS_20261008.json). Ролик демонстрирует повторяемые hooks в замороженной прогрессии без звука; он не доказывает читаемость живого плотного боя. Материалы также находятся в GitHub в `docs/visual-overhaul/captures-combat-20261008`.

Готовность: проверяемый технический PR для следующего визуального шага; полный профессиональный визуальный релиз остаётся частичным. Нужны реальные телефонные прогоны с touch/safe areas, gesture audio unlock/mute, background/resume, переходами/боссами и сравнимыми frame-time/memory/thermal измерениями. Авторские stems, выбранный расширенный арт и charge/player-death требуют отдельного творческого завершения. Без этих данных production HiDPI не активирован. Новых платных ресурсов, merge или production-deploy в этом продолжении не выполнялось.
