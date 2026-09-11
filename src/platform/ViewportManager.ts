import type Phaser from 'phaser';
import { PlatformBridge } from './index';
import { computeViewportFrame, type SafeAreaInsets, type ViewportSize } from './ViewportMath';

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = [
    'position:fixed',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top)',
    'padding-right:env(safe-area-inset-right)',
    'padding-bottom:env(safe-area-inset-bottom)',
    'padding-left:env(safe-area-inset-left)',
  ].join(';');
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const safe = {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
  probe.remove();
  return safe;
}

function windowViewport(): ViewportSize {
  return {
    width: Math.max(1, Math.floor(window.innerWidth || document.documentElement.clientWidth || 1)),
    height: Math.max(1, Math.floor(window.innerHeight || document.documentElement.clientHeight || 1)),
  };
}

/** Keeps Phaser inside MAX's documented available viewport and the OS CSS safe area. */
export class ViewportManager {
  private readonly host: HTMLElement;
  private game: Phaser.Game | null = null;
  private requestId = 0;
  private retryTimer: number | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  attachGame(game: Phaser.Game): void {
    this.game = game;
  }

  start(): void {
    window.addEventListener('resize', this.onViewportSignal, { passive: true });
    window.addEventListener('orientationchange', this.onViewportSignal, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.sync();

    // Covers the rare case where the MAX CDN bridge becomes available after the module bundle.
    this.retryTimer = window.setTimeout(() => void this.sync(), 350);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onViewportSignal);
    window.removeEventListener('orientationchange', this.onViewportSignal);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.requestId += 1;
  }

  async sync(): Promise<void> {
    const id = ++this.requestId;
    const fallback = windowViewport();
    let viewport = fallback;
    try {
      const bridgeViewport = await PlatformBridge.getViewportSize();
      if (bridgeViewport) viewport = bridgeViewport;
    } catch {
      viewport = fallback;
    }
    if (id !== this.requestId) return;

    const frame = computeViewportFrame(viewport, readSafeAreaInsets());
    this.host.style.left = `${frame.left}px`;
    this.host.style.top = `${frame.top}px`;
    this.host.style.width = `${frame.width}px`;
    this.host.style.height = `${frame.height}px`;
    this.host.dataset.viewportSource = PlatformBridge.kind;

    document.documentElement.style.setProperty('--ofeliya-vw', `${frame.width}px`);
    document.documentElement.style.setProperty('--ofeliya-vh', `${frame.height}px`);

    if (this.game && (this.game.scale.width !== frame.width || this.game.scale.height !== frame.height)) {
      this.game.scale.resize(frame.width, frame.height);
    }
  }

  private onViewportSignal = (): void => {
    void this.sync();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.sync();
  };
}
