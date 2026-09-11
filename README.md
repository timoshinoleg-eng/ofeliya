# OFELIYA

Рогалик-выживание в стиле Vampire Survivors — мини-приложение для мессенджеров
**MAX** и **Telegram** (работает и в обычном браузере).
Персонаж стреляет автоматически, игрок управляет движением (джойстик/ WASD),
уклоняется рывком (свайп/Space), собирает фрагменты данных, выбирает улучшения
и удерживает ЯДРО OFELIYA до критической фазы: на 5:00 появляется босс,
победа засчитывается только после его уничтожения.

## Стек

- **Phaser 3 + TypeScript + Vite** — сама игра. Основной визуал генерируется кодом;
  внешние ассеты — CC0-аудио в `public/audio/` (Kenney SFX, OpenGameArt музыка) и
  шрифт Chakra Petch (OFL) в `public/fonts/`. Лицензии — в [CREDITS.md](CREDITS.md).
- **MessengerBridge** (`src/systems/MessengerBridge.ts`) — единый мост мессенджеров:
  MAX (`window.WebApp`) → Telegram (`window.Telegram.WebApp`) → браузер (no-op).
  Хаптика, нативный back, шаринг, тема, `initData`. `initDataUnsafe` — только
  удобный клиентский контекст, **не** доверенная авторизация: серверная
  идентификация — только валидацией подписанной `initData` на доверенном backend.
- **SafeArea** (`src/systems/SafeArea.ts`) — чтение `env(safe-area-inset-*)` для
  корректного HUD на notch-устройствах.

## Запуск

```bash
npm install
npm run dev         # дев-сервер http://localhost:5173
npm run build       # прод-сборка в dist/ (tsc + vite)
npm run preview     # локальный просмотр прод-сборки
npm run smoke       # автотест чистой логики (rng/daily/стрики/лидерборд)
npm run server:test # тесты score-сервера и бота (16 проверок, без сети)
```

## Бэкенд (zero-dep Node)

Сервер и бот — чистый Node (http + crypto + fs), без зависимостей. JSON-store
в `server/data/` (атомарная запись); API спроектирован так, чтобы при росте
нагрузки переехать в PocketBase/SQLite без смены клиентского контракта.

```bash
npm run server      # score-сервер: http://localhost:8787
npm run bot         # Telegram-бот (long polling)
```

Переменные окружения:

| env | где | назначение |
|---|---|---|
| `PORT` | server | порт score-сервера (default 8787) |
| `DATA_DIR` | server | папка JSON-store (default `server/data`) |
| `TG_BOT_TOKEN` | server+bot | токен бота: валидация TG `initData` + push «твой ход» |
| `MAX_BOT_TOKEN` | server | токен бота MAX: валидация MAX `initData` |
| `GAME_URL` | server+bot | публичная ссылка на мини-апп (в push и ответах бота) |
| `VITE_SERVER_URL` | клиент (build) | base score-сервера; пусто → relative API under current deployment prefix |
| `VITE_MAX_BOT_USERNAME` | клиент (build) | public MAX bot username без @ для startapp/share/ref links |
| `VITE_TG_BOT_USERNAME` | клиент (build) | public Telegram bot username без @ для startapp/share/ref links |
| `VITE_ANALYTICS_URL` | клиент (build) | PostHog-совместимый endpoint `/capture`; пусто → только буфер |
| `VITE_VK_REWARD_PLACEMENT_ID` | клиент (build) | rewarded-реклама VK: placement_id из VK Ads (Apps→Placements). Пусто → слот не показывается |

API: `POST /api/score` (initData-авторизация, anti-cheat и referral persistence),
`GET /api/top?period=all|daily|weekly|season` (без raw platform uid), `GET /api/ref`
(read-only referral stats), `GET /api/friends` (без raw uid), `GET /health`. Legacy
`POST /api/ref` оставлен только для старых dev-клиентов и заблокирован production nginx.

## PWA

Игра installable: `manifest.webmanifest` (fullscreen, тема, иконки, shortcut
«Ежедневное» → `?daily=1`), service worker (`public/sw.js`): app shell —
pre-cache, навигации — network-first с offline-fallback, assets —
stale-while-revalidate, `/audio` не кэшируется (стриминг 11MB).
Иконки генерируются без зависимостей: `npm run icons` → `public/icons/`.

Управление:

| Действие | Мобильный | Десктоп |
|---|---|---|
| Движение | тап/драг — джойстик под пальцем | WASD / стрелки |
| Уклонение (рывок + i-frames, кулдаун 1.1s) | быстрый свайп-флик | Space / Shift |
| Пауза | пауз-кнопка в HUD / нативный «назад» | пауз-кнопка в HUD / «назад» |

Мобильные детали: safe-area (notch/home-indicator), отключены double-tap zoom,
контекстное меню, выделение и pull-to-refresh, автопауза при уходе в фон
(сцена + WebAudio), кнопки ≥44×44pt.

## Публикация в MAX

1. `npm run build` → в `dist/` статика с относительными путями (`base: './'`).
2. Разместить `dist/` на HTTPS-хостинге (любом; рекомендован тот же регион,
   где играют пользователи).
3. В кабинете MAX указать HTTPS URL мини-приложения у бота.
4. Для share/ref deep links перед build задать `VITE_MAX_BOT_USERNAME=<бот>` без @.
   Docker/Compose передают его как build arg; пустое значение безопасно отключает bot-style startapp link.
5. Серверные рейтинги/персональные данные — только после серверной проверки
   подписанного `window.WebApp.initData` (HMAC с токеном бота).

## Публикация в Telegram Mini App

1. `npm run build` → разместить `dist/` на HTTPS-хостинге.
2. В [@BotFather](https://t.me/BotFather): `/newbot` → Bot Settings →
   Menu Button → URL мини-приложения.
3. Для share/ref deep links перед build задать `VITE_TG_BOT_USERNAME=<бот>` без @ —
   deep link `https://t.me/<бот>?startapp=<payload>`.
4. Адаптер уже встроен: `telegram-web-app.js` подключается в `index.html`
   (в MAX/браузере — no-op), тема/хаптика/шеринг идут через MessengerBridge.

## Публикация в VK Mini Apps / OK (V6)

Один и тот же `dist/` публикуется в **ВКонтакте, Одноклассниках, Почту Mail.ru,
браузер Atom и RuStore** (45M MAU экосистемы).

1. `npm run build` → разместить `dist/` (или использовать **VK Mini Apps Deploy** —
   бесплатный хостинг одной командой).
2. В [кабинете VK](https://vk.com/minis) создать мини-апп, указать URL, иконки
   (иконки уже в `public/icons/`), описать. Модерация — до 7 раб. дней.
3. Адаптер уже встроен: `vk-bridge` (CDN, `index.html`) → `window.vkBridge`;
   детект VK/OK — по user agent (не по наличию скрипта). Игрок в VK/OK получает:
   fullscreen, нативный шеринг, приветствие, deep-link, rewarded-слот.
4. **Rewarded-реклама** (монетизация VK): создать рекламное место в
   [VK Ads](https://ads.vk.com) (Apps → Placements → Rewarded) и задать
   `VITE_VK_REWARD_PLACEMENT_ID` при сборке. В паузе появится «СМОТРЕТЬ РЕКЛАМУ: +1 HP»
   (только когда реклама реально доступна, лимит 3/забег).
5. **Ограничение**: VK-скоры сейчас `unverified` (у VK нет подписанной initData в
   стиле TG/MAX; валидация `web_app_t` на сервере — TODO). До валидации VK-игроки
   не попадают в верифицированный общий топ.

## Структура

```text
src/
  main.ts               — запуск Phaser, тема, dev-ручка window.__game, SW-регистрация
  scenes/               — Boot (процедурные текстуры), Menu, Game, UI
  game/                 — Player/Enemy/Bullet/Gem, RunState, WaveDirector,
                          UpgradeSystem, EvolutionSystem, AchievementSystem,
                          RunMilestones, identity, config, SeededRng (daily), share
  systems/              — MessengerBridge (MAX+TG+VK+браузер), VkBridge (V6,
                          VK Web SDK: user/share/fullscreen/rewarded/trackEvent),
                          SafeArea, SaveSystem, Sfx, AtmosphereSystem, VfxSystem,
                          Analytics (R1, PostHog-совместимый + VKWebAppTrackEvent),
                          ServerClient (fire-and-forget клиент score-сервера)
server/
  index.mjs             — score-сервер: initData-валидация (HMAC), анти-чит,
                          топы, реферальные рёбра, push «твой ход» (Bot API)
  bot.mjs               — Telegram-бот: long polling, /start + deep-link
  test.mjs              — 16 проверок (npm run server:test)
public/
  manifest.webmanifest  — PWA (fullscreen, иконки, shortcut ?daily=1)
  sw.js                 — service worker (shell pre-cache, offline-fallback)
  icons/                — сгенерированные иконки (npm run icons)
scripts/
  smoke-daily.ts        — автотест игровой логики (npm run smoke)
  gen-icons.mjs         — PNG-генератор иконок чистым Node
docs/                   — SMOKE_TEST.md, OPEN_SOURCE_REFERENCES.md,
                          RESEARCH_AND_PLAN.md (стратегия v2),
                          GROWTH_OPERATIONS.md (C1, операционный ранбук роста)
```

Баланс (урон, волны, кривая опыта, босс, dodge, juice) — в `src/game/config.ts`.

## Цикл забега

0:00–5:00 — волны (ШУМ → ИМПУЛЬС → РАЗРЫВ), элиты/АНОМАЛИИ и milestones.
На 5:00 босс. Уничтожение босса — победа; смерть — проигрыш.
Три эволюции сборки: ПРИЗМА, ОРЕОЛ, СИНГУЛЯРНОСТЬ.

### Виральные механики (v0.2.0)

- **Ежедневное испытание**: сид = hash(дата) (FNV-1a + mulberry32) → у всех
  игроков в один день одинаковые волны и выборы улучшений; результаты
  сравнимы, в карточке результата — метка 📅.
- **Стрики**: +1 за ежедневный забег в следующий день, сброс при пропуске.
- **Локальный лидерборд**: топ-10 в `localStorage` (победа > время > киллы),
  топ-3 в меню, место в топе на game over.
- **Шаринг**: карточка (время/киллы/ядро/эволюции/рекорды/ежедневное) + deep
  link; MAX/Telegram — нативный шеринг, браузер — Web Share API → clipboard.
  При открытии по ссылке — подсказка «ты пришёл по вызову».
- **Рефералы (V1)**: кнопка «ПРИГЛАСИТЬ» на game over → личная ссылка
  `startapp=ref_<platformCode>_<uid>` (MAX/TG) или тот же token через `?ref=` (web). Приглашённый получает
  бонус на первый забег (+1 HP, кулдаун рывка −30%), рёбро фиксируется на
  сервере, referrer'у приходит push «твой ход» (V7, TG).
- **Глобальный топ (V3)**: лучший результат каждого юзера в `POST /api/score`
  (HMAC-валидация `initData` + анти-чит); топ-3 в меню (✈ TG / ✉ MAX / 🖥 web),
  периоды all/daily/weekly. Web-игроки — unverified-тень, вне общего топа.
- **Достижения и метрики**: `AchievementSystem`, комбо, раздельные рекорды
  (выживание/победа), lifetime-статы; событийная аналитика (R1) — 16 событий
  (run_completed, share_done, ref_*, reward_ad_*) в PostHog-совместимом формате
  (+ дубль в VKWebAppTrackEvent в VK).
- **VK-монетизация (V6)**: rewarded-реклама «СМОТРЕТЬ РЕКЛАМУ: +1 HP» в паузе
  (VK/OK, capability-gated, бонус только после досмотра, лимит 3/забег).

## Quality gate

```bash
npm ci
npm run build        # tsc --noEmit + vite build (GitHub Actions: .github/workflows/ci.yml)
npm run smoke        # логика daily/стриков/лидерборда (21 проверка)
npm run server:test  # score-сервер + бот: валидация initData, анти-чит, топы, рефы
```

Перед релизом — ручной прогон [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)
(iOS Safari / Android Chrome, портрет + ландшафт, 360px+, MAX/TG/браузер).

## Changelog

### v0.4.1 — MAX/Android: портрет + twin-stick (M-блок)

- **Портретная вёрстка** (мессенджеры держат мини-приложение вертикально,
  ~360×780 CSS px): меню — вертикальный flow-лейаут (блоки следуют друг за
  другом с замерами, ничего не перекрывается: рекорды, daily, кнопки,
  управление, лидерборды, how-to); модалки (level-up / game over / pause)
  получают компактные размеры на портретных экранах; all text word-wrap;
  SafeArea (notch/home-indicator) учтён в HUD и кнопках.
- **Twin-stick как опция** (современные мобильные решения: floating/dynamic
  стики под пальцем, sticky-зоны, radial dead zone + scaled ramp,
  aim-assist при свободном правом стике — как в Fortnite mobile):
  - Режим «1 палец» (дефолт, casual): плавающий стик движения + авто-прицел
    по ближайшему врагу, флик → уклонение.
  - Режим «2 пальца» (twin-stick): левая половина — стик движения (циан,
    флик → dodge), правая — стик прицела (золото): удержание за dead-zone →
    огонь по линии, отпускание → авто-прицел.
  - Переключатель в меню («🕹 1 ПАЛЕЦ · АВТО-ПРИЦЕЛ» / «🕹 2 ПАЛЬЦА ·
    ТВИН-СТИК»), персистится в SaveSystem, действует со следующего забега,
    analytics `control_mode_changed`; intro-hint объясняет зоны.
- **Модуль `Sticks`** (`src/game/Sticks.ts`) заменяет `Joystick`: два
  независимых плавающих стика с зонами, snap-back, pointercancel-safe.
- **MAX-совместимость (портирован fix c main 5c83390)**: в MAX (Android
  WebView) игра стартует на CANVAS-рендерере (WebGL-контекст MAX может быть
  невалидным — Phaser падал до BootScene); в браузере остаётся WebGL + bloom.
  Загрузка шрифта — с таймаутом 700мс (Font API MAX может не завершиться).

### v0.4.0 — content-глубина (K1/K2/K3)

- **K1 Метапрогресс «осколки ядра»**: валюта за каждый забег (киллы + уровень
  + 25 за победу), 5 персистентных треков в меню (ПУЛЬС/ОБОЛОЧКА/ДВИЖОК/ПОЛЕ/
  РЕЗОНАНС) с кривой стоимости, применение к старту забега. Retention-якорь
  между забегами и сезонами.
- **K2 Новые враги** (4 типа): сплиттер (трескается на 2–3 миньонов),
  миньон, щитона (фронтальная защита от пуль −78%), снайпер (дистанция +
  выстрелы, i-frames/рывок гасят снаряды). Ротация по времени (1.5м/3м/5м),
  элита расширяется.
- **K3 Новое оружие/эволюции**: апгрейды КОМЕТА (тяжёлый пробивной снаряд)
  и ФОКУС-ЛЕНЗА (скорость/дальность пуль); эволюции ВОРТЕКС (нова засасывает),
  ПЕРЕГРУЗКА (авто-залп по кругу), АЭГИС (контр-нова при попадании).
- **K4 Боссы**: 3 типа (КОРОНА / ОРБИТАЛЬНАЯ ФОРТЕЦА с клинками и залпами /
  РАЗДЕЛЯЮЩЕЕ ЯДРО — раскол на 2 осколка в 50% HP); seeded-выбор (daily-честно).
- **K5 Взрывные**: бомбёр (взрыв при смерти, АОЕ) и мина (неподвижная,
  детонация при сближении/по урону, авто-сгорание 25 с).
- **K6 Мета-достижения**: 11 одноразовых целей (победа/киллы/комбо/рекорды/
  эволюции/осколки) с бонусами ⬢; вкладка «ДОСТИЖЕНИЯ» в мета-шопе.
- SMOKE_TEST 3b (QA по контенту), аналитика +shards_earned/meta_bought/
  meta_achievement/boss_spawned{type}.

### v0.3.0 — рост и инфраструктура (план v2: критический путь)

- **R1 Аналитика**: `src/systems/Analytics.ts` — self-contained трекер
  (14 событий, буфер 200 в localStorage, флеш 10/30с/при уходе в фон,
  retry, PostHog `/capture`-совместимый формат, `VITE_ANALYTICS_URL`,
  без PII — только anonId и агрегаты забега).
- **R2 PWA**: manifest + service worker (offline-запуск меню, shell
  pre-cache, SWR для assets) + генератор иконок чистым Node
  (`npm run icons`). Игра — installable, shortcut «Ежедневное».
- **V3 Score-сервер**: zero-dep Node (`server/index.mjs`): валидация
  `initData` TG-схемой (HMAC(HMAC('WebAppData', token))) с MAX fallback,
  анти-чит (время/киллы/уровень), дедупликация best, топы
  all/daily/weekly, реферальные рёбра. 16 автотестов (`npm run server:test`).
- **V7 Telegram-бот**: raw Bot API long polling (`server/bot.mjs`):
  `/start` + deep-link `ref_<uid>`, реестр пользователей; push
  «твой ход» referrer'у при первом забеге приглашённого. MAX-бот — stub
  (TODO-V7 после получения токена).
- **V1 Рефералы**: личная реф-ссылка (`buildRefLink`), кнопка
  «ПРИГЛАСИТЬ» на game over, бонус приглашённого на первый забег
  (+1 HP, рывк быстрее), детект `ref_<uid>` в меню (bridge + query).
- **Клиент сервера**: `ServerClient` — fire-and-forget submitScore/getTop
  (сбой сети никогда не трогает геймплей), глобальный топ-3 в меню.
- **V6 VK Mini Apps / OK**: `VkBridge` (VK Web SDK: init/user/share/fullscreen/
  trackEvent/rewarded), детект VK/OK по UA, персонализация через `whenReady`,
  rewarded-слот «СМОТРЕТЬ РЕКЛАМУ: +1 HP» (VK Ads), публикация в VK/OK/Pochta/
  Atom/RuStore одним `dist/`. VK-скоры — unverified (TODO: web_app_t).
- **V2 Топ друзей**: `GET /api/friends` (двунаправленный реф-граф), блок
  «ДРУЗЬЯ» на game over (кто кого позвал, лучший результат).
- **C5 Сезон**: сезонный лидерборд (окно 14 дней от `SEASON_EPOCH_MS`), бейдж
  «СЕЗОН N · M дн до конца» в меню, сброс между сезонами.
- **C1 Операции роста**: `docs/GROWTH_OPERATIONS.md` — ранбук (каналы/бюджеты
  MAX+Авито+VK Ads, north star D7≥12–15%, kill-сигналы D1<22/D7<4, атрибутция
  через реф-теги, креативы, alert'ы).
- **V4 Результат дня**: `GET /api/daily` («ты №N из M сегодня»), строка
  «📅 СЕГОДНЯ: №N из M» на game over для daily-забега.
- **V5 Шаринг-видео**: `ShareVideo` (rolling-window MediaRecorder, ~12 с
  последних секунд), «ПОДЕЛИТЬСЯ» при победе шлёт клип (Web Share API с файлом),
  иначе — карточку. Feature-detection + фолбэк.

### v0.2.0 — production-ready sprint

- **Управление**: джойстик v2 (мгновенный вектор, deadzone-ramp, сглаженный
  кноб, snap-back, без залипаний на pointercancel), swipe-dodge с i-frames и
  кулдауном (мобильный) + Space/Shift (десктоп).
- **Жизненный цикл**: автопауза при уходе в фон (сцена + AudioContext),
  пауз-меню, нативный BackButton → пауза, safe-area HUD.
- **UI**: кнопки ≥44×44, minimal HUD, gesture-защита (double-tap zoom,
  контекстное меню, pull-to-refresh, tap-highlight).
- **Визуал**: плавные переходы между сценами, «скриншот-моменты»
  (победа/смерть/босс-интро), единая неоновая палитра (config COLORS).
- **Производительность**: адаптивное качество (эвристика устройства + замер FPS
  → откат bloom/vignette), переиспользование snapshot (0 аллокаций в кадре),
  кэш перерисовки UI-баров, пулы объектов.
- **Виральность**: daily challenge (сид от даты), стрики, локальный лидерборд,
  шаринг-карточка с deep link, deep-link призыв в меню.
- **Мессенджеры**: единый MessengerBridge (MAX + Telegram + браузер),
  тема оформления (theme-color), хаптика, deep-link payload.
- **Docs**: CREDITS.md, SMOKE_TEST.md, OPEN_SOURCE_REFERENCES.md, npm run smoke.

### v0.1.0

- Первый плейабл: геймплей, эволюции, достижения, MAX Bridge, CC0-аудио,
  визуальный и engagement-спринт v1.

## Дорожная карта после релиза

Сделано в v0.3.0: серверный leaderboard (V3), рефералы (V1), бот (V7),
аналитика (R1), PWA (R2), **VK Mini Apps адаптер (V6)**, **топ друзей (V2)**,
**операции роста (C1)**, **сезон (C5)**, **результат дня (V4)**,
**шаринг-видео (V5)**, **VK verified (web_app_t)**.
Сделано в v0.4.0 (content-глубина, волны 1–2): **метапрогресс (K1)**,
**новые враги (K2)**, **новое оружие/эволюции (K3)**, **боссы (K4)**,
**взрывные (K5)**, **мета-достижения (K6)**.

Дальше (см. [docs/RESEARCH_AND_PLAN.md](docs/RESEARCH_AND_PLAN.md)):

- **MAX-бот** (webhook) после получения токена бота;
- перенос JSON-store в PocketBase/SQLite при росте нагрузки;
- расширенный device/performance matrix на реальных MAX/TG-клиентах;
- дальше по контенту: ещё враги/оружие/боссы (2-я волна), мета-достижения.
