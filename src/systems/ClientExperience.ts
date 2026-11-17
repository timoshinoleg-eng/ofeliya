import { ClientCollection } from '../game/collection/ClientCollection';
import { resolveClientFlags, type ClientFeatureFlags } from './ClientFeatureFlags';
import { createOptionalWebAnalytics, type OptionalWebAnalyticsClient } from './OptionalWebAnalytics';
import type { ProductEvent, ProductEventProps } from './AnalyticsClient';

let flags: ClientFeatureFlags = resolveClientFlags();
let analytics: OptionalWebAnalyticsClient | null = null;
let webReady = false;
let analyticsGeneration = 0;
const MAX_EARLY_EVENTS = 48;
let earlyEvents: Array<{ event: ProductEvent; props: ProductEventProps }> = [];

export function configureClientExperience(options: {
  qaTools: boolean; search: string; analyticsEnabled?: boolean; src?: string; websiteId?: string;
}): void {
  flags = resolveClientFlags(options);
  const generation = ++analyticsGeneration;
  webReady = false;
  earlyEvents = [];
  analytics = createOptionalWebAnalytics({enabled:options.analyticsEnabled === true || flags.telemetry.web,
    src:options.src,websiteId:options.websiteId});
  // Third-party loading never delays startup. Replay the bounded early-boot
  // product funnel only after the Umami script initializes.
  void analytics.ready.then((ready) => {
    if (generation !== analyticsGeneration || !analytics) return;
    if (!ready) { earlyEvents = []; return; }
    webReady = true;
    const buffered = earlyEvents;
    earlyEvents = [];
    // Browser fallback opens have no trusted Telegram initData and therefore
    // no app_open from AnalyticsClient; don't double-count real Mini App opens.
    if (!buffered.some(({ event }) => event === 'app_open')) {
      analytics.track('app_open', { screen: 'menu' });
    }
    for (const { event, props } of buffered) analytics.track(event, props);
  }).catch(() => {
    if (generation === analyticsGeneration) earlyEvents = [];
  });
}
export function clientFlags(): ClientFeatureFlags { return flags; }
// Read at interaction boundaries, so another scene's latest observation is never overwritten
// by a stale page-lifetime instance. No collection storage is read in the frame loop.
export function clientCollection(): ClientCollection { return new ClientCollection(); }
export function trackClientEvent(event: ProductEvent, props: ProductEventProps): void {
  if (!analytics) return;
  if (webReady) {
    analytics.track(event, props);
  } else if (earlyEvents.length < MAX_EARLY_EVENTS) {
    earlyEvents.push({ event, props: { ...props } });
  }
}

export function cosmeticColor(id: string): number {
  return id === 'skin.virulent-magenta' ? 0xff79c6 : id === 'skin.abyssal-teal' ? 0x77e6d2
    : id === 'skin.gilded-prime' ? 0xffd56a : 0xffffff;
}
