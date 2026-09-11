import {
  type HapticStyle,
  type NotifyType,
  type PlatformAdapter,
  type PlatformUser,
  platformDisplayName,
} from './PlatformBridge';

interface TelegramBackButton {
  show?: () => void;
  hide?: () => void;
  onClick?: (callback: () => void) => void;
  offClick?: (callback: () => void) => void;
}

interface TelegramWebApp {
  initData?: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: PlatformUser;
  };
  platform?: string;
  version?: string;
  viewportHeight?: number;
  viewportStableHeight?: number;
  BackButton?: TelegramBackButton;
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle) => void;
    notificationOccurred?: (type: NotifyType) => void;
  };
  ready?: () => void;
  expand?: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export class TelegramPlatform implements PlatformAdapter {
  readonly kind = 'telegram' as const;
  private backHandler: (() => void) | null = null;

  private get wa(): TelegramWebApp | undefined {
    return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  }

  constructor() {
    try {
      this.wa?.ready?.();
      this.wa?.expand?.();
    } catch {
      // Telegram WebApp can be partially available in previews.
    }
  }

  get available(): boolean {
    return !!this.wa;
  }

  get platform(): string {
    return this.wa?.platform ?? 'telegram';
  }

  get version(): string {
    return this.wa?.version ?? '';
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

  buildStartLink(_payload: string): string | null {
    // Telegram Mini App link format needs both the bot and Mini App short name. VIR-17 owns that
    // configuration; keeping this null avoids inventing a broken cross-platform link in MAX v1.
    return null;
  }

  async getViewportSize(): Promise<{ width: number; height: number } | null> {
    if (typeof window === 'undefined') return null;
    const width = window.innerWidth;
    const height = this.wa?.viewportHeight ?? window.innerHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  setBackHandler(callback: (() => void) | null): void {
    const back = this.wa?.BackButton;
    if (this.backHandler) {
      try {
        back?.offClick?.(this.backHandler);
      } catch {
        // Safe no-op.
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
      // Safe no-op.
    }
  }

  async shareResult(text: string, link?: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.share) return false;
    try {
      await navigator.share(link ? { text, url: link } : { text });
      return true;
    } catch {
      return false;
    }
  }

  haptic(style: HapticStyle = 'light'): void {
    try {
      this.wa?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      // Safe no-op.
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
