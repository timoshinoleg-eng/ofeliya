/**
 * Единый мини-апп мост: MAX (window.WebApp) → Telegram (window.Telegram.WebApp)
 * → VK (window.vkBridge, VK Mini Apps / OK) → браузер (no-op). Игра и UI знают
 * только этот интерфейс — конкретика мессенджера (какие поля в initData, как
 * называется share-метод) не просачивается.
 *
 * MAX Bridge: https://dev.max.ru/docs/webapps/bridge (CDN-скрипт в index.html).
 * Telegram Mini Apps: https://core.telegram.org/bots/webapps.
 * VK Mini Apps: https://dev.vk.com/minapps (Web SDK `vkBridge`, VKWebApp*).
 *
 * ВАЖНО: `initData` — подписанная строка (MAX/TG). Доверенной авторизацией она
 * становится ТОЛЬКО после серверной валидации (HMAC с бот-токеном).
 * `initDataUnsafe`/`user` — удобный клиентский контекст, не доверять как
 * подтверждение личности. У VK подписанной initData нет (VK ID / web_app_t) —
 * см. VkBridge.
 */
import { VkBridge } from './VkBridge';

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotifyType = 'error' | 'success' | 'warning';

export interface MiniAppUser {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface BackButtonLike {
  show?: () => unknown;
  hide?: () => unknown;
  onClick?: (cb: () => void) => unknown;
  offClick?: (cb: () => void) => unknown;
}

interface HapticLike {
  impactOccurred?: (style: HapticStyle, options?: unknown) => unknown;
  notificationOccurred?: (type: NotifyType, options?: unknown) => unknown;
}

interface MiniAppApi {
  /** Signed init string (MAX: initData, Telegram: initData). */
  initData?: string;
  platform?: string;
  version?: string;
  themeParams?: Record<string, string>;
  BackButton?: BackButtonLike;
  HapticFeedback?: HapticLike;
  // --- MAX-specific ---
  initDataUnsafe?: {
    user?: MiniAppUser;
    chat?: { id?: number; type?: string };
    start_param?: string;
    platform?: string;
    version?: string;
  };
  getViewportSize?: () => Promise<{ height: string; width: string }>;
  shareContent?: (data: { text?: string; link?: string }) => Promise<unknown>;
  // --- Telegram-specific ---
  user?: MiniAppUser;
  shareMessage?: (text: string) => Promise<unknown>;
  viewportStableWidth?: number;
  viewportStableHeight?: number;
}

declare global {
  interface Window {
    /** MAX bridge. */
    WebApp?: MiniAppApi;
    /** Telegram Mini Apps SDK (подключается самим Telegram-клиентом или tg-web-app.js). */
    Telegram?: { WebApp?: MiniAppApi };
  }
}

export type MessengerKind = 'max' | 'telegram' | 'vk' | 'browser';

export interface MessengerTheme {
  dark: boolean;
  /** Системный bg мессенджера (если известен) — для адаптации не-игровых экранов. */
  bg?: string;
}

class MessengerBridgeImpl {
  private backHandler: (() => void) | null = null;

  private get maxApi(): MiniAppApi | null {
    return typeof window !== 'undefined' ? (window.WebApp ?? null) : null;
  }

  private get tgApi(): MiniAppApi | null {
    return typeof window !== 'undefined' ? (window.Telegram?.WebApp ?? null) : null;
  }

  /** MAX проверяется первым: в MAX-клиенте Telegram SDK не грузится, в TG — WebApp не создаётся. */
  get kind(): MessengerKind {
    if (this.maxApi) return 'max';
    if (this.tgApi) return 'telegram';
    if (this.isVkClient) return 'vk';
    return 'browser';
  }

  /**
   * VK/OK-клиент: детект по user agent (VKBOT/VKAndroid/VKiOS/OK). НЕ по
   * наличию window.vkBridge — CDN-скрипт есть и в обычном браузере, а это
   * дало бы ложный «vk» вне VK.
   */
  private get isVkClient(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /VKBOT|VKAndroid|VKiOS|VK Mac|VK Win|Odnoklassniki|okios|okandroid/i.test(
      navigator.userAgent ?? ''
    );
  }

  private get api(): MiniAppApi | null {
    return this.maxApi ?? this.tgApi;
  }

  /** Запущено ли внутри мессенджера (MAX, Telegram или VK/OK). */
  get available(): boolean {
    return this.kind !== 'browser';
  }

  /**
   * Начать инициализацию (VK: VKWebAppInit + user/launch). Идемпотентно.
   * Вызывается из main.ts в boot.
   */
  init(): void {
    if (this.kind === 'vk') void VkBridge.init();
  }

  /**
   * Обещание «мост готов»: MAX/TG/браузер — сразу (синхронный контекст),
   * VK — после получения user и launch-параметров. Сцены жмут через него
   * персонализацию (приветствие, deep-link), чтобы не рендерить вхолостую.
   */
  whenReady(): Promise<void> {
    if (this.kind === 'vk') {
      void VkBridge.init();
      return VkBridge.ready;
    }
    return Promise.resolve();
  }

  get platform(): string {
    if (this.kind === 'vk') return 'vk';
    const a = this.api;
    return a?.platform ?? a?.initDataUnsafe?.platform ?? this.kind;
  }

  get version(): string {
    const a = this.api;
    return a?.version ?? a?.initDataUnsafe?.version ?? '';
  }

  /**
   * Signed initialization string (MAX `initData` / Telegram `initData`).
   * Отправлять на доверенный backend и валидировать там; на клиенте
   * никогда не верить initDataUnsafe как авторизации.
   */
  get initData(): string {
    return this.api?.initData ?? '';
  }

  getUser(): MiniAppUser | null {
    if (this.kind === 'vk') return VkBridge.user; // асинхронный кэш (после init)
    const a = this.api;
    if (!a) return null;
    if (this.kind === 'max') return a.initDataUnsafe?.user ?? null;
    return a.user ?? null;
  }

  getDisplayName(): string | null {
    const user = this.getUser();
    if (!user) return null;
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (full) return full;
    return user.username?.trim() || null;
  }

  /**
   * Payload из deep link (startapp=...). Замыкает виральный цикл: игрок открыл
   * игру из чата по ссылке — показываем приглашение в меню.
   */
  getStartParam(): string | null {
    if (this.kind === 'vk') return VkBridge.getStartParam(); // launch-параметры
    const a = this.api;
    if (!a) return null;
    if (this.kind === 'max') return a.initDataUnsafe?.start_param || null;
    return null;
  }

  async getViewportSize(): Promise<{ width: number; height: number } | null> {
    const a = this.api;
    if (a?.getViewportSize) {
      try {
        const raw = await a.getViewportSize.call(a);
        const width = Number.parseFloat(raw.width);
        const height = Number.parseFloat(raw.height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          return { width, height };
        }
      } catch {
        /* fallthrough */
      }
    }
    if (this.kind === 'telegram' && a) {
      const width = a.viewportStableWidth ?? window.innerWidth;
      const height = a.viewportStableHeight ?? window.innerHeight;
      if (width > 0 && height > 0) return { width, height };
    }
    if (typeof window !== 'undefined' && window.innerWidth > 0) {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return null;
  }

  /** Нативная кнопка «назад». null — снять наш обработчик и скрыть кнопку. */
  setBackHandler(callback: (() => void) | null): void {
    const back = this.api?.BackButton;
    if (this.backHandler) {
      try {
        back?.offClick?.(this.backHandler);
      } catch {
        /* capability mismatch — safe no-op */
      }
    }
    this.backHandler = callback;
    try {
      if (!back) return;
      if (callback) {
        back.onClick?.(callback);
        back.show?.();
      } else {
        back.hide?.();
      }
    } catch {
      /* браузер/старый клиент — safe no-op */
    }
  }

  /**
   * Нативный шеринг. true — если мост вызван (результат UI зависит от платформы:
   * в браузере false → вызывающий делает Web Share API / clipboard fallback).
   */
  shareResult(text: string, link?: string): Promise<boolean> {
    if (this.kind === 'vk') return VkBridge.share(text, link);
    const a = this.api;
    if (!a) return Promise.resolve(false);
    try {
      if (this.kind === 'max' && a.shareContent) {
        return a.shareContent
          .call(a, { text, ...(link ? { link } : {}) })
          .then(() => true)
          .catch(() => false);
      }
      if (this.kind === 'telegram' && a.shareMessage) {
        return a
          .shareMessage.call(a, link ? `${text}\n${link}` : text)
          .then(() => true)
          .catch(() => false);
      }
    } catch {
      /* fallthrough */
    }
    return Promise.resolve(false);
  }

  haptic(style: HapticStyle = 'light'): void {
    try {
      this.api?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      /* вне мессенджера — тихо игнорируем */
    }
  }

  notify(type: NotifyType): void {
    try {
      this.api?.HapticFeedback?.notificationOccurred?.(type);
    } catch {
      /* вне мессенджера — тихо игнорируем */
    }
  }

  /**
   * Тема мессенджера. TG отдаёт themeParams (цветы); MAX/браузер — системная схема.
   * Игра рисует тёмный неон всегда, тема нужна для meta theme-color и адаптации
   * будущих не-игровых экранов.
   */
  getTheme(): MessengerTheme {
    const a = this.api;
    if (this.kind === 'telegram' && a?.themeParams?.bg_color) {
      return { dark: isDarkColor(a.themeParams.bg_color), bg: a.themeParams.bg_color };
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return { dark: !window.matchMedia('(prefers-color-scheme: light)').matches };
    }
    return { dark: true };
  }
}

function isDarkColor(css: string): boolean {
  const m = css.match(/^#([0-9a-f]{6})$/i);
  if (!m) return true;
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // восприятие яркости (ITU-R BT.709)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

export const MessengerBridge = new MessengerBridgeImpl();
