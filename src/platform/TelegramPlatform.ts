import { buildTelegramStartLink, resolveTelegramBotName } from './TelegramLinks';
import {
  type HapticStyle,
  type NotifyType,
  type PlatformAdapter,
  type PlatformUser,
  platformDisplayName,
} from './PlatformBridge';

/** Shared identity for a detach function that has nothing to detach. */
const NOOP_DETACH = () => {};

interface TelegramSafeAreaInsets {
  top?: unknown;
  right?: unknown;
  bottom?: unknown;
  left?: unknown;
}

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
  safeAreaInset?: TelegramSafeAreaInsets;
  contentSafeAreaInset?: TelegramSafeAreaInsets;
  isVersionAtLeast?: (version: string) => boolean;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle) => void;
    notificationOccurred?: (type: NotifyType) => void;
  };
  ready?: () => void;
  expand?: () => void;
  shareMessage?: (messageId: string, callback?: (success: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
  /**
   * Telegram WebApp 7.7+. Locks the host page so a vertical drag cannot scroll the Mini App
   * viewport away from the game instead of reaching the on-screen controls.
   */
  disableVerticalSwipes?: () => void;
  /**
   * Telegram WebApp 7.7+. False once the vertical swipe lock is in effect. Telegram clients
   * older than 7.7 accept the call and ignore it, so the flag is the only way to tell an
   * applied lock from an ignored one.
   */
  isVerticalSwipesEnabled?: boolean;
  /**
   * Modern event bus used by Telegram WebApp 7.7+.
   */
  onEvent?: (type: string, callback: (event?: { isStateStable?: boolean }) => void) => void;
  offEvent?: (type: string, callback: (event?: { isStateStable?: boolean }) => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export class TelegramPlatform implements PlatformAdapter {
  readonly kind = 'telegram' as const;
  private backHandler: (() => void) | null = null;
  private detachActivated: (() => void) | null = null;
  private warnedAboutSwipeLock = false;

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
    this.lockVerticalSwipes();
    this.watchVisibility();
  }

  get available(): boolean {
    return !!this.wa?.initData;
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

  isVersionAtLeast(required: string): boolean {
    try {
      if (typeof this.wa?.isVersionAtLeast === 'function') {
        return this.wa.isVersionAtLeast(required) === true;
      }
    } catch {
      // Fall through to the stable version-string comparison.
    }
    const compare = (value: string): number[] | null => {
      if (!/^\d+(?:\.\d+)*$/.test(value.trim())) return null;
      return value.trim().split('.').map(Number);
    };
    const current = compare(this.version);
    const minimum = compare(required);
    if (!current || !minimum) return false;
    for (let i = 0; i < Math.max(current.length, minimum.length); i++) {
      const a = current[i] ?? 0;
      const b = minimum[i] ?? 0;
      if (a !== b) return a > b;
    }
    return true;
  }

  getSafeAreaInsets(): { top: number; right: number; bottom: number; left: number } | null {
    if (!this.isVersionAtLeast('8.0')) return null;
    const normalize = (value: TelegramSafeAreaInsets | undefined) => {
      if (!value) return null;
      const sides = [value.top, value.right, value.bottom, value.left];
      if (!sides.every((side) => typeof side === 'number' && Number.isFinite(side) && side >= 0)) return null;
      return { top: value.top as number, right: value.right as number, bottom: value.bottom as number, left: value.left as number };
    };
    const safe = normalize(this.wa?.safeAreaInset);
    const content = normalize(this.wa?.contentSafeAreaInset);
    if (!safe && !content) return null;
    return {
      top: Math.max(safe?.top ?? 0, content?.top ?? 0),
      right: Math.max(safe?.right ?? 0, content?.right ?? 0),
      bottom: Math.max(safe?.bottom ?? 0, content?.bottom ?? 0),
      left: Math.max(safe?.left ?? 0, content?.left ?? 0),
    };
  }

  buildStartLink(payload: string): string | null {
    return buildTelegramStartLink(
      payload,
      resolveTelegramBotName({
        VITE_TG_BOT_USERNAME: import.meta.env.VITE_TG_BOT_USERNAME,
        VITE_TELEGRAM_BOT_NAME: import.meta.env.VITE_TELEGRAM_BOT_NAME,
      }),
      String(import.meta.env.VITE_TELEGRAM_APP_SHORT_NAME ?? '')
    );
  }

  async getViewportSize(): Promise<{ width: number; height: number } | null> {
    if (typeof window === 'undefined') return null;
    const width = window.innerWidth;
    const height = this.wa?.viewportHeight ?? window.innerHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
  }

  /**
   * Locks vertical swipes so a drag cannot scroll the Mini App viewport away from the game.
   *
   * Telegram resets this lock every time the Mini App page is shown, so the lock is re-applied
   * on every show signal instead of only at construction time. The lock is also verified:
   * `isVerticalSwipesEnabled` stays true on clients older than Bot API 7.7, which accept the
   * call and ignore it, so a silent no-op is reported instead of being indistinguishable from
   * a working lock.
   */
  private lockVerticalSwipes(): void {
    const wa = this.wa;
    if (!wa) return;
    try {
      wa.disableVerticalSwipes?.();
      if (wa.isVerticalSwipesEnabled !== false && !this.warnedAboutSwipeLock) {
        this.warnedAboutSwipeLock = true;
        console.warn(
          '[OFELIYA telegram] vertical swipe lock was not applied by this Telegram client'
        );
      }
    } catch {
      // Safe no-op: Telegram clients older than 7.7 do not expose the method.
    }
  }

  /**
   * Telegram reports the Mini App becoming visible again through its own `activated` event.
   * The DOM visibility signal is kept as well, because a generic browser host has no Telegram
   * event bus and the same rule has to hold outside Telegram.
   */
  private watchVisibility(): void {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.detachActivated = this.onHostEvent('activated', () => this.lockVerticalSwipes());
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') this.lockVerticalSwipes();
  };

  /**
   * Subscribes to a Telegram host event and returns the detach function. Telegram keeps an
   * array of handlers per event type, so detaching the exact callback removes only this
   * listener and leaves every other subscriber untouched.
   */
  private onHostEvent(
    type: string,
    callback: (event?: { isStateStable?: boolean }) => void
  ): () => void {
    const wa = this.wa;
    if (!wa || typeof wa.onEvent !== 'function') return NOOP_DETACH;
    try {
      wa.onEvent(type, callback);
    } catch {
      return NOOP_DETACH;
    }
    return () => {
      try {
        wa.offEvent?.(type, callback);
      } catch {
        // Safe no-op.
      }
    };
  }

  /**
   * Subscribes to the Telegram viewport invalidation signal.
   *
   * The Telegram Mini App viewport is virtual: the host resizes the game frame when the
   * keyboard opens, the Mini App is expanded or the device rotates, and that change does not
   * necessarily produce a window resize event. The Telegram event is the only reliable signal
   * that the frame has to be re-measured.
   *
   * Telegram reports the resize state in the event payload. While the user is still dragging
   * the Mini App open or closed the event repeats with `isStateStable: false` and the height
   * is a moving target, so those intermediate events are ignored and the frame is re-measured
   * once, from the stable height Telegram reports when the resize is finished.
   */
  subscribeViewportChange(listener: () => void): () => void {
    const handler = (event?: { isStateStable?: boolean }): void => {
      if (event && event.isStateStable === false) return;
      try {
        listener();
      } catch {
        // Safe no-op: a failing listener must not break the Telegram event bus.
      }
    };

    let attached = false;
    const detach = this.onHostEvent('viewportChanged', handler);
    // A client without the Telegram event bus cannot report viewport changes.
    attached = detach !== NOOP_DETACH;
    if (!attached) return () => {};
    const detachSafe = this.isVersionAtLeast('8.0')
      ? [
        this.onHostEvent('safeAreaChanged', () => handler()),
        this.onHostEvent('contentSafeAreaChanged', () => handler()),
      ]
      : [];
    let done = false;
    return () => {
      if (done) return;
      done = true;
      detach();
      for (const off of detachSafe) off();
    };
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

  private shareViaTelegramLink(text: string, link?: string): boolean {
    const openTelegramLink = this.wa?.openTelegramLink;
    if (!openTelegramLink || !link) return false;
    try {
      const shareUrl = new URL('https://t.me/share/url');
      shareUrl.searchParams.set('url', link);
      shareUrl.searchParams.set('text', text);
      openTelegramLink(shareUrl.toString());
      return true;
    } catch {
      return false;
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

    if (this.shareViaTelegramLink(text, link)) return true;

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
