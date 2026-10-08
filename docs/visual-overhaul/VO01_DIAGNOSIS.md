**Вывод: в установленном Phaser 3.90.0 нет поддерживаемого общего `render.resolution`/DPR-множителя, который при `Scale.RESIZE` увеличивает framebuffer, сохраняя прежние логические размеры.** `Text.setResolution(2)` поддерживается, но повышает разрешение только текстовой текстуры. Безопасный первый шаг VO-01 — диагностика фактического рендера; включение общего HiDPI потребует отдельного дизайна.

Проверка выполнена только чтением файлов. HEAD: `d7797bc67bbda063d2fc3de68026101b0b061121`. Код, конфиги и память не изменялись; тесты и браузер не запускались.

**1. Наблюдаемые факты**

Пути проекта ниже отсчитываются от текущего `repo`; пути Phaser — от `C:/Users/Имярек/ofeliya-review-sol61-20261005/node_modules/phaser`.

| Факт | Источник |
|---|---|
| Установленная внешняя версия — **3.90.0**. | Phaser `package.json:3` |
| OFELIYA использует `Scale.RESIZE`, размеры берёт из `host.clientWidth/clientHeight`. Общий resolution в конфигурации отсутствует. | Проект `src/main.ts:294–319` |
| ViewportManager задаёт размеры и положение host в CSS-пикселях после вычисления safe area; передаёт те же размеры в `game.scale.resize()`. | `src/platform/ViewportManager.ts:108–120` |
| В ветке RESIZE Phaser устанавливает `displaySize`, `gameSize`, `baseSize` по размерам parent и записывает соответствующие размеры непосредственно в `canvas.width/height`. DPR не используется. | Phaser `src/scale/ScaleManager.js:1065–1086` |
| Прямой `scale.resize(w,h)` также меняет **gameSize и baseSize**, затем intrinsic canvas. Это изменение размеров игры, а не только плотности буфера. | Phaser `src/scale/ScaleManager.js:831–881` |
| `Core.Config` не читает `resolution`, `pixelRatio` или `devicePixelRatio`; таких параметров нет и в проверенных GameConfig/RenderConfig typedefs. | Phaser `src/core/Config.js`, `src/core/typedefs/GameConfig.js`, `RenderConfig.js` |
| WebGL renderer получает `baseSize`; его resize задаёт размеры renderer, проекцию, viewport и scissor одним набором `w,h`. | Phaser `src/renderer/webgl/WebGLRenderer.js:1358–1364,1420–1438` |
| Камера, ранее занимавшая полный экран, при resize получает размеры `baseSize`. Для остальных камер автоматическое изменение условно. | Phaser `src/cameras/2d/CameraManager.js:685–697` |
| Pointer переводится через ScaleManager; коэффициент — `baseSize / canvasBounds`, затем вычитается положение canvas. | Phaser `src/scale/ScaleManager.js:976,1269–1287`; `src/input/InputManager.js:1028–1047` |
| Text resolution увеличивает внутренний canvas текста; WebGL выводит его с делением размеров на resolution, сохраняя логический размер текста. | Phaser `src/gameobjects/text/Text.js:1250,1303–1331`; `TextWebGLRenderer.js:45` |
| OFELIYA сохраняет WebGL `setResolution(2)`, а в Canvas перехватывает вызовы `Text.setResolution()` и передаёт 1. | Проект `src/main.ts:153–172,289` |
| StartupTrace записывает DPR и renderer, но не размеры framebuffer, проекции или камер. После завершения trace новые metadata игнорируются. | `src/systems/StartupTrace.ts:133,147–155`; `src/main.ts:277–279,326` |
| Renderer smoke собирает intrinsic/CSS canvas и DPR, но проверяет renderer и resolution заголовка. Соотношение canvas/CSS и GL buffer **не проверяется**. | `scripts/renderer-smoke.cjs:38–69` |
| Release matrix использует DPR=2, четыре renderer/tier-комбинации и 100/150/200 врагов. Проверяет состав сцены и широкие пороги luminance/edge energy, а не корректность HiDPI. | `scripts/release-visual-matrix.cjs:14–20,60–110,264–300,374–391` |

Следствие из кода, **не runtime-измерение**: при host 390×844 текущий RESIZE ожидаемо создаёт canvas около 390×844 intrinsic pixels и такой же CSS-размер даже при DPR=2. У WebGL текстовая текстура может быть плотнее, но итоговое изображение ограничено разрешением общего framebuffer.

**2. Что в прежних утверждениях неверно или остаётся гипотезой**

- **Опровергнуто:** «достаточно добавить `render.resolution: devicePixelRatio`». Проверенная версия Phaser этот параметр не обрабатывает.
- **Опровергнуто:** «WebGL и `Text.setResolution(2)` уже означают общий HiDPI canvas». Это разные уровни разрешения.
- **Опровергнуто как безопасный рецепт:** «передать `width × DPR`, `height × DPR` в ScaleManager». Меняются размеры игры, камеры и преобразование ввода; RESIZE при следующем refresh снова подгоняет размеры под parent.
- **Не подтверждено:** «размытость вызвана главным образом framebuffer». Статическая конфигурация делает эту причину правдоподобной, но нужны фактические размеры и одинаковые captures.
- **Не подтверждено:** «DPR=2 даст приемлемую мобильную производительность». При удвоении обеих сторон площадь буфера возрастает в четыре раза; SwiftShader не подтверждает мобильный FPS.
- **Canvas guard следует сохранить.** В Canvas renderer есть деление размеров на `frame.source.resolution` (`CanvasRenderer.js:855–856`), поэтому утверждение «Canvas вообще не поддерживает text resolution» неверно. Конкретный исторический дефект OFELIYA этим чтением не воспроизведён.

Есть также устаревшие комментарии самого Phaser: `TextStyle.js:248` обещает default resolution из Game Config, но `Text.js:249–252` фактически заменяет 0 на 1. Исполняемый код здесь надёжнее комментария.

Полный текст прежнего аудита в просмотренном пакете отсутствует; оценены утверждения, обозначенные в COORDINATION и текущих комментариях/тестах.

**3. Минимальный безопасный дизайн VO-01**

Первый кандидат — **QA-диагностика без изменения плотности рендера**:

- В существующем DEV/release-matrix QA режиме собирать DPR, host/canvas DOM bounds, intrinsic canvas, `gameSize/baseSize/displaySize/displayScale`, renderer dimensions, GL drawing buffer/viewport и размеры/zoom камер Game и UI.
- Снимать состояние после появления Menu, после старта Game и после resize/resume. Для поздних снимков использовать отдельный ограниченный QA snapshot: StartupTrace уже закрыт.
- Для репрезентативного текста фиксировать logical bounds, internal canvas и resolution.
- Сохранять renderer fallback, Canvas guard, safe areas и существующий ввод.

**Общий HiDPI пока не включать.** Его дизайн должен явно разделить CSS/logical viewport и physical framebuffer, согласовать projection, camera viewport/scissor и pipeline resize, сохранить pointer/world mapping. Ручное увеличение `canvas.width` или один `camera.zoom` такой контракт не обеспечивают.

**4. Значимый план тестов и captures**

1. **Размеры:** DPR 1/2/3; viewport 320×568, 390×844, 412×915; WebGL и Canvas. Проверять фактические размеры после boot, resize и resume.
2. **Геометрия:** Menu, HUD и mutation modal; отсутствие clipping, сохранение размеров текста и hit areas. Добавить вложенный Text с runtime `setResolution(2)` для проверки Canvas guard.
3. **Ввод:** реальные browser pointer/touch события в центре и у краёв; world coordinates под камерой; one-hand, twin-stick и dual-move, включая resize и повторное использование pointer ID. Перед проверкой явно подтвердить активные Game/UI и отсутствие блокирующего modal.
4. **Captures:** одинаковые SHA, viewport, DPR, renderer, tier, seed и время сцены; парные кадры Menu/HUD/modal и плотного gameplay. Текущая matrix приостанавливает physics, но это не замораживает всю визуальную сцену (`release-visual-matrix.cjs:242,309–340`).
5. **Для будущего HiDPI-кандидата:** требовать прежних logical размеров и координат ввода при увеличенном physical buffer. Если эти инварианты нарушены — кандидат отклонять.
6. **Устройства:** MAX Android/iOS для sharpness, safe area, touch и frame-time. Chromium/SwiftShader оставить проверкой корректности.

**5. Блокеры и границы доказательства**

- В текущем checkout нет `node_modules`; внешний Phaser прочитан, но его подключение к runtime этого checkout не проверялось.
- Нет runtime readback, новых captures или измерений мобильного GPU. Существующие browser scripts создают артефакты, поэтому в этом read-only probe они не запускались.
- Нет подтверждённого простого API для общего HiDPI с сохранением RESIZE-контракта.
- Полный прежний аудит недоступен в просмотренных файлах.

**Рекомендация координатору:** принять VO-01 сначала как диагностический кандидат. Решение об общем HiDPI принимать по framebuffer/readback и парным captures, с отдельной проверкой логической геометрии и ввода.