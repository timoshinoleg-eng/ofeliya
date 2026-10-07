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

Kimi review **blocked**: `VO01_KIMI_REVIEW.md` — failed invocation invalid API key,
не ревью/доказательство и исключён из коммита. Independent review у координатора.
Полный CI, Linux browser matrix, реальные MAX Android/iOS/Telegram, GPU performance,
release env и deploy/public release parity не проверены. Push/merge/deploy не выполнялись.
