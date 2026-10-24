import type { ProductEvent } from './AnalyticsClient';

export type OptionalWebEvent = ProductEvent;

export interface OptionalWebEventProperties {
  screen?: 'menu' | 'game' | 'result' | 'codex' | 'collection';
  mode?: 'classic' | 'daily' | 'practice';
  stage?: 'bloodstream' | 'immune_prime' | 'heart' | 'cardiac_titan';
  result?: 'win' | 'loss' | 'abandoned';
  durationBucket?: 'under_1m' | '1_to_3m' | '3_to_6m' | 'over_6m';
  questCount?: number;
  collectionCount?: number;
  reducedMotion?: boolean;
}

export interface OptionalWebAnalyticsOptions {
  /** Must be explicitly true, normally from the telemetry.web feature flag. */
  enabled?: boolean;
  /** Explicit HTTPS URL of the Umami script. */
  src?: string;
  /** Explicit Umami website identifier. */
  websiteId?: string;
  /** Injection points for deterministic tests and embedded WebViews. */
  document?: Document;
  window?: Window & { umami?: { track?: (event: string, properties?: Record<string, string | number | boolean>) => unknown } };
}

export interface OptionalWebAnalyticsClient {
  /** Resolves true after the script loads, false when disabled or unavailable. */
  ready: Promise<boolean>;
  /** Sends one allowlisted event when Umami is already available. */
  track(event: OptionalWebEvent | string, properties?: Record<string, unknown>): boolean;
}

const pendingByDocument = new WeakMap<Document, Map<string, Promise<boolean>>>();
const EVENT_NAMES = new Set<OptionalWebEvent>([
  'app_open', 'run_start', 'run_60s', 'boss1', 'heart', 'death', 'win', 'replay', 'share', 'daily', 'referral',
  'first_enemy_hit', 'first_enemy_kill', 'first_rna_pickup', 'first_mutation_opened', 'first_mutation_selected',
  'host_cell_approached', 'infection_started', 'infection_interrupted', 'infection_resumed', 'first_lysis',
  'second_host_cell_completed_without_hint', 'onboarding_step', 'onboarding_exit',
]);
const ENUM_VALUES: Record<string, ReadonlySet<string>> = {
  screen: new Set(['menu', 'game', 'result', 'codex', 'collection']),
  mode: new Set(['classic', 'daily', 'practice']),
  stage: new Set(['bloodstream', 'immune_prime', 'heart', 'cardiac_titan']),
  result: new Set(['win', 'loss', 'abandoned']),
  durationBucket: new Set(['under_1m', '1_to_3m', '3_to_6m', 'over_6m']),
};
const PROPERTY_NAMES = new Set([
  'screen', 'mode', 'stage', 'result', 'durationBucket', 'questCount', 'collectionCount', 'reducedMotion',
]);

function validConfiguration(options: OptionalWebAnalyticsOptions): { src: string; websiteId: string } | null {
  if (options.enabled !== true || typeof options.src !== 'string' || typeof options.websiteId !== 'string') return null;
  let url: URL;
  try {
    url = new URL(options.src);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !/^[A-Za-z0-9_-]{8,128}$/.test(options.websiteId)) return null;
  return { src: url.toString(), websiteId: options.websiteId };
}

function safeProperties(input: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return safe;
  for (const [key, value] of Object.entries(input)) {
    if (!PROPERTY_NAMES.has(key)) continue;
    if (key in ENUM_VALUES) {
      if (typeof value === 'string' && ENUM_VALUES[key].has(value)) safe[key] = value;
      continue;
    }
    if (key === 'questCount' || key === 'collectionCount') {
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000) safe[key] = value;
      continue;
    }
    if (key === 'reducedMotion' && typeof value === 'boolean') safe[key] = value;
  }
  return safe;
}

function loadScript(documentRef: Document, src: string, websiteId: string): Promise<boolean> {
  const key = `${src}\n${websiteId}`;
  let byKey = pendingByDocument.get(documentRef);
  if (!byKey) {
    byKey = new Map();
    pendingByDocument.set(documentRef, byKey);
  }
  const pending = byKey.get(key);
  if (pending) return pending;

  const existing = Array.from(documentRef.querySelectorAll('script[data-ofeliya-umami]'))
    .find((script) => script.getAttribute('data-ofeliya-umami') === key);
  if (existing) {
    const loaded = Promise.resolve(true);
    byKey.set(key, loaded);
    return loaded;
  }

  const script = documentRef.createElement('script');
  script.async = true;
  script.src = src;
  script.setAttribute('data-website-id', websiteId);
  script.setAttribute('data-ofeliya-umami', key);

  const result = new Promise<boolean>((resolve) => {
    script.onload = () => resolve(true);
    script.onerror = () => {
      script.remove();
      byKey?.delete(key);
      resolve(false);
    };
    documentRef.head.appendChild(script);
  });
  byKey.set(key, result);
  return result;
}

/**
 * Create an optional Umami client. It never reads Telegram/MAX init data,
 * browser location, or user identity, and it never loads without explicit config.
 */
export function createOptionalWebAnalytics(options: OptionalWebAnalyticsOptions = {}): OptionalWebAnalyticsClient {
  const config = validConfiguration(options);
  const documentRef = options.document ?? (typeof document === 'undefined' ? undefined : document);
  const windowRef = options.window ?? (typeof window === 'undefined' ? undefined : window) as OptionalWebAnalyticsOptions['window'];
  const ready = config && documentRef
    ? loadScript(documentRef, config.src, config.websiteId)
    : Promise.resolve(false);

  return {
    ready,
    track(event, properties = {}) {
      if (!config || !EVENT_NAMES.has(event as OptionalWebEvent)) return false;
      const track = windowRef?.umami?.track;
      if (typeof track !== 'function') return false;
      try {
        track.call(windowRef?.umami, event, safeProperties(properties));
        return true;
      } catch {
        return false;
      }
    },
  };
}
