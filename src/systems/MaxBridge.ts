// Типизированная обёртка над MAX Bridge (window.WebApp).
// Официальная документация: https://dev.max.ru/docs/webapps/bridge
// Bridge подключается CDN-скриптом в index.html и не требует инициализации.
// В обычном браузере window.WebApp отсутствует — все методы безопасно деградируют в no-op.

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotifyType = 'error' | 'success' | 'warning';

export interface MaxBridgeUser {
  id?: number;
  name?: string;
  username?: string;
  photo_url?: string;
}

interface MaxWebAppGlobal {
  initDataUnsafe?: {
    user?: MaxBridgeUser;
    platform?: string;
    version?: string;
    start_param?: string;
  };
  platform?: string;
  version?: string;
  shareContent?: (data: { text?: string; link?: string }) => Promise<unknown>;
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
  private get wa(): MaxWebAppGlobal | undefined {
    return typeof window !== 'undefined' ? window.WebApp : undefined;
  }

  /** Запущено ли внутри мессенджера MAX. */
  get available(): boolean {
    return !!this.wa;
  }

  get platform(): string {
    return this.wa?.initDataUnsafe?.platform ?? this.wa?.platform ?? 'browser';
  }

  getUser(): MaxBridgeUser | null {
    return this.wa?.initDataUnsafe?.user ?? null;
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
