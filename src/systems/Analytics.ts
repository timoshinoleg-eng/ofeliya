/**
 * Аналитика событий (R1). Лёгкий self-contained трекер без внешних зависимостей:
 *
 * - события уходят на VITE_ANALYTICS_URL (PostHog-compat endpoint, свой
 *   коллектор на PocketBase или любой HTTP sink), если он задан;
 * - без URL (дев/локальный запуск) — консоль в DEV + буфер в localStorage,
 *   чтобы ничего не терялось;
 * - очередь переживает закрытие вкладки (localStorage-буфер до 200 событий),
 *   флеш — по 10 событиям, раз в 30с и при уходе в фон/pagehide;
 * - никаких персональных данных: только псевдонимный anonId и агрегаты забега.
 *
 * Формат события: { name, ts, props } — совпадает с POST /capture PostHog
 * (distinct_id, event, properties), поэтому sink можно поменять на PostHog,
 * не трогая клиент.
 */

import { MessengerBridge } from './MessengerBridge';
import { VkBridge } from './VkBridge';

const URL = (import.meta.env.VITE_ANALYTICS_URL as string | undefined) ?? '';
const APP_VERSION = '0.4.0';
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_SIZE = 10;
const BUFFER_KEY = 'ofeliya_analytics_buffer';
const ANON_KEY = 'ofeliya_anon_id';
const MAX_BUFFER = 200;

export type AnalyticsEvent =
  | 'open'
  | 'first_run'
  | 'run_started'
  | 'run_completed'
  | 'boss_spawned'
  | 'dodge_used'
  | 'level_up'
  | 'share_opened'
  | 'share_done'
  | 'ref_shared'
  | 'ref_share_done'
  | 'ref_opened'
  | 'reward_ad_opened'
  | 'reward_ad_done'
  | 'pause_shown'
  | 'game_over_shown'
  | 'shards_earned'
  | 'meta_bought';

interface QueuedEvent {
  name: AnalyticsEvent;
  ts: number;
  props: Record<string, unknown>;
}

class AnalyticsImpl {
  private queue: QueuedEvent[] = [];
  private timer: number | null = null;
  private ready = false;

  /** Псевдонимный id сессии (не PII): стабильный на устройстве. */
  get distinctId(): string {
    try {
      let id = localStorage.getItem(ANON_KEY);
      if (!id) {
        id = `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        localStorage.setItem(ANON_KEY, id);
      }
      return id;
    } catch {
      return 'anon-private';
    }
  }

  init(): void {
    if (this.ready) return;
    this.ready = true;
    // Восстанавливаем не отправленное (закрыли вкладку до флеша).
    this.queue = this.readBuffer();
    this.timer = window.setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) void this.flush();
      },
      { passive: true }
    );
    window.addEventListener('pagehide', () => void this.flush());
  }

  track(name: AnalyticsEvent, props: Record<string, unknown> = {}): void {
    if (!this.ready) this.init();
    this.queue.push({ name, ts: Date.now(), props });
    if (this.queue.length > MAX_BUFFER) this.queue.splice(0, this.queue.length - MAX_BUFFER);
    if (this.queue.length >= FLUSH_SIZE) void this.flush();
    // VK: дублируем в VKWebAppTrackEvent (атрибуция VK Ads). Best effort, no-op вне VK.
    if (MessengerBridge.kind === 'vk') {
      VkBridge.trackEvent(name, VkBridge.userId, props);
    }
  }

  private readBuffer(): QueuedEvent[] {
    if (!URL) return [];
    try {
      const raw = localStorage.getItem(BUFFER_KEY);
      return raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
    } catch {
      return [];
    }
  }

  private saveBuffer(): void {
    if (!URL) return;
    try {
      localStorage.setItem(BUFFER_KEY, JSON.stringify(this.queue.slice(-MAX_BUFFER)));
    } catch {
      /* приватный режим — без буфера */
    }
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (!URL) {
      if (import.meta.env.DEV) {
        for (const e of this.queue) console.debug('[analytics]', e.name, e.props);
      }
      this.queue = [];
      return;
    }
    const batch = this.queue.splice(0, this.queue.length);
    // PostHog /capture-совместимый формат (массив).
    const payload = {
      batch: batch.map((e) => ({
        distinct_id: this.distinctId,
        event: e.name,
        properties: {
          ...e.props,
          $app: 'ofeliya',
          $app_version: APP_VERSION,
          $ts: e.ts,
        },
      })),
      sent_at: new Date().toISOString(),
    };
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.saveBuffer(); // пусто
    } catch {
      // Не дошли — возвращаем в очередь (хвост, чтобы свежие не потерять).
      this.queue.unshift(...batch);
      if (this.queue.length > MAX_BUFFER) this.queue.splice(0, this.queue.length - MAX_BUFFER);
      this.saveBuffer();
    }
  }
}

export const Analytics = new AnalyticsImpl();
