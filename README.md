# OFELIYA: STRAIN ZERO

Мобильный roguelite-survivor для **MAX Mini Apps**. Игрок управляет синтетическим вирусом
`STRAIN-0` внутри живого организма: двигается одним пальцем, автоматически атакует иммунные
клетки, собирает фрагменты РНК, заражает клетки хозяина и выбирает мутации. На 5:00 появляется
финальный иммунный ответ `IMMUNE PRIME`; победа засчитывается после его уничтожения.

Продуктовый контракт и визуальная терминология: [`STRAIN_ZERO_PRODUCT_BIBLE.md`](./STRAIN_ZERO_PRODUCT_BIBLE.md).
Release-gate evidence: [`RELEASE_VALIDATION.md`](./RELEASE_VALIDATION.md).
Third-party provenance: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

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
npm run test:viewport
npm run build
npm run preview
```

Управление: tap/drag — floating one-thumb joystick; на desktop также работают WASD/стрелки.
Атака автоматическая.

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

- победный забег → получатель должен уничтожить `IMMUNE PRIME` быстрее;
- проигранный забег → получатель должен продержаться дольше.

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

Если позже появятся leaderboard, аккаунтные данные или competitive score, сервер должен получать
подписанную строку `window.WebApp.initData`, валидировать её на доверенном backend и отдельно
проверять score contract. Challenge payload эту проверку не заменяет.

## Основной игровой цикл

- первые секунды: ближайшие антитела, первая РНК и ранняя мутация;
- далее подключаются T-клетки, макрофаги и NK response;
- host cells заражаются proximity-механикой;
- полный infection вызывает **lysis**: разрыв мембраны, RNA release и radial damage;
- доступны три critical mutations: `ГИПЕРШИП`, `СВЕРХКАПСИД`, `ЛИЗИС`;
- на 5:00 появляется `IMMUNE PRIME`.

Boss/difficulty rebalance намеренно вынесен за пределы текущего redesign PR.

## Локальное сохранение

В `localStorage` сохраняются:

- лучшее время выживания среди проигранных циклов;
- fastest successful clear;
- лучшие kills/уровень;
- число забегов и lifetime kills;
- достижения;
- история critical mutations;
- mute state.

Схема сохраняет совместимость со старым `ofeliya_save_v1`.

## Performance и audio lifecycle

Есть два presentation tier: `full` и `reduced`. `PerformanceProfile` — единый источник решения о
postFX/декоративной плотности. Reduced tier уменьшает только presentation cost и не меняет enemy
density или gameplay.

SFX/music грузятся лениво. Асинхронная загрузка music защищена AbortController/generation guard,
а transient WebAudio source/gain/oscillator nodes disconnect после `ended`, чтобы длинные циклы и
повторные рестарты не накапливали audio graph.

## Canonical quality gate

PR CI выполняет два независимых job.

Build gate:

```bash
npm ci
npm run test:challenge
npm run test:viewport
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
- отсутствие page runtime errors.

Browser smoke сохраняет текущие menu/result PNG как Actions artifact для визуальной приёмки.

## Что ещё обязательно перед публичным релизом

Автоматический MAX mock не заменяет реальный клиент. `VIR-16` должен пройти на настоящем MAX
Android/iOS RC с реальными deployment values:

- launch + `initData` / `start_param`;
- viewport/safe-area/orientation/background-resume;
- native BackButton;
- haptics/share/deeplink round-trip;
- audio unlock;
- 10 restart/menu cycles;
- cold-start до playable;
- dense late-run combat/FPS и финальная фаза `IMMUNE PRIME`.

До закрытия `VIR-16` PR #16 остаётся draft.
