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
  getStartParam(): string | null;
  getViewportSize(): Promise<{ width: number; height: number } | null>;
  setBackHandler(callback: (() => void) | null): void;
  shareResult(text: string): Promise<boolean>;
  haptic(style?: HapticStyle): void;
  notify(type: NotifyType): void;
}

export function platformDisplayName(user: PlatformUser | null): string | null {
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  if (full) return full;
  return user.username?.trim() || null;
}
