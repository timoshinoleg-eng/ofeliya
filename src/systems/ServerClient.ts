/**
 * Клиент score-сервера (V3). Fire-and-forget: сетевые сбои НИКАК не влияют
 * на геймплей (таймауты, catch, без ретраев).
 *
 * env: VITE_SERVER_URL (base, например https://api.ofeliya.example).
 * Без URL — относительные пути `/api/*`: в дев-режиме их проксирует Vite
 * (server.proxy → 127.0.0.1:8787), в проде — reverse-proxy на тот же домен.
 * Сервер недоступен → fetch падают в catch → null, UI работает как без него.
 */
import { MessengerBridge, type MessengerKind } from './MessengerBridge';
import { VkBridge } from './VkBridge';

const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';
const TIMEOUT_MS = 4000;
const ANON_KEY = 'ofeliya_anon_id';

function anonIdFn(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      id = 'anon-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return 'anon-fallback';
  }
}

export interface ScorePayload {
  daily: boolean;
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  dateKey: string;
  /** uid друга, по чьей ссылке пришли (ref_<uid>) */
  ref?: string | null;
}

export interface TopEntry {
  rank: number;
  platform: string;
  uid: string;
  daily: boolean;
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  dateKey: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  // Пустой BASE = относительные пути /api/* (Vite proxy в дев, reverse-proxy в
  // прод). Всегда пробуем; недоступный сервер → catch → null (не ломаем UI).
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function authBody() {
  const platform: MessengerKind = MessengerBridge.kind;
  if (platform === 'browser' || platform === 'vk') {
    // browser: anonId (unverified). VK: шлём web_app_t (webAppInit) для серверной
    // валидации (нужен VK_SECURE_KEY) + anonId (VK user id / anon) как фолбэк —
    // без секрета/токена сервер оставит скор unverified.
    if (platform === 'vk') {
      const vkId = VkBridge.userId;
      return {
        platform,
        anonId: vkId ?? anonIdFn(),
        webAppInit: VkBridge.webAppInit,
      };
    }
    return { platform, anonId: anonIdFn() };
  }
  return { platform, initData: MessengerBridge.initData };
}

export const ServerClient = {
  /** Запросы всегда возможны (baseUrl может быть пустым = относительные пути). */
  get enabled(): boolean {
    return true;
  },

  /** Отправка результата (fire-and-forget; вернёт null при сбое). */
  submitScore(payload: ScorePayload): Promise<{ rank: number | null; refReward: unknown } | null> {
    return request<{ ok: boolean; rank: number | null; refReward: unknown }>('/api/score', {
      method: 'POST',
      body: JSON.stringify({ ...authBody(), payload }),
    }).then((r) => (r?.ok ? { rank: r.rank, refReward: r.refReward } : null));
  },

  /** Глобальный топ. period: 'all' | 'daily' | 'weekly' | 'season'. */
  getTop(period: 'all' | 'daily' | 'weekly' | 'season' = 'all'): Promise<TopEntry[] | null> {
    return request<{ ok: boolean; top: TopEntry[] }>(`/api/top?period=${period}`)
      .then((r) => (r?.ok ? r.top : null));
  },

  /** V4: «общий» результат дня — «ты №N из M сегодня». null — сбой/нет daily-скор. */
  getDailyRank(
    user: string,
    platform: string
  ): Promise<{ dateKey: string | null; total: number; rank: number | null; you: { win: boolean; timeMs: number; kills: number } | null } | null> {
    if (!user) return Promise.resolve(null);
    return request<{ ok: boolean; dateKey: string | null; total: number; rank: number | null; you: { win: boolean; timeMs: number; kills: number } | null }>(
      `/api/daily?user=${encodeURIComponent(user)}&platform=${encodeURIComponent(platform)}`
    ).then((r) => (r?.ok ? r : null));
  },

  /** C5: текущий сезон (индекс, окно, дней до конца). null — сбой/нет сервера. */
  getSeason(): Promise<{ index: number; start: number; end: number; daysLeft: number } | null> {
    return request<{ ok: boolean; season: { index: number; start: number; end: number; daysLeft: number } }>(
      '/api/season'
    ).then((r) => (r?.ok ? r.season : null));
  },

  /** Зафиксировать реферальное рёбро (когда приглашённый завершил первый забег). */
  sendRef(from: string, toUid: string, platform: MessengerKind): Promise<{ first: boolean } | null> {
    if (!from || !toUid) return Promise.resolve(null);
    return request<{ ok: boolean; first: boolean }>('/api/ref', {
      method: 'POST',
      body: JSON.stringify({ from, to: toUid, platform }),
    }).then((r) => (r?.ok ? { first: r.first } : null));
  },

  /**
   * V2: топ друзей по реферальным рёбрам (двунаправленно). null — сбой/нет uid.
   */
  getFriends(
    user: string,
    platform: string
  ): Promise<Array<{ relation: string; uid: string; platform: string; win: boolean; timeMs: number; kills: number; level: number; dateKey: string }> | null> {
    if (!user) return Promise.resolve(null);
    return request<{ ok: boolean; friends: Array<Record<string, unknown>> }>(
      `/api/friends?user=${encodeURIComponent(user)}&platform=${encodeURIComponent(platform)}`
    ).then((r) => (r?.ok ? (r.friends as unknown) as Array<{ relation: string; uid: string; platform: string; win: boolean; timeMs: number; kills: number; level: number; dateKey: string }> : null));
  },

  /** Псевдонимный id для browser-платформы (без PII). */
  anonId(): string {
    return anonIdFn();
  },

  /** Свой uid (из initData / VK) или null (браузер/нет initData). */
  /**
   * Идентификатор, под которым сервер хранит скор текущего игрока:
   * browser → anonId (из localStorage), vk → VK user id (или anonId),
   * tg/max → user.id из initData. Совпадает с тем, что уходит в /api/score.
   */
  serverUid(): string | null {
    const kind = MessengerBridge.kind;
    if (kind === 'browser') return anonIdFn();
    if (kind === 'vk') return VkBridge.userId ?? anonIdFn();
    return ServerClient.localUid();
  },

  localUid(): string | null {
    const kind = MessengerBridge.kind;
    if (kind === 'vk') return VkBridge.userId;
    if (kind === 'browser') return null;
    try {
      const params = new URLSearchParams(MessengerBridge.initData);
      const rawUser = params.get('user');
      const user = rawUser ? (JSON.parse(rawUser) as { id?: number | string }) : null;
      return user?.id != null ? String(user.id) : null;
    } catch {
      return null;
    }
  },
};
