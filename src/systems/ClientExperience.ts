import { ClientCollection } from '../game/collection/ClientCollection';
import { resolveClientFlags, type ClientFeatureFlags } from './ClientFeatureFlags';
import { createOptionalWebAnalytics, type OptionalWebAnalyticsClient } from './OptionalWebAnalytics';
import type { ProductEvent, ProductEventProps } from './AnalyticsClient';

let flags: ClientFeatureFlags = resolveClientFlags();
let analytics: OptionalWebAnalyticsClient | null = null;
export function configureClientExperience(options: {
  qaTools: boolean; search: string; analyticsEnabled?: boolean; src?: string; websiteId?: string;
}): void {
  flags = resolveClientFlags(options);
  analytics = createOptionalWebAnalytics({enabled:options.analyticsEnabled === true || flags.telemetry.web,
    src:options.src,websiteId:options.websiteId});
  // Optional third-party loading never delays game startup.
  void analytics.ready.then(ready=>{if(ready) analytics?.track('app_open',{screen:'menu'});});
}
export function clientFlags(): ClientFeatureFlags { return flags; }
// Read at interaction boundaries, so another scene's latest observation is never overwritten
// by a stale page-lifetime instance. No collection storage is read in the frame loop.
export function clientCollection(): ClientCollection { return new ClientCollection(); }
export function trackClientEvent(event: ProductEvent, props: ProductEventProps): void { analytics?.track(event,props); }

export function cosmeticColor(id: string): number {
  return id === 'skin.virulent-magenta' ? 0xff79c6 : id === 'skin.abyssal-teal' ? 0x77e6d2
    : id === 'skin.gilded-prime' ? 0xffd56a : 0xffffff;
}
