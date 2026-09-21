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

const TELEGRAM_BOT_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const TELEGRAM_APP_SHORT_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

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
  shareMessage?: (messageId: string, callback?: (success: boolean) => void) => void;
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

  buildStartLink(payload: string): string | null {
    const bot = String(import.meta.env.VITE_TELEGRAM_BOT_NAME ?? '').trim().replace(/^@/, '');
    if (!TELEGRAM_BOT_NAME_RE.test(bot)) return null;

    const encoded = encodeURIComponent(payload);
    const shortName = String(import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME ?? '').trim();
    if (shortName && TELEGRAM_APP_SHORT_NAME_RE.test(shortName)) {
      return `https://t.me/${bot}/${shortName}?startapp=${encoded}`;
    }
    // Main Mini Apps do not require a short name: t.me/<bot>?startapp=<payload>.
    return `https://t.me/${bot}?startapp=${encoded}`;
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

  private async prepareNativeShare(text: string, link?: string): Promise<string | null> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined' || !this.initData) return null;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 3500);
    try {
      const endpoint = new URL('api/telegram/share', window.location.href).toString();
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: this.initData, text, link }),
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { ok?: boolean; messageId?: unknown };
      return body.ok === true && typeof body.messageId === 'string' && body.messageId
        ? body.messageId
        : null;
    } catch {
      return null;
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  async shareResult(text: string, link?: string): Promise<boolean> {
    const shareMessage = this.wa?.shareMessage;
    if (shareMessage) {
      const messageId = await this.prepareNativeShare(text, link);
      if (messageId) {
        try {
          return await new Promise<boolean>((resolve) => {
            let settled = false;
            const finish = (value: boolean) => {
              if (settled) return;
              settled = true;
              resolve(value);
            };
            const timer = globalThis.setTimeout(() => finish(false), 60_000);
            shareMessage(messageId, (success) => {
              globalThis.clearTimeout(timer);
              finish(success === true);
            });
          });
        } catch {
          // Fall through to the browser share sheet when Telegram native sharing fails.
        }
      }
    }

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
