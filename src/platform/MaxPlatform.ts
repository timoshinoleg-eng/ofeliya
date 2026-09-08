import {
  type HapticStyle,
  type NotifyType,
  type PlatformAdapter,
  type PlatformUser,
  platformDisplayName,
} from './PlatformBridge';

interface MaxInitDataUnsafe {
  query_id?: string;
  ip?: string;
  auth_date?: number;
  hash?: string;
  user?: PlatformUser;
  chat?: { id?: number; type?: 'DIALOG' | 'CHAT' | 'CHANNEL' };
  start_param?: string;
  platform?: string;
  version?: string;
}

interface MaxBackButton {
  show?: () => unknown;
  hide?: () => unknown;
  onClick?: (callback: () => void) => unknown;
  offClick?: (callback: () => void) => unknown;
}

interface MaxWebAppGlobal {
  initData?: string;
  initDataUnsafe?: MaxInitDataUnsafe;
  platform?: string;
  version?: string;
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

export class MaxPlatform implements PlatformAdapter {
  readonly kind = 'max' as const;
  private backHandler: (() => void) | null = null;

  private get wa(): MaxWebAppGlobal | undefined {
    return typeof window !== 'undefined' ? window.WebApp : undefined;
  }

  get available(): boolean {
    return !!this.wa;
  }

  get platform(): string {
    return this.wa?.platform ?? this.wa?.initDataUnsafe?.platform ?? 'max';
  }

  get version(): string {
    return this.wa?.version ?? this.wa?.initDataUnsafe?.version ?? '';
  }

  get initData(): string {
    return this.wa?.initData ?? '';
  }

  getUser(): PlatformUser | null {
    return this.wa?.initDataUnsafe?.user ?? null;
  }

  getDisplayName(): string | null {
    return platformDisplayName(this.getUser());
  }

  getStartParam(): string | null {
    return this.wa?.initDataUnsafe?.start_param ?? null;
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

  setBackHandler(callback: (() => void) | null): void {
    const back = this.wa?.BackButton;
    if (this.backHandler) {
      try {
        back?.offClick?.(this.backHandler);
      } catch {
        // Capability mismatch: safe no-op.
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
      // Older/smaller clients may expose a partial bridge.
    }
  }

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
      // Desktop/web MAX can omit haptics.
    }
  }

  notify(type: NotifyType): void {
    try {
      this.wa?.HapticFeedback?.notificationOccurred?.(type);
    } catch {
      // Safe no-op.
    }
  }
}
