export interface TelegramLifecycleWebApp {
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  onEvent?: (type: string, callback: () => void) => void;
  offEvent?: (type: string, callback: () => void) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
}

export interface TelegramLifecycleDocument {
  visibilityState?: string;
  addEventListener?: (type: string, callback: () => void) => void;
  removeEventListener?: (type: string, callback: () => void) => void;
}

export interface TelegramPauseHooks<Token = unknown> {
  isGameActive(): boolean;
  isPaused(): boolean;
  pause(): Token;
  /** Return true only while this exact token still owns the pause. */
  isPauseOwned(token: Token): boolean;
  /** Resume only the pause identified by token; implementation must preserve other pauses. */
  resume(token: Token): void;
}

/** Telegram-only close confirmation and visibility pause controller, independent of scenes. */
export class TelegramLifecycle<Token = unknown> {
  private started = false;
  private closingConfirmationEnabled = false;
  private pauseToken: Token | undefined;
  private hasPauseToken = false;
  private readonly detachHost: Array<() => void> = [];

  constructor(
    private readonly webApp: TelegramLifecycleWebApp,
    private readonly doc: TelegramLifecycleDocument,
    private readonly hooks: TelegramPauseHooks<Token>
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.hooks.isGameActive() && this.isVersionAtLeast('6.2') &&
      this.webApp.enableClosingConfirmation && this.webApp.disableClosingConfirmation) {
      try {
        this.webApp.enableClosingConfirmation();
        this.closingConfirmationEnabled = true;
      } catch {
        this.closingConfirmationEnabled = false;
      }
    }
    this.doc.addEventListener?.('visibilitychange', this.onVisibilityChange);
    if (this.isVersionAtLeast('8.0')) {
      this.listen('deactivated', this.pauseIfOwnedByUs);
      this.listen('activated', this.onActivated);
    }
    this.onVisibilityChange();
  }

  destroy(): void {
    if (!this.started) return;
    this.started = false;
    this.doc.removeEventListener?.('visibilitychange', this.onVisibilityChange);
    for (const detach of this.detachHost.splice(0)) detach();
    this.resumeIfOwnedByUs();
    if (this.closingConfirmationEnabled) {
      try { this.webApp.disableClosingConfirmation?.(); } catch { /* Safe host no-op. */ }
      this.closingConfirmationEnabled = false;
    }
  }

  private isVersionAtLeast(required: string): boolean {
    try {
      if (typeof this.webApp.isVersionAtLeast === 'function') {
        return this.webApp.isVersionAtLeast(required) === true;
      }
    } catch {
      // Fall back to parsing the exposed version string.
    }
    const parse = (value: string | undefined): number[] | null => {
      if (!value || !/^\d+(?:\.\d+)*$/.test(value.trim())) return null;
      return value.trim().split('.').map(Number);
    };
    const current = parse(this.webApp.version);
    const minimum = parse(required);
    if (!current || !minimum) return false;
    for (let i = 0; i < Math.max(current.length, minimum.length); i++) {
      const a = current[i] ?? 0;
      const b = minimum[i] ?? 0;
      if (a !== b) return a > b;
    }
    return true;
  }

  private listen(type: string, callback: () => void): void {
    if (typeof this.webApp.onEvent !== 'function' || typeof this.webApp.offEvent !== 'function') return;
    try {
      this.webApp.onEvent(type, callback);
    } catch {
      return;
    }
    let detached = false;
    this.detachHost.push(() => {
      if (detached) return;
      detached = true;
      try { this.webApp.offEvent?.(type, callback); } catch { /* Safe host no-op. */ }
    });
  }

  private pauseIfOwnedByUs = (): void => {
    if (!this.started || !this.hooks.isGameActive() || this.hooks.isPaused() || this.hasPauseToken) return;
    try {
      this.pauseToken = this.hooks.pause();
      this.hasPauseToken = true;
    } catch {
      // A scene transition racing the host event must not escape into Telegram's event bus.
    }
  };

  private resumeIfOwnedByUs = (): void => {
    if (!this.hasPauseToken) return;
    if (this.doc.visibilityState === 'hidden') return;
    const token = this.pauseToken as Token;
    this.pauseToken = undefined;
    this.hasPauseToken = false;
    if (!this.hooks.isGameActive() || !this.hooks.isPaused()) return;
    try {
      if (this.hooks.isPauseOwned(token)) this.hooks.resume(token);
    } catch {
      // A stale or unavailable scene pause must never block host cleanup.
    }
  };

  private onActivated = (): void => {
    this.resumeIfOwnedByUs();
  };

  private onVisibilityChange = (): void => {
    if (this.doc.visibilityState === 'hidden') this.pauseIfOwnedByUs();
    else this.resumeIfOwnedByUs();
  };
}
