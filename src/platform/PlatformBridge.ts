export type PlatformKind = 'max' | 'telegram' | 'browser';
export type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
export type NotifyType = 'error' | 'success' | 'warning';

export interface PlatformUser {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface PlatformSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlatformAdapter {
  readonly kind: PlatformKind;
  /** True only when hosted by a supported messenger client. */
  readonly available: boolean;
  readonly platform: string;
  readonly version: string;
  /** Signed init payload. Trust only after server-side validation. */
  readonly initData: string;

  getUser(): PlatformUser | null;
  getDisplayName(): string | null;
  /** Untrusted social/deeplink context. Never use as authorization or authoritative score input. */
  getStartParam(): string | null;
  /** Build a platform-native app deeplink for a validated start payload, when configured. */
  buildStartLink(payload: string): string | null;
  getViewportSize(): Promise<{ width: number; height: number } | null>;
  /** Telegram Bot API 8.0+ host insets; other adapters may omit this capability. */
  getSafeAreaInsets?(): PlatformSafeAreaInsets | null;
  /**
   * Optional host-driven viewport invalidation signal.
   *
   * Some hosts expose a virtual viewport that never fires a window resize event — the
   * Telegram Mini App viewport changes when the keyboard opens, the app is expanded or the
   * device rotates, and the host is the only component that knows about it. Adapters that
   * can observe such a change push it here so the game can re-measure its frame.
   *
   * Returns an unsubscribe function. Hosts without such a signal simply omit the method.
   */
  subscribeViewportChange?(listener: () => void): () => void;
  setBackHandler(callback: (() => void) | null): void;
  shareResult(text: string, link?: string): Promise<boolean>;
  haptic(style?: HapticStyle): void;
  notify(type: NotifyType): void;
}

export function platformDisplayName(user: PlatformUser | null): string | null {
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  return user.username?.trim() || null;
}
