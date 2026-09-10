/**
 * Обёртка над VK Web SDK (VK Bridge) — VK Mini Apps / OK (V6).
 *
 * VK Mini Apps запускают один и тот же `dist/` в VK, Одноклассниках, Почте
 * Mail.ru, браузере Atom и RuStore. Мост — `window.vkBridge` (методы
 * `VKWebApp*`), подключается самим VK-клиентом (мобильный) или через CDN-скрипт
 * в index.html (веб). Все методы ДЕФЕНСИВНЫ: вне VK (нет bridge) — safe no-op /
 * 'unavailable', игра никогда не падает.
 *
 * ВАЖНО: у VK НЕТ подписанной строки initData в стиле TG/MAX — авторизация
 * идёт через VK ID / web_app_t (валидация на сервере, TODO-V6-server). Поэтому
 * VK-скоры сейчас считаются unverified (как browser) и не попадают в
 * верифицированный общий топ.
 *
 * Референсы: https://dev.vk.com/minapps (Web SDK), npm @vkontakte/vk-bridge.
 */
import type { MiniAppUser } from './MessengerBridge';

export type RewardOutcome = 'completed' | 'skipped' | 'unavailable' | 'error';

interface VkBridgeLike {
  send?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  subscribe?: (fn: (e: unknown) => void) => void;
  unsubscribe?: (fn: (e: unknown) => void) => void;
}

declare global {
  interface Window {
    /** VK Web SDK bridge (VK Mini Apps / OK). */
    vkBridge?: VkBridgeLike;
  }
}

function getBridge(): VkBridgeLike | null {
  return typeof window !== 'undefined' ? (window.vkBridge ?? null) : null;
}

/** Извлекать { type, data } из события subscribe (VK обёртывает в detail). */
function eventPayload(e: unknown): { type?: string; data?: Record<string, unknown> } | null {
  if (!e || typeof e !== 'object') return null;
  const anyE = e as { detail?: unknown; type?: string; data?: unknown };
  const d = (anyE.detail && typeof anyE.detail === 'object' ? anyE.detail : anyE) as {
    type?: string;
    data?: unknown;
  };
  if (!d || typeof d !== 'object') return null;
  return {
    type: d.type,
    data: (d.data && typeof d.data === 'object' ? d.data : {}) as Record<string, unknown>,
  };
}

class VkBridgeImpl {
  private userCache: MiniAppUser | null = null;
  private launch: Record<string, unknown> | null = null;
  private initDone = false;
  private readyResolve: (() => void) | null = null;
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.readyResolve = resolve;
  });

  /** Есть ли mост (не обязательно что мы внутри VK — см. UA-детект в мосте). */
  get isAvailable(): boolean {
    return !!getBridge()?.send;
  }

  /** Профиль VK-юзера (после init); null — до инициализации или вне VK. */
  get user(): MiniAppUser | null {
    return this.userCache;
  }

  /** Идентификатор VK-юзера (числовой), если уже известен; иначе null. */
  get userId(): string | null {
    const id = this.userCache?.id;
    if (id != null) return String(id);
    const lv = this.launch?.vk_user_id;
    if (typeof lv === 'number' || typeof lv === 'string') return String(lv);
    return null;
  }

  /** Resolve после VKWebAppInit + получения user/launch-параметров. */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Инициализация: VKWebAppInit, затем user + launch-параметры (параллельно).
   * Идемпотентно; вне VK резолвится сразу.
   */
  init(): Promise<void> {
    if (this.initDone) return this.readyPromise;
    this.initDone = true;
    const bridge = getBridge();
    if (!bridge?.send) {
      this.readyResolve?.();
      return this.readyPromise;
    }
    void (async () => {
      try {
        await bridge.send?.('VKWebAppInit');
      } catch {
        /* некоторые клиенты отвечают ошибкой, но bridge жив */
      }
      const [user, launch] = await Promise.all([
        this.safeSend('VKWebAppGetUserInfo'),
        this.safeSend('VKWebAppGetLaunchParams'),
      ]);
      if (user && typeof user === 'object') {
        const u = user as Record<string, unknown>;
        const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
        this.userCache = {
          id: (typeof u.id === 'number' || typeof u.id === 'string' ? u.id : undefined) as
            | number
            | string
            | undefined,
          first_name: str(u.first_name),
          last_name: str(u.last_name),
          username: str(u.screen_name),
          photo_url: str(u.photo),
        };
      }
      if (launch && typeof launch === 'object') {
        this.launch = launch as Record<string, unknown>;
      }
      this.readyResolve?.();
    })();
    return this.readyPromise;
  }

  private async safeSend(method: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      return await getBridge()?.send?.(method, params ?? {});
    } catch {
      return null;
    }
  }

  /** Start-параметр deep link (native: start_param; web — из URL). */
  getStartParam(): string | null {
    const sp = this.launch?.start_param ?? this.launch?.startParam;
    return typeof sp === 'string' && sp.length > 0 ? sp : null;
  }

  /**
   * web_app_t (web_app_init) из launch-параметров — токен для серверной
   * валидации (HMAC-SHA256 с секретом VK Mini Apps). null — до init/вне VK.
   */
  get webAppInit(): string | null {
    const w = this.launch?.web_app_init ?? this.launch?.webAppInit;
    return typeof w === 'string' && w.length > 0 ? w : null;
  }

  /** Нативное полноэкранный режим (mobile). Safe no-op. */
  requestFullscreen(): void {
    void this.safeSend('VKWebAppRequestFullscreen', {});
  }

  /**
   * Нативный шеринг. true — если мост вызван; false — вызывающий делает
   * fallback (Web Share / clipboard).
   */
  share(text: string, link?: string): Promise<boolean> {
    const bridge = getBridge();
    if (!bridge?.send) return Promise.resolve(false);
    const params: Record<string, unknown> = { p: text };
    if (link) params.link = link;
    return bridge
      .send('VKWebAppShowShareBox', params)
      .then(() => true)
      .catch(() => false);
  }

  /**
   * VK-аналитика (VKWebAppTrackEvent) — встроенный sink VK Ads. Best effort.
   * Не заменяет наш Analytics (R1), а дополняет его для VK-экосистемы.
   */
  trackEvent(eventName: string, userId?: string | null, params?: Record<string, unknown>): void {
    const bridge = getBridge();
    if (!bridge?.send) return;
    const body: Record<string, unknown> = { event_name: eventName };
    if (userId) body.custom_user_id = userId;
    if (params && Object.keys(params).length > 0) body.event_params = params;
    void bridge.send('VKWebAppTrackEvent', body).catch(() => {});
  }

  /**
   * Доступна ли rewarded-реклама. Требует placement_id (настройка оператора,
   * см. REWARDED_PLACEMENT_ID). Вне VK / без id / нет инвентаря → false.
   */
  async rewardedAvailable(placementId: string): Promise<boolean> {
    const bridge = getBridge();
    if (!bridge?.send || !placementId) return false;
    try {
      const res = (await bridge.send('VKWebAppCheckNativeAds', {
        ad_format: 'reward',
        use_waterfall: true,
      })) as { can_show?: boolean } | null;
      return !!res?.can_show;
    } catch {
      return false;
    }
  }

  /**
   * Показать rewarded-видео. Результат:
   *  - 'completed' — досмотрено (выдаём бонус);
   *  - 'skipped'   — закрыто/пропущено (без бонуса);
   *  - 'unavailable' / 'error' — без бонуса.
   * Бонус выдавать ТОЛЬКО при 'completed'.
   */
  showRewarded(placementId: string): Promise<RewardOutcome> {
    const bridge = getBridge();
    const sendFn = bridge?.send;
    if (!sendFn || !placementId) return Promise.resolve('unavailable');

    return new Promise<RewardOutcome>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const onEvent = (e: unknown): void => {
        const p = eventPayload(e);
        if (!p?.type) return;
        const t = p.type;
        const d = p.data ?? {};
        const looksAd = t === 'VKWebAppAdEvent' || /Ad/i.test(t);
        if (!looksAd) return;
        const status = String(d.type ?? d.status ?? d.event ?? '').toLowerCase();
        if (status.includes('reward') || status.includes('complete') || status.includes('finish')) {
          settle('completed');
        } else if (status.includes('skip') || status.includes('close') || status.includes('cancel')) {
          settle('skipped');
        }
      };

      const settle = (o: RewardOutcome): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          bridge.unsubscribe?.(onEvent);
        } catch {
          /* safe */
        }
        resolve(o);
      };

      try {
        bridge.subscribe?.(onEvent);
      } catch {
        /* подписка не критична — полагаемся на resolve/show */
      }

      // Страховка от висячего промиса.
      timer = setTimeout(() => settle('error'), 120_000);

      void sendFn('VKWebAppShowAdUnit', { placement_id: placementId }).then(() => {
          // ShowAdUnit разрешается после показа; если skip-событие не пришло —
          // считаем досмотренной.
          settle('completed');
        })
        .catch(() => settle('error'));
    });
  }
}

/**
 * Placement id для rewarded-рекламы VK. Заполнить после создания рекламного
 * места в кабинете VK Ads (Apps → Placements → Rewarded). Пусто — rewarded-
 * слоты просто не показываются (грациозно).
 */
export const VK_ADS = {
  rewardedPlacementId: (import.meta.env.VITE_VK_REWARD_PLACEMENT_ID as string | undefined) ?? '',
};

export const VkBridge = new VkBridgeImpl();
