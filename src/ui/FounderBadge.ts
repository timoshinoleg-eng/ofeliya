import type { ServerProfile } from '../systems/ProfileClient';

export const FOUNDER_BADGE_ITEM_ID = 'founder-badge-v1' as const;
export const FOUNDER_BADGE_LABEL = 'ЗНАК ОСНОВАТЕЛЯ' as const;

/**
 * Presentation-only entitlement check.
 *
 * The badge is never inferred from local save/registry/query state. A caller
 * must provide a profile that already passed ProfileClient's strict parser.
 */
export function hasFounderBadge(profile: ServerProfile | null): boolean {
  return Boolean(profile?.inventory.items[FOUNDER_BADGE_ITEM_ID]);
}
