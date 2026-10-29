/**
 * FeatureFlags — типизированные фича-флаги (micro-flags, ноль зависимостей).
 *
 * Зачем: смена цен, дроп-рейтов, сложности и ивентов без пересборки и ревью
 * мини-аппа (Фаза 2 роадмапа).
 *
 * ОБОСНОВАНИЕ ВЫБОРА (P6, патч №12, 2026-10-22): раньше использовался
 * `@openfeature/js-sdk`, но ТОЛЬКО с `InMemoryProvider` — удалённого провайдера
 * флагов не было никогда. init() резолвил через OpenFeature ровно те значения,
 * которые сам же вычислил чистыми функциями resolveFlags()/readUrlFlagOverrides():
 * SDK был сквозной обёрткой без поведения «удалённой оценки». Плюс пакет
 * `@openfeature/js-sdk` deprecated (перенесён в `@openfeature/server-sdk`).
 * Поэтому вместо миграции на `@openfeature/web-sdk` (новая зависимость ради
 * несуществующего remote-провайдера) — собственная типизированная реализация:
 * тот же внешний интерфейс, ноль зависимостей, ноль сюрпризов.
 *
 * Почему отдельный модуль, а не ClientFeatureFlags: тот резолвер —
 * presentation-only по архитектурному решению main (запинено тестом
 * check-muse-telemetry.mjs: «gameplay flags must not exist»). Геймплейные
 * флаги (дроп, сложность, вариант витрины) живут здесь, с тем же QA-гейтом.
 *
 * Дизайн:
 * - `FLAG_DEFAULTS` — единственный источник дефолтов (authored поведение);
 * - `resolveFlags` / `readUrlFlagOverrides` — чистые функции, тестируются
 *   в Node без браузера;
 * - синглтон `FeatureFlags` — Sfx-стиль фасад: `init()` резолвит флаги один раз
 *   при старте, `get()` — синхронное чтение для горячих путей (дефолты, пока
 *   init не завершился — игра никогда не ломается).
 *
 * `?flag.<key>=<value>` — QA-ИНСТРУМЕНТ (см. readUrlFlagOverrides ниже).
 * Оверрайды из URL применяются ТОЛЬКО в QA-сборках — dev или VITE_QA_TOOLS=1
 * (см. InitOptions.qaTools; env читает main.ts и передаёт параметром: в этом
 * модуле import.meta.env НЕЛЬЗЯ — он компилируется tsc в CJS для Node-тестов
 * и это будет SyntaxError).
 *
 * ВАЖНО для Mark: QA-сборки требуют VITE_QA_TOOLS=1. В проде без флага
 * ?flag. в URL ИГНОРИРУЕТСЯ — тестируй флаги через ?flag. только на
 * QA-сборке (или в dev). Поведение в проде сознательно не меняется ссылкой.
 * Серверная экономика клиентские `?flag.`-оверрайды ИГНОРИРУЕТ — они никогда
 * не меняют балансы, энтайтлменты и покупки на сервере.
 *
 * Что флаги НЕ делают: не меняют RNG, сейвы, score-контракты и версии
 * ruleset/campaign (жёсткое правило AGENTS.md).
 */

export type FlagKey =
  | 'events.doubleRna'
  | 'difficulty.earlyGame'
  | 'storefront.variant'
  | 'retention.quests'
  | 'economy.lab'
  | 'skins.gallery';

/**
 * Варианты витрины (storefront.variant):
 * - 'hidden' (дефолт) — витрины нет, точка входа не рисуется;
 * - 'mock' — витрина на MockPaymentProvider (dev/QA-дубль, НЕ реальный биллинг);
 * - 'max' — MaxBridgePaymentProvider (stub: unavailable → экран «скоро»);
 * - 'telegram' — TelegramStarsPaymentProvider (реальный биллинг Stars;
 *   провайдер приходит с партией Stars, до неё значение fail-closed).
 * Витрина портирована (партия 3): флаг больше не stub.
 */
export type StorefrontVariant = 'hidden' | 'mock' | 'max' | 'telegram';

export interface FlagValues {
  /** Ивент «двойная RNA»: весь дроп гемов x2. Реально влияет на игру. */
  'events.doubleRna': boolean;
  /** Масштаб сложности первых 3 минут забега (1 = authored). */
  'difficulty.earlyGame': number;
  /** Вариант витрины (см. StorefrontVariant выше). */
  'storefront.variant': string;
  /**
   * Retention-слой Фазы 3 (порт): daily-модалка в меню + meta-достижения.
   * Дефолт true — слой виден всем; выключение прячет только UI
   * (квесты main — src/quests — флагом не гейтятся).
   */
  'retention.quests': boolean;
  /**
   * Лаборатория мутаций Фазы 4 (порт): апгрейды веток, престиж, множитель
   * дохода meta-RNA. Дефолт true — слой включён; выключение отключает
   * покупки/престиж и делает grantMetaRna эквивалентным addRna
   * (модификаторы забега при этом не применяются).
   */
  'economy.lab': boolean;
  /**
   * Галерея скинов-штаммов Фазы 5 (DiceBear).
   * Дефолт true (то же обоснование, что у retention.quests/economy.lab):
   * чистая косметика, чистый клиент, без бэкенда и платежей; дефолтный скин —
   * каноничный арт, поведение игры не меняется; гасится флагом мгновенно.
   */
  'skins.gallery': boolean;
}

export const FLAG_DEFAULTS: FlagValues = {
  'events.doubleRna': false,
  'difficulty.earlyGame': 1,
  'storefront.variant': 'hidden',
  'retention.quests': true,
  'economy.lab': true,
  'skins.gallery': true,
};

/** Чистая функция: дефолты + оверрайды. Неизвестные ключи игнорируются. */
export function resolveFlags(overrides: Partial<FlagValues> = {}): FlagValues {
  return {
    'events.doubleRna': overrides['events.doubleRna'] ?? FLAG_DEFAULTS['events.doubleRna'],
    'difficulty.earlyGame': overrides['difficulty.earlyGame'] ?? FLAG_DEFAULTS['difficulty.earlyGame'],
    'storefront.variant': overrideString(overrides['storefront.variant']),
    'retention.quests': overrides['retention.quests'] ?? FLAG_DEFAULTS['retention.quests'],
    'economy.lab': overrides['economy.lab'] ?? FLAG_DEFAULTS['economy.lab'],
    'skins.gallery': overrides['skins.gallery'] ?? FLAG_DEFAULTS['skins.gallery'],
  };
}

function overrideString(v: string | undefined): string {
  return typeof v === 'string' && v.length > 0 ? v : FLAG_DEFAULTS['storefront.variant'];
}

/**
 * Чистая функция: парсит `?flag.<key>=<value>` из query-строки.
 * Неизвестные флаги и мусорные значения игнорируются.
 *
 * QA-ИНСТРУМЕНТ: сама функция чистая (тесты), а ПРИМЕНЯЕТ её только
 * FeatureFlags.init при opts.qaTools. В проде без VITE_QA_TOOLS=1
 * оверрайды игнорируются — Mark тестирует через `?flag.` только на
 * QA-сборке (VITE_QA_TOOLS=1) или в dev. Примеры:
 *   `?flag.events.doubleRna=true` — ивент двойной RNA;
 *   `?flag.storefront.variant=telegram` — витрина Stars.
 * Серверная экономика ?flag. ИГНОРИРУЕТ.
 */
export function readUrlFlagOverrides(search: string): Partial<FlagValues> {
  const out: Partial<FlagValues> = {};
  if (!search) return out;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.replace(/^\?/, ''));
  } catch {
    return out;
  }
  const rawBool = params.get('flag.events.doubleRna');
  if (rawBool === 'true' || rawBool === '1') out['events.doubleRna'] = true;
  else if (rawBool === 'false' || rawBool === '0') out['events.doubleRna'] = false;
  const rawNum = params.get('flag.difficulty.earlyGame');
  if (rawNum !== null) {
    const n = Number(rawNum);
    if (Number.isFinite(n) && n > 0 && n <= 10) out['difficulty.earlyGame'] = n;
  }
  const rawStr = params.get('flag.storefront.variant');
  if (rawStr !== null && rawStr.length > 0 && rawStr.length <= 64) {
    out['storefront.variant'] = rawStr;
  }
  const rawRetention = params.get('flag.retention.quests');
  if (rawRetention === 'true' || rawRetention === '1') out['retention.quests'] = true;
  else if (rawRetention === 'false' || rawRetention === '0') out['retention.quests'] = false;
  const rawLab = params.get('flag.economy.lab');
  if (rawLab === 'true' || rawLab === '1') out['economy.lab'] = true;
  else if (rawLab === 'false' || rawLab === '0') out['economy.lab'] = false;
  const rawGallery = params.get('flag.skins.gallery');
  if (rawGallery === 'true' || rawGallery === '1') out['skins.gallery'] = true;
  else if (rawGallery === 'false' || rawGallery === '0') out['skins.gallery'] = false;
  return out;
}

/**
 * Опции FeatureFlags.init.
 */
export interface InitOptions {
  /**
   * QA-инструменты включены (dev или сборка с VITE_QA_TOOLS=1).
   * ?flag.-оверрайды из URL применяются ТОЛЬКО при qaTools === true.
   * Без флага URL игнорируется (fail-closed): пользователь не должен менять
   * поведение игры ссылкой.
   *
   * ВАЖНО для Mark: QA-сборки требуют VITE_QA_TOOLS=1 — тестируй флаги
   * через ?flag. только на QA-сборке (или в dev).
   */
  qaTools?: boolean;
}

class FeatureFlagsImpl {
  private values: FlagValues = { ...FLAG_DEFAULTS };
  private initialized = false;

  /** Синхронное чтение для горячих путей. До init() — дефолты. */
  get<K extends FlagKey>(key: K): FlagValues[K] {
    return this.values[key];
  }

  /** Синхронный оверрайд (тесты, QA-консоль). */
  setOverride<K extends FlagKey>(key: K, value: FlagValues[K]): void {
    const next: FlagValues = { ...this.values };
    next[key] = value;
    this.values = next;
  }

  /** Сброс к дефолтам (тесты). */
  reset(): void {
    this.values = { ...FLAG_DEFAULTS };
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Резолвит флаги один раз при старте: дефолты < явные оверрайды <
   * ?flag.-оверрайды (последние — только при opts.qaTools, см. InitOptions).
   * Никогда не бросает: при любой ошибке остаются дефолты, игра не ломается.
   * Асинхронная сигнатура — для совместимости с ранним init-хуком (main.ts).
   */
  async init(overrides: Partial<FlagValues> = {}, opts: InitOptions = {}): Promise<void> {
    try {
      // ?flag. — QA-инструмент. В проде без VITE_QA_TOOLS=1 URL-оверрайды
      // игнорируются. import.meta.env здесь НЕЛЬЗЯ (модуль компилируется
      // tsc в CJS для Node-тестов) — env читает main.ts/сцена и передаёт
      // qaTools параметром.
      const urlOverrides =
        opts.qaTools === true && typeof location !== 'undefined'
          ? readUrlFlagOverrides(location.search)
          : {};
      this.values = resolveFlags({ ...overrides, ...urlOverrides });
      this.initialized = true;
    } catch {
      this.values = { ...FLAG_DEFAULTS };
      this.initialized = false;
    }
  }
}

export const FeatureFlags = new FeatureFlagsImpl();
