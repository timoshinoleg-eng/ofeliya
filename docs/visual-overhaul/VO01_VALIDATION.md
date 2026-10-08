# VO-01: локальная диагностика, 07.10.2026

Ветка `visual/vo-01-render-clarity-20261007`, base `d7797bc67bbda063d2fc3de68026101b0b061121`.
Это diagnostics-first slice; общий render resolution не менялся.

`window.__renderSnapshot()` доступен только в существующем DEV / `VITE_RELEASE_MATRIX_QA=1`
gate. Снимок detached, on-demand, без истории, таймеров, текста/identity полей.
Возвращает DPR, host/canvas DOM bounds, intrinsic canvas, renderer/GL buffer/viewport,
ScaleManager sizes/displayScale, Menu/Game/UI camera bounds/zoom, до четырёх Text
на активную сцену (до 256 просмотренных объектов, глубина Container до восьми).
Text logical bounds, internal canvas, style resolution и source resolution независимы.
Нет записи в buffers/cameras/input; Canvas guard/fallback и Joystick не менялись.

## Реальные команды и результаты

Все команды выполнены из текущего checkout. `node_modules` — обычный локальный
каталог без LinkType/Target; установлен Phaser 3.90.0. Конфиги/env-файлы не менялись.

| Команда | Exit / результат |
|---|---|
| `npm ci --cache .vo01-npm-cache --no-audit --no-fund` | 1: registry EACCES, затем `Exit handler never called!` |
| `npm ci --cache .vo01-npm-cache --no-audit --no-fund --fetch-retries=0` (approved escalation) | 0, 46 packages |
| `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` | 1: esbuild Access denied / config resolve; approved escalation повтор — сервер ready |
| `npm run test:viewport` до реализации | 0 |
| `node tests/startup-renderer-contract.mjs` до реализации | 0 |
| `node --check scripts/renderer-smoke.cjs` | 0 |
| `OFELIYA_ARTIFACTS=work/vo01-evidence node scripts/renderer-smoke.cjs` до реализации | **1, ожидаемый runtime RED:** Menu ready; hook undefined вместо function |
| `node node_modules/typescript/bin/tsc --noEmit` | 0 |
| Новый renderer smoke, первая реализация | 1: неверное предположение теста sourceResolution=style.resolution (1 != 2) |
| Renderer smoke после исправления source assertion | 1: resize wait 30s; fixture получил строковые MAX размеры и explicit resize signal |
| Renderer smoke следующие два запуска | 1: world-coordinate assertion после resume; readback показал camera shake (worldY -37.5 vs expected -34) |
| Renderer smoke с physics-isolated fixture | **0, DEV 6/6** |
| `npm run test:startup` | 0 (font-timeout, viewport-timeout, renderer contract); серверы тестов выбрали свободный порт после сообщения про занятый 5173 |
| `npm run test:viewport` после реализации | 0 |
| `npm run test:layout-diagnostics` | 0 |
| `node scripts/control-mode-smoke.cjs` | 0, one-hand/twin-stick/dual-move, CDP multitouch и reused IDs |
| `VITE_RELEASE_SHA=d7797bc67bbda063d2fc3de68026101b0b061121 npm run build` | 0, ordinary production |
| `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` | локальный preview ready |
| `node tests/render-snapshot-opacity.mjs` | 0, ordinary production, все три hooks отсутствуют даже при debug=1 |
| `VITE_RELEASE_MATRIX_QA=1 VITE_RELEASE_SHA=d7797bc67bbda063d2fc3de68026101b0b061121 npm run build` | 0, QA production |
| QA production renderer smoke первый запуск | 1: minified constructor `initialize`; assertion исправлен на стабильный renderer.type |
| `OFELIYA_URL=http://127.0.0.1:4173/ OFELIYA_ARTIFACTS=work/vo01-evidence-qa node scripts/renderer-smoke.cjs` | **0, QA production 6/6** |
| `npm run test:tokens`, `npm run test:runtime-quality`, `npm run test:challenge`, `npm run test:language` | каждый 0 |
| `node --check tests/render-snapshot-opacity.mjs`, `git diff --check` | 0 |

Env выше записан в shell-neutral notation; в PowerShell использовался `$env:...`.
Dev server получил только CI legal fixtures из существующего CI: MAX bot `ofeliya_ci_bot`,
legal name `CI Test Developer`, registration `CI-REG-1`, address `CI Test Address`,
support `qa@example.test`. Это не реальные release env; `build:max` не запускался.
Browser/esbuild команды выполнялись через approved escalation после sandbox отказа.
Первый `git add` и `git commit` получили fatal Permission denied для
`C:/Users/Имярек/ofeliya-review-sol61-20261005/.git/worktrees/repo/index.lock`:
worktree использует внешний common gitdir. Повтор `git add` через approved escalation — 0;
коммит также требует эскалации. Никакой policy bypass не выполнялся.
Предварительный `rg` по несуществующему `scripts/viewport-smoke.cjs` и guessed MaxBridge
paths дал exit 2/1; реальные viewport test и `MaxPlatform.ts` найдены и использованы.

Build warnings: runtime-config.js без module не bundled; ссылки Chakra Petch
`fonts/chakra-petch-1.woff2`/`-2.woff2` не resolved на build-time.
Git предупреждал LF -> CRLF. Эти предупреждения не исправлялись вне scope.

## Измерения и предел доказательств

DEV и QA production: WebGL/Canvas × DPR 1/2/3; Menu/Game при 390×844,
resize 320×568 и 412×915, затем pause/resume + visibilitychange signal.
Проверены размеры, active cameras, текст, nested runtime setResolution(2) Canvas guard,
detached/read-only snapshots, реальные mouse pointer coordinates в центре/краях,
world mapping под Game camera. Multitouch/modes — отдельный existing control smoke,
а не полный cross-product всех modes с DPR. OS background/MAX resume не моделировался.

Во всех DPR intrinsic canvas и WebGL buffer равны CSS/logical viewport, а не viewport×DPR.
Например DPR2: CSS/intrinsic/buffer 390×844, GL viewport [0,0,390,844], displayScale [1,1].
Text может иметь style resolution 2 и source resolution 1, internal canvas 392×112
при logical title 196×56. Это readback, не включение общего HiDPI.

Локальные JSON/PNG: `work/vo01-evidence` и `work/vo01-evidence-qa` (по шесть наборов,
пять snapshot фаз на набор). Они не коммитятся; PNG — финальный fixture, не paired
before/after benchmark и не подтверждение sharpness. npm cache также не коммитится.

На первом этапе Kimi review был **blocked**: прежний `VO01_KIMI_REVIEW.md` содержал
failed invocation invalid API key и был исключён из коммита. В fix1 он заменён
успешным независимым текстовым review (см. ниже). Independent acceptance у координатора.
Полный CI, Linux browser matrix, реальные MAX Android/iOS/Telegram, GPU performance,
release env и deploy/public release parity не проверены. Push/merge/deploy не выполнялись.

## Kimi fix round1

Источник: внешний `../vo01-kimi-review.md`, точная копия сохранена в
`VO01_KIMI_REVIEW.md` взамен failed artifact. Это независимое ревью frozen diff:
Kimi не запускал tools/tests и не инспектировал checkout; не считать его runtime evidence.

- F1: guard перед доступом к отсутствующей сцене возвращает пустой record
  `{ key, active:false, paused:false, camera:null, texts:[] }`. Focused browser test
  удаляет UI/Game/Menu из реального Phaser SceneManager. До fix — exit 1 с
  `Cannot read properties of null (reading 'cameras')`; после — GREEN.
- F2 / Q1: `releaseMatrixQa` определён в `src/main.ts` как build-time
  `import.meta.env.VITE_RELEASE_MATRIX_QA === '1'`; gate — `import.meta.env.DEV || releaseMatrixQa`.
  Vite заменяет env при build. Ordinary production здесь означает PROD build без QA=1;
  QA production — отдельная тестовая сборка с QA=1, не обычный release.
  Opacity test теперь сначала проверяет отсутствие строки `__renderSnapshot` во всех
  `dist/assets/*.js`, затем проверяет отсутствие трёх hooks в браузере с debug=1.
- Q2: `host` — результат `document.getElementById('game')` в boot(); отсутствие host
  вызывает явную ошибку до Phaser создания. Тот же host передан ViewportManager/Phaser parent.
- F3: pre-start update freeze и physics pause оставлены только в тестовом QA context
  для dimensions/input assertions. Это валидный вывод прежнего control-smoke расследования:
  Phaser захватывает update до CREATE, восстановление live progression разрушило бы
  fixture isolation. Nested container и Text уничтожаются в finally сразу после assertion;
  subsequent snapshots не содержат этого тестового текста. Live gameplay/performance не проверяются.
- F4: resume — настоящий scene.pause/scene.resume плюс synthetic dispatch visibilitychange
  при уже visible document (теперь asserted). Это visible-handler smoke; hidden transition,
  OS background/foreground и настоящий MAX resume не покрыты.
- F5: intrinsic=CSS assertion снабжён комментарием, что фиксирует текущий Phaser 3.90
  RESIZE baseline; будущий framebuffer HiDPI дизайн должен осознанно изменить тест.
- F6: numeric renderer constants документированы (Phaser 3.90 CANVAS=1, WEBGL=2).
- F8: default artifacts — platform `os.tmpdir()/browser-smoke`, env override сохранён.
- F10: opacity readiness использует существующий sessionStorage startup completed marker
  после Menu visible и rendered frames вместо фиксированного timeout.

Остаточные concerns: Q4 slow bridge/CI latency не моделируется (resize fixture immediate);
F7 nonzero device safe-area не покрыта; Windows browser install остаётся prerequisite.
Полного CI, hidden transitions, всех modes×DPR, реального HiDPI, MAX/device performance
или окончательной acceptance этот fix не доказывает. Координатор импортирует ветку и ведёт общий план.

### Fix1 actual evidence

| Команда (PowerShell env перед запуском) | Exit / результат |
|---|---|
| `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort` | server ready; завершён после проверок |
| `node tests/render-snapshot-missing-scenes.mjs` до guard, прежний QA build | 1, ожидаемый null.cameras RED |
| `node node_modules/typescript/bin/tsc --noEmit` | 0, два запуска |
| `VITE_RELEASE_MATRIX_QA=1 VITE_RELEASE_SHA=6204e3362908294dc32923d57b274b5ce2ee0c77 npm run build` | 0 |
| `node tests/render-snapshot-missing-scenes.mjs` после QA rebuild | 0, missing-scene GREEN |
| `OFELIYA_URL=http://127.0.0.1:4173/ OFELIYA_ARTIFACTS=work/vo01-fix1-qa node scripts/renderer-smoke.cjs` | 0, QA matrix 6/6 |
| `VITE_RELEASE_MATRIX_QA=0 VITE_RELEASE_SHA=6204e3362908294dc32923d57b274b5ce2ee0c77 npm run build` | 0, ordinary production |
| `node tests/render-snapshot-opacity.mjs` | 0: hook string отсутствует во всех JS chunks; hooks undefined после deterministic startup completion |
| `node --check scripts/renderer-smoke.cjs`, `node --check tests/render-snapshot-opacity.mjs`, `node --check tests/render-snapshot-missing-scenes.mjs`, `git diff --check` | каждый 0 |
| `Copy-Item ../vo01-kimi-review.md docs/visual-overhaul/VO01_KIMI_REVIEW.md`, `Get-FileHash` двух файлов | 0; одинаковый SHA256 57543FBC305272CBCF564E534F50802F4AD2045A22C23CA3AC1E2232D2C89EF2 |

Build warnings остались прежними (runtime-config script, Chakra Petch unresolved references).
Browser/build и Git metadata используют approved escalation, как в первом этапе.
Новых auth/config/routing операций не было; dependency install не повторялся.
Сборки stamped pre-fix HEAD 6204e33, не новый fix code SHA. Артефакты остаются локальными.
