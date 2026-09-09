import {
  type HapticStyle,
  type NotifyType,
  type PlatformAdapter,
  type PlatformUser,
  platformDisplayName,
} from './PlatformBridge';

const START_PAYLOAD_RE = /^[A-Za-z0-9_-]{1,512}$/;
const BOT_NAME_RE = /^[A-Za-z0-9_-]{1,128}$/;

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

type MaxShareParams = { text?: string; link?: string };

interface MaxWebAppGlobal {
  initData?: string;
  initDataUnsafe?: MaxInitDataUnsafe;
  platform?: string;
  version?: string;
  getViewportSize?: () => Promise<{ height: string; width: string }>;
  shareContent?: (data: MaxShareParams) => Promise<unknown>;
  shareMaxContent?: (data: MaxShareParams) => Promise<unknown>;
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

  buildStartLink(payload: string): string | null {
    if (!START_PAYLOAD_RE.test(payload)) return null;
    const configured = String(import.meta.env.VITE_MAX_BOT_NAME ?? '').trim().replace(/^@/, '');
    if (!BOT_NAME_RE.test(configured)) return null;
    return `https://max.ru/${configured}?startapp=${payload}`;
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

  shareResult(text: string, link?: string): Promise<boolean> {
    // Prefer the in-MAX share sheet for challenge loops. shareContent remains the mobile fallback.
    const share = this.wa?.shareMaxContent ?? this.wa?.shareContent;
    if (!share) return Promise.resolve(false);
    const params: MaxShareParams = link ? { text, link } : { text };
    try {
      return share
        .call(this.wa, params)
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
