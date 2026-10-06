# OFELIYA: STRAIN ZERO

<!-- product-snapshot:start -->
> **Продукт:** мобильный roguelite-survivor для MAX Mini Apps с Telegram-compatible архитектурой, серверной валидацией и асинхронными социально-соревновательными механиками.
>
> **Стадия:** active / production hardening · **Основная платформа:** MAX · **Архитектура:** Telegram-compatible · **Фокус:** gameplay clarity, retention, horizontal mastery, social loops и дальнейшая монетизация.
<!-- product-snapshot:end -->

Мобильный portrait roguelite-survivor для **MAX Mini Apps**. Канонический MAX-бот — `@id402806822924_5_bot`, production URL — `https://ofeliya.freeveol.dpdns.org/ofeliya/`. Игрок управляет синтетическим вирусом
`STRAIN-0` внутри живого организма, собирает RNA, мутирует, заражает host cells и проходит
двухактную кампанию: `КРОВОТОК -> IMMUNE PRIME -> СЕРДЦЕ -> CARDIAC TITAN`.

По умолчанию играется одной рукой через существующий floating joystick. Дополнительно доступен
двухручный twin-stick профиль: слева движение, справа — направление приоритетной автоатаки.
Стрельба в обоих режимах остаётся автоматической.

Продуктовый контракт и визуальная терминология: [`STRAIN_ZERO_PRODUCT_BIBLE.md`](./STRAIN_ZERO_PRODUCT_BIBLE.md).
Текущий execution plan: [`PLAN.md`](./PLAN.md).
Текущая архитектура: [`ARCHITECTURE_NOTES.md`](./ARCHITECTURE_NOTES.md).
Release-gate evidence: [`RELEASE_VALIDATION.md`](./RELEASE_VALIDATION.md).
Third-party provenance: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
Canonical production identity: [`PROJECT_IDENTITY.md`](./PROJECT_IDENTITY.md).
Legacy Chatbot24 migration/retirement map: [`docs/CHATBOT24_MIGRATION.md`](./docs/CHATBOT24_MIGRATION.md).

## Стек

- **Phaser 3 + TypeScript + Vite** — gameplay и UI.
- **MAX Bridge** через platform-neutral слой `src/platform/*` — launch context, viewport,
  BackButton, haptics и share/deeplink surface.
- **Telegram adapter** изолирован архитектурно, но отдельный Telegram release QA идёт после MAX RC.
- Основной визуал генерируется кодом: вирус, иммунные клетки, кровоток, host cells, мутации и VFX.
- Аудио лежит отдельно в `public/audio/`: SFX Kenney CC0 и CC0 Music с OpenGameArt.
- Chakra Petch — self-hosted OFL font с системным fallback.

## Локальный запуск

```bash
npm install
npm run dev
npm run test:challenge
npm run test:save
npm run test:stages
npm run test:legendary
npm run test:difficulty
npm run test:pacing
npm run test:viewport
npm run test:startup
npm run build
npm run preview
```

Управление:
- **ОДНА РУКА** — исходный floating joystick без изменения поведения;
- **ДВЕ РУКИ · TWIN-STICK** — слева движение, справа broad aim-priority sector;
- отпускание правого stick возвращает обычный auto-targeting;
- в обоих профилях атака автоматическая;
- на desktop также работают WASD/стрелки.

Выбор control mode сохраняется отдельно и не влияет на progression save.

## Аналитика понимания и наблюдаемые сессии

Offline-отчёт читает локальную копию server store; получение production-копии выполняется
отдельно оператором. Команда ничего не отправляет на сервер:

```bash
npm run analytics:funnel -- /path/to/store.json
npm run test:comprehension-context
npm run test:analytics-funnel
npm run test:analytics-delivery
```

Новые one-shot события понимания содержат `analyticsRunId`, `runTimeMs`, `firstRun` и `release`.
Идентификатор относится к одной попытке, не к seed; игровой RNG и ranked-контракт не меняются.
Порядок событий определяется игровым временем, а серверный `ts` обозначает время приёма.
Старые и частичные записи без идентификатора/времени остаются некоррелируемыми.

Знаменатель включает все наблюдаемые `run_start`, даже без последующих событий. Для всех
попыток считается цепочка до первого лизиса; завершение второй клетки без подсказки оценивается
только среди однозначно определённых первых забегов. Отсутствие события не доказывает
непонимание: доставка best effort, а экспорт может быть неполным. One-shot interruption/resume
не измеряют количество действий и не доказывают возобновление той же клетки.

Протокол 5–8 реальных новичков: [docs/playtests/comprehension-2026-10-06.md](./docs/playtests/comprehension-2026-10-06.md).
Подписанный локальный интеграционный тест и браузерный smoke не заменяют реальные телефоны,
проверку обслуживаемого SHA и наблюдение за игроками.

## MAX viewport и safe area

Приложение не полагается только на `window.innerWidth/innerHeight`. `ViewportManager` запрашивает
`window.WebApp.getViewportSize()` через `PlatformBridge`, применяет host-reported viewport к Phaser
и дополнительно учитывает CSS `safe-area-inset-*`. Синхронизация повторяется при resize,
orientation change и возврате приложения из background.

Platform facade выбирает MAX adapter во время вызова, а не один раз при module import. Поэтому
медленная загрузка MAX CDN не может навсегда перевести Mini App в browser fallback.

## Production build для MAX

Обычный `npm run build` предназначен для разработки/CI. Публикационный RC собирается только через:

```bash
npm run build:max
```

`build:max` сначала запускает release-config gate и прекращает сборку, если отсутствуют или остались
placeholder-значениями обязательные параметры:

```text
VITE_MAX_BOT_NAME
VITE_DEVELOPER_LEGAL_NAME
VITE_DEVELOPER_REGISTRATION
VITE_DEVELOPER_ADDRESS
VITE_SUPPORT_EMAIL
VITE_RELEASE_SHA (полный 40-символьный Git SHA)
```

Дополнительно поддерживаются:

```text
VITE_DEVELOPER_BRAND
VITE_SUPPORT_PHONE
```

Шаблон находится в `.env.example`. Реальные юридические данные должны совпадать с подтверждённым
профилем разработчика MAX; репозиторий намеренно не угадывает их.

В главном меню доступна ссылка **«О приложении · Политика · Поддержка»**. Она показывает сведения
о разработчике, privacy notice, условия использования и контакты поддержки из release environment.

## Challenge flow

После забега **«БРОСИТЬ ВЫЗОВ»** создаёт compact versioned payload:

- новый победный забег (`sz2`) → получатель должен завершить всю кампанию быстрее;
- проигранный забег → получатель должен продержаться дольше;
- старые ссылки `sz1_c_*` сохраняют исходный смысл: уничтожить `IMMUNE PRIME` быстрее.

MAX deeplink:

```text
https://max.ru/<botName>?startapp=<payload>
```

Payload использует только `A-Z a-z 0-9 _ -`, укладывается в 512 символов и читается через
`start_param`. В меню получатель видит **«ВЫЗОВ ПОЛУЧЕН»**, а после цикла — verdict
**«ВЫЗОВ ПРЕВЗОЙДЁН / НЕ ПРЕВЗОЙДЁН»**.

Challenge data — только **недоверенный социальный контекст**. Он не меняет gameplay, не выдаёт
награды и не является доказательством результата.

## Безопасность MAX initData

`window.WebApp.initDataUnsafe` используется только для клиентского UI-контекста — имени,
`start_param` и capability data. Он **не является доверенной авторизацией**.

Competitive score уже идёт через доверенный backend: клиент передаёт подписанную строку
`window.WebApp.initData`, сервер валидирует MAX identity и отдельно проверяет versioned score
contract (`rulesetVersion`, `campaignVersion`, `difficultyId`, completion stage и run seed).
Ranked contract относится к Standard; Strained mastery остаётся локальной/неранговой историей.

Challenge payload остаётся только недоверенным социальным контекстом и не заменяет серверную
валидацию результата.

Score storage ограничено 20 000 строками. Последние 2 000 мест зарезервированы для verified
identity: browser/unverified VK получают `503` уже при 18 000 строках, verified-записи — при
20 000. Существующие строки не удаляются. Повтор принятого `submissionId` остаётся идемпотентным
даже при заполнении. `/health` возвращает `503` и `ok=false`, когда свободных мест для verified
score writes больше нет; существующие Docker/deploy-проверки HTTP status видят это как unhealthy.
`scoreCapacity` содержит `limit`, `remaining`, `trustedReserve`, `unverifiedRemaining`, `ready` без
пользовательских данных. Заполнение только unverified-доступной части не делает health unhealthy.

## Основной игровой цикл

- первые секунды: ближайшие антитела, первая RNA и ранняя mutation;
- `АНТИТЕЛО` перехватывает траекторию, `T-КИЛЛЕР` телеграфирует рывок, `МАКРОФАГ` — тяжёлый burst;
- host cells заражаются proximity-механикой;
- full infection вызывает **lysis**: RNA release + radial damage;
- infection/lysis теперь входит в buildcraft через `РЕЦЕПТОРНЫЙ ЗАХВАТ`, `ЦИТОЛИЗ`, `ВИРУСНАЯ ФАБРИКА`;
- доступны critical mutations: `ГИПЕРШИП`, `СВЕРХКАПСИД`, `ЛИЗИС`;
- Legendary — максимум **2 за run**; второй слот защищён для гарантированной trophy после `IMMUNE PRIME`;
- на 5:00 появляется `IMMUNE PRIME`: telegraphed pressure-wave, затем усиленная phase 2;
- после победы начинается `СЕРДЦЕ`; heartbeat telegraph создаёт safe pocket для positional timing;
- успешная Heart synchronization кратко снимает pressure и открывает projectile/lysis opportunity;
- в финале появляется `CARDIAC TITAN`, который получает дополнительную vulnerability в synchronized window;
- перед run выбирается `STANDARD` или `STRAINED`; STRAINED усиливает pressure, elites, bosses и spawn cadence.

Cinematic presentation использует лёгкие runtime-generated key-art frames для перехода в Heart,
обоих boss reveal и победы; video payload не добавляется.

## Локальное сохранение

В `localStorage` сохраняются:

- лучшее время выживания среди проигранных циклов;
- fastest `IMMUNE PRIME` clear (включая legacy one-stage saves);
- fastest full-campaign clear;
- лучшие kills/уровень;
- число забегов и lifetime kills;
- достижения;
- история critical mutations;
- mute state.

Схема сохраняет ключ `ofeliya_save_v1`: старый `bestWinTimeMs` мигрирует только в
`bestBoss1ClearMs` и не считается результатом полной кампании. Полный clear хранится отдельно в
`bestCampaignClearMs`.

Difficulty и control mode используют отдельные storage keys, чтобы не ломать backward compatibility
основного progression save.

## Профили игрока (V1, сервер)

Появился минимальный серверный профиль/инвентарь — только для мессенджеров (MAX и Telegram),
до косметики/meta/billing. Это первый персистентный профиль игрока на сервере.

Контракт аддитивный (`profileVersion: 1`), в публичных ответах нет raw `uid`/`userKey`/`initData`,
имён и аватаров. Намеренно нет ни общей записи профиля, ни grant-endpoint.

- `POST /api/profile` — тело `{ platform, initData }` (только `max`/`telegram`).
  `200` + `{ ok, profile }`; `403` без валидной подписи или для browser/vk; `422` на некорректное тело.
  Чтение стабильное/идемпотентное; при первом чтении лениво создаётся пустой профиль.
- `POST /api/profile/migrate` — тело `{ platform, initData, save }`. Одноразовый advisory-claim:
  первый валидный claim → `claimed:true`, повторные → `claimed:false` с уже сохранённым профилем;
  `422` на явно испорченный или слишком большой `save`. Локальные рекорды клампятся и остаются
  **advisory**: они никогда не становятся ranked/verified скорами и не дают платной ценности.

Инвентарь: `inventory.items[itemId].source ∈ { grant, migration, promo }`; каталог item id —
статический серверный allowlist, клиент не может изобрести id. Источник `purchase` **осознанно
отсутствует**: биллинг (Telegram/MAX Stars, чеки, возвраты, реконсиляция) в этот этап не входит и
потребует отдельного транзакционного стора.

Хранение и откат: профили лежат в **отдельном `DATA_DIR/profiles.json`**, а не ключом в `store.json`.
Старые сборки перезаписывают `store.json` только из известных ключей и при откате молча стёрли бы
новый ключ `profiles`; отдельный файл старые сборки игнорируют, поэтому данные переживают откат
нетронутыми. Запись профиля синхронная (tmp + rename) прямо в пути запроса: `200` означает
«уже сохранено на диске». Ограничения V1: **одна реплика, один writer** (общий Docker volume) и
запись полной перезаписью файла; при росте объёма или любого платного значения нужен транзакционный
стор. Удаление — операторский или будущий подписанный путь; тихого каскадного удаления score/referral
истории нет.

## Performance и audio lifecycle

Есть два presentation tier: `full` и `reduced`. Reduced tier уменьшает только presentation cost и
не меняет enemy density или gameplay. Visual clarity pass ослабляет чрезмерный Bloom/baked glow,
но сохраняет antialiasing биологических силуэтов.

Dense visual acceptance теперь отдельно снимает **100 / 150 / 200 active enemies** и одновременно
проверяет player anchor, elite marker/corona, RNA, projectile, healthy host cell и partially infected
host cell.

SFX/music грузятся лениво. Асинхронная загрузка music защищена AbortController/generation guard,
а transient WebAudio source/gain/oscillator nodes disconnect после `ended`, чтобы длинные циклы и
повторные рестарты не накапливали audio graph.

## Canonical quality gate

Ниже — **документированный quick check list** для локальной работы перед PR. Это сокращённый
набор, а не весь гейт: он не содержит всех контрактов, которые прогоняет CI.

Авторитетный полный гейт — сам CI workflow: `.github/workflows/ci.yml` (`build`, `browser-smoke`,
`production-contract`) плюс `.github/workflows/release-visual-matrix.yml` для dense visual matrix.
Если список ниже расходится с `ci.yml`, источник истины — `ci.yml`. Зелёный прогон короткого
списка не является release-валидацией.

PR CI выполняет три независимых job.

Build gate:

```bash
npm ci
npm run test:challenge
npm run test:save
npm run test:stages
npm run test:legendary
npm run test:difficulty
npm run test:viewport
npm run test:profile
npm run test:startup
npm run release:check   # CI fixture с непустыми non-placeholder release values
npm run build
```

Browser gate запускает system Chrome с MAX Android mock и проверяет:

- host + Phaser используют viewport, возвращённый MAX bridge;
- MAX user context и входящий `start_param`;
- challenge menu/CTA;
- legal/privacy/support overlay с release config;
- challenge result verdict и mobile bounds;
- реальный интерактивный share control;
- сформированный `https://max.ru/<bot>?startapp=...` передаётся в MAX share adapter;
- Legendary runtime;
- STRAINED runtime;
- one-hand compatibility + реальный two-touch twin-stick multitouch;
- High-DPI WebGL и Canvas fallback;
- Bloodstream -> Heart campaign transition;
- dense readability captures при 100 / 150 / 200 active enemies;
- отсутствие page runtime errors.

Dense capture одновременно держит player anchor, elite marker/corona, RNA, projectile, healthy
host cell и partially infected host cell. Browser smoke сохраняет PNG как Actions artifact для
визуальной приёмки.

## Что ещё обязательно перед публичным релизом

**Зелёный CI не означает, что релиз принят на реальных MAX/iOS/Telegram клиентах.**
Автоматические гейты работают против mocked MAX bridge в desktop-браузере: они не воспроизводят
нативное поведение клиента, реальный подписанный `initData`, реальные haptics/audio unlock,
реальные restart-циклы, реальные deployment values и реальные network/thermal условия. Telegram
release QA — отдельный более поздний трек, не покрытый ни одним CI job здесь.

Автоматический MAX mock не заменяет реальный клиент. `VIR-16` должен пройти на настоящем MAX
Android/iOS RC с реальными deployment values:

- launch + `initData` / `start_param`;
- viewport/safe-area/orientation/background-resume;
- native BackButton;
- haptics/share/deeplink round-trip;
- audio unlock;
- 10 restart/menu cycles;
- cold-start до playable;
- one-hand и twin-stick ergonomics;
- Heart safe-pocket timing;
- обе boss phase fights;
- dense late-run combat/FPS/thermal behavior.

### Machine-checkable часть приёмки

Часть матрицы (launch / first-run / full-run / resume / restart / share / daily-invite / viewport)
пишется одним JSON-документом и проверяется скриптом репозитория:

```bash
npm run test:mobile-evidence -- /path/to/mobile-acceptance.json
```

Путь передаётся аргументом. Без аргумента скрипт берёт `artifacts/mobile-acceptance.json`;
этот путь добавлен в `.gitignore`, поэтому для неприватных evidence указывайте путь явно.

Каждый элемент `checks[]` обязан содержать `id`, `status: "pass"`, `device`, `clientVersion`,
`testedAt` (любое значение даты/времени, которое принимает `Date.parse`; ISO 8601 рекомендуется для
читаемости, но не является требованием) и `evidence` (ссылка на video/screenshot/log).
Валидатор требует **16** обязательных id — по 8 на Android и iOS:

```text
android-launch            android-first-run     android-full-run      android-background-resume
android-restart           android-share         android-daily-invite  android-viewport
ios-launch                ios-first-run         ios-full-run          ios-background-resume
ios-restart               ios-share             ios-daily-invite      ios-viewport
```

Валидатор проверяет эти 16 обязательных id и пять полей. Дополнительные строки в `checks[]`
разрешены и просто не проверяются, поэтому `pass` их не подтверждает. Остальные требования матрицы остаются
ручными: native BackButton, haptics, audio unlock, повторные menu/run/restart циклы, pacing обеих
boss phase fights, Heart safe-pocket timing с one-hand управлением, twin-stick ergonomics без
movement/aim cross-talk, реальные developer/legal/support значения и trusted score с настоящим
подписанным `initData`.

Зелёный `test:mobile-evidence` доказывает корректность формы записей, а не поведения, и не
заменяет real-device acceptance в настоящем MAX client. Храните JSON и записи к нему вне
репозитория, во внешнем хранилище release-evidence; в репозитории фиксируйте только путь или URL.
Подробности — в [`RELEASE_VALIDATION.md`](./RELEASE_VALIDATION.md), раздел 8.
