import type {
  HapticStyle,
  NotifyType,
  PlatformAdapter,
  PlatformKind,
  PlatformUser,
} from './PlatformBridge';
import { BrowserPlatform } from './BrowserPlatform';
import { MaxPlatform } from './MaxPlatform';
import { TELEGRAM_BRIDGE_READY_EVENT } from './TelegramBridgeLoader';
import { TelegramPlatform } from './TelegramPlatform';

/**
 * The MAX CDN script is loaded independently from the application bundle. A one-shot adapter
 * selection at module-evaluation time can mis-detect MAX as a generic browser on a slow network.
 * This facade resolves the active adapter at call time and caches only concrete adapters.
 */
class PlatformFacade implements PlatformAdapter {
  private readonly browser = new BrowserPlatform();
  private readonly max = new MaxPlatform();
  private telegram: TelegramPlatform | null = null;
  private activeAdapter: PlatformAdapter | null = null;
  private desiredBackHandler: (() => void) | null = null;
  private readonly viewportListeners = new Set<() => void>();
  private detachViewportListener: (() => void) | null = null;

  constructor() {
    // The Telegram SDK is fetched at runtime and can land after the first host resolution.
    // Without this signal a slow load would keep the generic browser behaviour and the whole
    // Telegram host contract would never be applied.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener(TELEGRAM_BRIDGE_READY_EVENT, this.onTelegramBridgeReady);
    }
  }

  private onTelegramBridgeReady = (): void => {
    this.resolveAdapter();
  };

  private resolveAdapter(): PlatformAdapter {
    let next: PlatformAdapter = this.browser;
    if (this.max.available) {
      next = this.max;
    } else if (typeof window !== 'undefined' && window.Telegram?.WebApp?.initData) {
      if (!this.telegram) this.telegram = new TelegramPlatform();
      next = this.telegram;
    }

    if (next !== this.activeAdapter) {
      this.activeAdapter?.setBackHandler(null);
      this.activeAdapter = next;
      if (this.desiredBackHandler) next.setBackHandler(this.desiredBackHandler);
      this.bindViewportListener();
    }
    return next;
  }

  /**
   * Binds one multicast signal to the active adapter. The active adapter can change
   * at runtime — a slow MAX bridge can appear after the Telegram Mini App — so the listener is
   * re-bound instead of being pinned to the adapter that happened to be active at subscribe time.
   */
  private bindViewportListener(): void {
    this.detachViewportListener?.();
    this.detachViewportListener = null;
    const adapter = this.activeAdapter;
    if (!adapter || this.viewportListeners.size === 0) return;
    this.detachViewportListener = adapter.subscribeViewportChange?.(this.onViewportChange) ?? null;
  }

  private onViewportChange = (): void => {
    for (const listener of [...this.viewportListeners]) {
      if (!this.viewportListeners.has(listener)) continue;
      try { listener(); } catch { /* One subscriber cannot break the host event bus. */ }
    }
  };

  private get adapter(): PlatformAdapter {
    return this.resolveAdapter();
  }

  get kind(): PlatformKind { return this.adapter.kind; }
  get available(): boolean { return this.adapter.available; }
  get platform(): string { return this.adapter.platform; }
  get version(): string { return this.adapter.version; }
  get initData(): string { return this.adapter.initData; }

  getUser(): PlatformUser | null { return this.adapter.getUser(); }
  getDisplayName(): string | null { return this.adapter.getDisplayName(); }
  getStartParam(): string | null { return this.adapter.getStartParam(); }
  buildStartLink(payload: string): string | null { return this.adapter.buildStartLink(payload); }
  getViewportSize(): Promise<{ width: number; height: number } | null> {
    return this.adapter.getViewportSize();
  }
  getSafeAreaInsets() {
    return this.adapter.getSafeAreaInsets?.() ?? null;
  }
  setBackHandler(callback: (() => void) | null): void {
    this.desiredBackHandler = callback;
    this.adapter.setBackHandler(callback);
  }
  subscribeViewportChange(listener: () => void): () => void {
    // Each registration owns its detach, even when the caller reuses a callback.
    const subscription = () => listener();
    this.viewportListeners.add(subscription);
    const previousAdapter = this.activeAdapter;
    this.resolveAdapter();
    if (previousAdapter === this.activeAdapter && this.viewportListeners.size === 1) {
      this.bindViewportListener();
    }
    return () => {
      if (!this.viewportListeners.delete(subscription) || this.viewportListeners.size > 0) return;
      this.detachViewportListener?.();
      this.detachViewportListener = null;
    };
  }
  shareResult(text: string, link?: string): Promise<boolean> {
    return this.adapter.shareResult(text, link);
  }
  haptic(style: HapticStyle = 'light'): void { this.adapter.haptic(style); }
  notify(type: NotifyType): void { this.adapter.notify(type); }
}

export const PlatformBridge: PlatformAdapter = new PlatformFacade();

export type {
  HapticStyle,
  NotifyType,
  PlatformAdapter,
  PlatformKind,
  PlatformUser,
  PlatformSafeAreaInsets,
} from './PlatformBridge';
