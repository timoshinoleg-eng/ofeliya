# OFELIYA: STRAIN ZERO

Мобильный roguelite-survivor для **MAX Mini Apps**. Игрок управляет синтетическим вирусом
`STRAIN-0` внутри живого организма: двигается одним пальцем, автоматически атакует иммунные
клетки, собирает фрагменты РНК, заражает клетки хозяина и выбирает мутации. На 5:00 появляется
финальный иммунный ответ `IMMUNE PRIME`; победа засчитывается после его уничтожения.

Продуктовый контракт и визуальная терминология: [`STRAIN_ZERO_PRODUCT_BIBLE.md`](./STRAIN_ZERO_PRODUCT_BIBLE.md).

## Стек

- **Phaser 3 + TypeScript + Vite** — gameplay и UI.
- **MAX Bridge** через platform-neutral слой `src/platform/*` — launch context, viewport, BackButton,
  haptics и share/deeplink surface.
- **Telegram adapter** уже изолирован архитектурно, но его отдельный release QA идёт после MAX RC.
- Основной визуал генерируется кодом: вирус, иммунные клетки, кровоток, host cells, мутации и VFX.
- Аудио лежит отдельно в `public/audio/`: SFX Kenney CC0 и CC0 Music с OpenGameArt.
- Chakra Petch — self-hosted OFL font с системным fallback.

## Локальный запуск

```bash
npm install
npm run dev
npm run test:challenge
npm run build
npm run preview
```

Управление: tap/drag — floating one-thumb joystick; на desktop также работают WASD/стрелки.
Атака автоматическая.

## MAX Mini App

1. `npm run build` создаёт `dist/`.
2. Разместите `dist/` на HTTPS-хостинге.
3. Привяжите URL мини-приложения к MAX-боту.
4. Для challenge deeplink задайте публичное имя этого бота при сборке:

```bash
VITE_MAX_BOT_NAME=your_max_bot_name
```

Пример есть в `.env.example`. Значение указывается без `@`. Реальное имя бота не хранится в
репозитории и должно быть задано в deployment environment; его корректность проверяется в
`VIR-16` внутри настоящего MAX-клиента.

Challenge deeplink соответствует MAX contract:

```text
https://max.ru/<botName>?startapp=<payload>
```

`payload` versioned, укладывается в лимит 512 символов и использует только допустимые MAX
символы `A-Z a-z 0-9 _ -`. Входящий payload читается через `start_param` и используется только
как **недоверенный социальный контекст**: показать цель и сравнить локальный результат.
Он не меняет баланс, награды и не считается доказательством результата.

## Challenge flow

После забега кнопка **«БРОСИТЬ ВЫЗОВ»** создаёт compact payload с типом цели и run-метриками:

- победный забег → получатель должен уничтожить `IMMUNE PRIME` быстрее;
- проигранный забег → получатель должен продержаться дольше.

При запуске по challenge deeplink меню показывает **«ВЫЗОВ ПОЛУЧЕН»** и цель. После забега result
screen показывает, превзойдён вызов или нет. Browser adapter поддерживает тот же round-trip через
`?startapp=...` для локального QA.

## Безопасность MAX initData

`window.WebApp.initDataUnsafe` используется только как удобный клиентский контекст для имени,
viewport/start payload и подобных UI-задач. Он **не является доверенной авторизацией**.

Для будущих leaderboard, персональных данных и competitive score сервер должен получать подписанную
строку `window.WebApp.initData`, проверять её на доверенном backend и отдельно валидировать score
contract. Challenge payload не заменяет эту проверку.

## Основной игровой цикл

- первые секунды: ближайшие антитела, первая РНК и ранняя мутация;
- по ходу цикла подключаются T-клетки, макрофаги и NK response;
- neutral host cells можно заражать proximity-механикой;
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

## Performance

Есть два presentation tier: `full` и `reduced`. На слабых устройствах отключаются/сокращаются
postFX и декоративные эффекты, но **enemy density и gameplay не меняются**. Object pools и bounded
VFX сохраняются.

## Quality gate

Canonical GitHub Actions выполняет:

```bash
npm ci
npm run test:challenge
npm run build
```

`test:challenge` без дополнительного test framework проверяет encode/decode, MAX-safe charset/length,
reject malformed payload и семантику «быстрее clear / дольше survival».

Перед публичным MAX-релизом отдельно требуется real-client QA: launch/initData, viewport/safe areas,
BackButton, haptics/share, audio unlock, restart/menu lifecycle и dense late-run combat performance.
