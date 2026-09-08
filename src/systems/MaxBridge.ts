// Типизированная обёртка над MAX Bridge (window.WebApp).
// Официальная документация: https://dev.max.ru/docs/webapps/bridge
// Bridge подключается CDN-скриптом в index.html и не требует инициализации.
// В обычном браузере window.WebApp отсутствует — все методы безопасно деградируют в no-op.

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotifyType = 'error' | 'success' | 'warning';

export interface MaxBridgeUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface MaxInitDataUnsafe {
  query_id?: string;
  ip?: string;
  auth_date?: number;
  hash?: string;
  user?: MaxBridgeUser;
  chat?: { id?: number; type?: 'DIALOG' | 'CHAT' | 'CHANNEL' };
  start_param?: string;
  // Old/alternate clients may expose these here; prefer top-level WebApp fields.
  platform?: string;
  version?: string;
}

interface MaxBackButton {
  isVisible?: boolean;
  show?: () => unknown;
  hide?: () => unknown;
  onClick?: (callback: () => void) => unknown;
  offClick?: (callback: () => void) => unknown;
}

interface MaxWebAppGlobal {
  /** Signed URL-encoded initialization string. Validate only on a trusted server. */
  initData?: string;
  /** Parsed convenience object. Must never be treated as trusted authentication. */
  initDataUnsafe?: MaxInitDataUnsafe;
  platform?: string;
  version?: string;
  deviceName?: string;
  getViewportSize?: () => Promise<{ height: string; width: string }>;
  shareContent?: (data: { text?: string; link?: string }) => Promise<unknown>;
  BackButton?: MaxBackButton;
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle, options?: unknown) => unknown;
    notificationOccurred?: (type: NotifyType, options?: unknown) => unknown;
  };
}

declare global {
  interface Window {
    WebApp?: MaxWebAppGlobal;
  }
}

class MaxBridgeImpl {
  private backHandler: (() => void) | null = null;

  private get wa(): MaxWebAppGlobal | undefined {
    return typeof window !== 'undefined' ? window.WebApp : undefined;
  }

  /** Запущено ли внутри мессенджера MAX. */
  get available(): boolean {
    return !!this.wa;
  }

  get platform(): string {
    return this.wa?.platform ?? this.wa?.initDataUnsafe?.platform ?? 'browser';
  }

  get version(): string {
    return this.wa?.version ?? this.wa?.initDataUnsafe?.version ?? '';
  }

  /**
   * Signed initialization string. Send it to a trusted backend for verification;
   * do not validate identity by trusting initDataUnsafe on the client.
   */
  get initData(): string {
    return this.wa?.initData ?? '';
  }

  getUser(): MaxBridgeUser | null {
    return this.wa?.initDataUnsafe?.user ?? null;
  }

  getDisplayName(): string | null {
    const user = this.getUser();
    if (!user) return null;
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (full) return full;
    return user.username?.trim() || null;
  }

  async getViewportSize(): Promise<{ width: number; height: number } | null> {
    const fn = this.wa?.getViewportSize;
    if (!fn) return null;
    try {
      const raw = await fn.call(this.wa);
      const width = Number.parseFloat(raw.width);
      const height = Number.parseFloat(raw.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
      return { width, height };
    } catch {
      return null;
    }
  }

  /**
   * MAX native Back button lifecycle. Passing null removes our previous handler and hides it.
   */
  setBackHandler(callback: (() => void) | null): void {
    const back = this.wa?.BackButton;
    if (this.backHandler) {
      try {
        back?.offClick?.(this.backHandler);
      } catch {
        /* client capability mismatch — safe no-op */
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
      /* outside/smaller MAX clients — safe no-op */
    }
  }

  /** Поделиться текстом (нативный шеринг, iOS/Android). true — если мост вызван. */
  shareResult(text: string): Promise<boolean> {
    const share = this.wa?.shareContent;
    if (!share) return Promise.resolve(false);
    try {
      return share
        .call(this.wa, { text })
        .then(() => true)
        .catch(() => false);
    } catch {
      return Promise.resolve(false);
    }
  }

  haptic(style: HapticStyle = 'light'): void {
    try {
      this.wa?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      /* вне MAX — тихо игнорируем */
    }
  }

  notify(type: NotifyType): void {
    try {
      this.wa?.HapticFeedback?.notificationOccurred?.(type);
    } catch {
      /* вне MAX — тихо игнорируем */
    }
  }
}

export const MaxBridge = new MaxBridgeImpl();
