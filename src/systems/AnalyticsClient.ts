import type { PlatformAdapter } from '../platform/PlatformBridge';

const ANALYTICS_ANON_KEY = 'ofeliya_analytics_anon_v1';
const ANALYTICS_TIMEOUT_MS = 1800;

export type ProductEvent =
  | 'app_open'
  | 'run_start'
  | 'run_60s'
  | 'boss1'
  | 'heart'
  | 'death'
  | 'win'
  | 'replay'
  | 'share'
  | 'daily'
  | 'referral';

export type ProductEventProps = Record<string, string | number | boolean>;

function randomAnonId(): string {
  try {
    if (globalThis.crypto?.getRandomValues) {
      const words = new Uint32Array(3);
      globalThis.crypto.getRandomValues(words);
      return `anon-${Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('')}`;
    }
  } catch {
    // Restricted WebViews can deny crypto.
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function analyticsAnonId(): string {
  if (typeof localStorage === 'undefined') return randomAnonId();
  try {
    const current = localStorage.getItem(ANALYTICS_ANON_KEY);
    if (current && current.length >= 8 && current.length <= 64) return current;
    const created = randomAnonId();
    localStorage.setItem(ANALYTICS_ANON_KEY, created);
    return created;
  } catch {
    return randomAnonId();
  }
}

export interface AnalyticsSubmission {
  platform: 'max' | 'telegram' | 'browser';
  initData?: string;
  anonId?: string;
  event: ProductEvent;
  props: ProductEventProps;
}

export function buildAnalyticsSubmission(
  event: ProductEvent,
  platform: PlatformAdapter,
  props: ProductEventProps = {}
): AnalyticsSubmission | null {
  const kind = platform.kind === 'max' || platform.kind === 'telegram' ? platform.kind : 'browser';
  if (kind !== 'browser' && !platform.initData) return null;

  const submission: AnalyticsSubmission = {
    platform: kind,
    event,
    props,
  };
  if (kind === 'browser') submission.anonId = analyticsAnonId();
  else submission.initData = platform.initData;
  return submission;
}

function endpoint(): string {
  if (typeof window === 'undefined') return 'api/event';
  return new URL('api/event', window.location.href).toString();
}

export async function trackProductEvent(
  event: ProductEvent,
  platform: PlatformAdapter,
  props: ProductEventProps = {}
): Promise<boolean> {
  const submission = buildAnalyticsSubmission(event, platform, props);
  if (!submission || typeof fetch === 'undefined') return false;

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), ANALYTICS_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
      signal: controller.signal,
      credentials: 'same-origin',
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
