import { trackClientEvent } from './ClientExperience';
import type { PlatformAdapter } from '../platform/PlatformBridge';

const ANALYTICS_TIMEOUT_MS = 1800;

export type ProductEvent =
  | 'app_open'
  | 'run_start'
  | 'run_60s'
  | 'run_10min'
  | 'boss1'
  | 'heart'
  | 'death'
  | 'win'
  | 'replay'
  | 'share'
  | 'daily'
  | 'referral'
  | 'first_enemy_hit'
  | 'first_enemy_kill'
  | 'first_rna_pickup'
  | 'first_mutation_opened'
  | 'first_mutation_selected'
  | 'mutation_chosen'
  | 'host_cell_approached'
  | 'infection_started'
  | 'infection_interrupted'
  | 'infection_resumed'
  | 'first_lysis'
  | 'second_host_cell_completed_without_hint'
  | 'onboarding_step'
  | 'onboarding_exit'
  | 'daily_claimed'
  | 'achievement_unlocked'
  | 'lab_upgrade_bought'
  | 'prestige_done'
  | 'skin_granted'
  | 'skin_equipped'
  | 'store_viewed'
  | 'purchase_started'
  | 'purchase_completed'
  | 'purchase_failed'
  | 'purchase_pending'
  | 'purchase_grant_failed'
  /** Патч №16 (A3): оплата подтверждена, но синк кошелька не удался — товар в pending-sync. */
  | 'purchase_sync_pending'
  /** Патч №16 (A3): ручной «Повторить» подтвердил материализацию. */
  | 'purchase_sync_recovered'
  /** Патч №16 (A3): ручной «Повторить» не удался. */
  | 'purchase_sync_retry_failed';

export type ProductEventProps = Record<string, string | number | boolean>;

export interface AnalyticsSubmission {
  platform: 'max' | 'telegram';
  initData: string;
  event: ProductEvent;
  props: ProductEventProps;
}

export function buildAnalyticsSubmission(
  event: ProductEvent,
  platform: PlatformAdapter,
  props: ProductEventProps = {}
): AnalyticsSubmission | null {
  if ((platform.kind !== 'max' && platform.kind !== 'telegram') || !platform.initData) {
    return null;
  }

  return {
    platform: platform.kind,
    initData: platform.initData,
    event,
    props,
  };
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
  trackClientEvent(event, props);
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