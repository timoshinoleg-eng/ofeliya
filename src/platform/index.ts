import type {
  HapticStyle,
  NotifyType,
  PlatformAdapter,
  PlatformKind,
  PlatformUser,
} from './PlatformBridge';
import { BrowserPlatform } from './BrowserPlatform';
import { MaxPlatform } from './MaxPlatform';
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
    }
    return next;
  }

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
  setBackHandler(callback: (() => void) | null): void {
    this.desiredBackHandler = callback;
    this.adapter.setBackHandler(callback);
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
} from './PlatformBridge';
