# Деплой payments-воркера OFELIYA (Telegram Stars)

Reference backend для `TelegramStarsPaymentProvider` (клиент: `src/game/shop/`).
Всё ниже делает **Mark руками** — агент ничего не деплоит и не хранит секреты.

## 1. Бот в BotFather

1. `@BotFather` → `/newbot` → получи **токен** (никому не показывай).
2. Привяжи Mini App: `/mybots` → выбери бота → **Bot Settings** →
   **Configure Mini App** → **Enable Mini App** → укажи URL, где хостится игра.
   (Либо кнопка меню: **Menu Button** → **Configure menu button** → URL игры.)

## 2. Воркер

```bash
cd worker
npm install          # ставит wrangler + typescript (devDependencies)
cp wrangler.toml.example wrangler.toml   # поправь name при желании

# Секреты (в репозиторий НЕ коммитить):
npx wrangler secret put TELEGRAM_BOT_TOKEN   # токен из шага 1
npx wrangler secret put WEBHOOK_SECRET       # придумай строку, напр. openssl rand -hex 32

# KV для серверных entitlements (пост-ревью, патч №11; опционально —
# без него воркер работает как раньше, а /api/entitlements отвечает 501):
npx wrangler kv:namespace create PAYMENTS
# → подставь выданный id в wrangler.toml в блок [[kv_namespaces]] (см. wrangler.toml.example)

npx wrangler deploy
# → получишь https://ofeliya-payments.<твой-аккаунт>.workers.dev
```

Проверка: `curl https://<worker>/api/health` → `{"ok":true,...}`.

## 3. Webhook бота

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://<worker>/api/webhook" \
  -d "secret_token=<WEBHOOK_SECRET>"
```

Воркер сверяет заголовок `X-Telegram-Bot-Api-Secret-Token` с `WEBHOOK_SECRET`.
Без `WEBHOOK_SECRET` в env воркер отвечает **401 fail-closed** (патч №12):
молчаливого отключения проверки больше нет — секрет обязателен.

## 4. Клиент игры

```bash
# .env (локально) или env CI:
VITE_PAYMENTS_API_URL=https://<worker>
```

Витрина: `?flag.storefront.variant=telegram` (флаг Фазы 2, без пересборки).
Провайдер сам проверит: Telegram WebApp + initData + бэкенд — иначе «скоро».

## 5. Сквозной тест

1. Открой Mini App внутри Telegram (не в браузере — там нет `window.Telegram`).
2. Открой витрину → выбери товар → «Купить».
3. Оплати Stars (для теста BotFather умеет тестовые платежи, либо купи Stars).
4. Ожидаемо: нативный инвойс → `paid` → верификация по nonce
   (`POST /api/verify`) → анимация выдачи (твины сцены),
   событие `purchase_completed` (trackProductEvent), выдача через
   `PaymentLedger.fulfillPurchase` (скины/РНК/бустер, идемпотентно по chargeId).
   Если сервер не подтвердил оплату сразу: баннер «Ожидание подтверждения»,
   допроверка при открытии витрины и кнопкой «Проверить оплату».

## 6. Что НЕ делает этот воркер (осознанно)

- **Серверная выдача entitlements в игровой инвентарь**: заблокирована
  серверным контрактом `scripts/check-profile-client.mjs:162`
  (`'purchase' must never be accepted`). Клиентская выдача уже есть
  (сцена витрины → PaymentLedger.fulfillPurchase → SkinOwnership/MetaWallet).
  Снятие запрета — отдельное решение Mark.
- **Возвраты**: `refundStarPayment` — позже, по мере необходимости.
- **Подписки**: Bot API 8.0 умеет Stars-подписки — отдельный скоуп.

## 7. Каталог цен

Цены живут в **двух** местах и должны совпадать:
- клиент: `src/game/shop/products.ts` (`stars`);
- сервер: `worker/src/index.ts` (`SERVER_PRODUCTS`).

Сервер — источник истины: цену от клиента воркер игнорирует всегда.
При смене цен обнови оба файла (и задеплой воркер заново).

## 8. Протокол v2 (патч №12)

Клиент генерирует nonce (`makePaymentNonce`) и шлёт его в `/api/invoice`;
воркер кладёт заказ `order:{nonce}` в KV (TTL 3600) и ставит nonce
в `payload` инвойса (сырой nonce, лимит Telegram 1–128 байт).
Вебхук резолвит заказ по nonce, сверяет пользователя/сумму/валюту
и пишет `pay:{charge_id}` + `nonce:{nonce}` + `user:{id}:journal`.
Клиент после колбэка `paid` зовёт `/api/verify {initData, nonce}`:
`{verified:true, chargeId}` → выдача, иначе — `pending` без выдачи
(допроверка в `restore()` + кнопка «Проверить оплату»).
`/api/entitlements` возвращает журнал `{purchases:[{chargeId, productId,
status, createdAt}]}` — старый формат `{products:[...]}` (патч №11)
заменён, миграции не требуется (KV ещё не в проде).
Без KV-биндинга `/api/verify` и `/api/entitlements` отвечают
`501 {error:'kv_unavailable'}`, а вебхук только логируется.
Статус `credited` в типах зарезервирован под ручные возвраты/начисления.

## 9. Интеграция с существующим webhook сервера

Не путать с игровым сервером: `server/index.mjs` уже имеет свой
Telegram webhook (`POST /api/telegram/webhook`, секрет проверяется
отдельно, обрабатывает private start). Воркер оплат — независимый
сервис со своим секретом (`WEBHOOK_SECRET`) и своим URL
(`https://<worker>/api/webhook`); общий обработчик им не нужен.
При `setWebhook` для платёжного бота указывай именно URL воркера.
