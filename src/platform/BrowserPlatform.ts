import type { HapticStyle, NotifyType, PlatformAdapter, PlatformUser } from './PlatformBridge';

export class BrowserPlatform implements PlatformAdapter {
  readonly kind = 'browser' as const;
  readonly available = false;
  readonly platform = 'browser';
  readonly version = '';
  readonly initData = '';

  getUser(): PlatformUser | null {
    return null;
  }

  getDisplayName(): string | null {
    return null;
  }

  getStartParam(): string | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('startapp');
  }

  async getViewportSize(): Promise<{ width: number; height: number } | null> {
    if (typeof window === 'undefined') return null;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  setBackHandler(_callback: (() => void) | null): void {
    // Browser has no native messenger BackButton.
  }

  async shareResult(text: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.share) return false;
    try {
      await navigator.share({ text });
      return true;
    } catch {
      return false;
    }
  }

  haptic(_style: HapticStyle = 'light'): void {
    // Do not synthesize vibration in generic browser mode.
  }

  notify(_type: NotifyType): void {
    // Safe no-op.
  }
}
