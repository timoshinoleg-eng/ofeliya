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
/**
 * P2-7: дедупликация app_open. Настоящий app_open от AnalyticsClient
 * (installAppOpenTracking в main.ts) может прийти ПОСЛЕ готовности Umami:
 * MAX-мост асинхронен, tryTrack повторяется на 350/1200 мс и по событию
 * ofeliya:max-bridge-ready. appOpenSeen ставится при любом настоящем
 * app_open (в буфере или напрямую); appOpenFallbackSent — когда fallback
 * уже ушёл в Umami.
 */
let appOpenSeen = false;
let appOpenFallbackSent = false;
/**
 * Окно ответа MAX-моста (см. installAppOpenTracking: последний плановый
 * tryTrack — на 1200 мс после boot). Fallback ждёт это окно от момента
 * готовности Umami: в обычном порядке install предшествует flush, так что
 * окно покрывает мост; остаточную гонку (install задержался из-за
 * release-check/загрузки Telegram SDK) закрывает appOpenFallbackSent:
 * настоящий app_open после ушедшего fallback подавляется.
 */
export const APP_OPEN_FALLBACK_DELAY_MS = 1200;
let appOpenFallbackDelayMs = APP_OPEN_FALLBACK_DELAY_MS;

export function configureClientExperience(options: {
  qaTools: boolean; search: string; analyticsEnabled?: boolean; src?: string; websiteId?: string;
  /** Injection point for deterministic tests (default APP_OPEN_FALLBACK_DELAY_MS). */
  appOpenFallbackDelayMs?: number;
}): void {
  flags = resolveClientFlags(options);
  const generation = ++analyticsGeneration;
  webReady = false;
  earlyEvents = [];
  appOpenSeen = false;
  appOpenFallbackSent = false;
  appOpenFallbackDelayMs =
    typeof options.appOpenFallbackDelayMs === 'number' && options.appOpenFallbackDelayMs >= 0
      ? options.appOpenFallbackDelayMs
      : APP_OPEN_FALLBACK_DELAY_MS;
  analytics = createOptionalWebAnalytics({enabled:options.analyticsEnabled === true || flags.telemetry.web,
    src:options.src,websiteId:options.websiteId});
  // Third-party loading never delays startup. Replay the bounded early-boot
  // product funnel only after the Umami script initializes.
  void analytics.ready.then((ready) => {
    if (generation !== analyticsGeneration || !analytics) return;
    if (!ready) { earlyEvents = []; return; }
    webReady = true;
    // Umami auto-tracking is disabled for launch-credential privacy; send one
    // fixed-path pageview so Visits/Visitors are counted alongside custom events.
    analytics.trackPageview();
    const buffered = earlyEvents;
    earlyEvents = [];
    for (const { event, props } of buffered) analytics.track(event, props);
    // Browser fallback opens have no trusted Telegram initData and therefore
    // no app_open from AnalyticsClient; don't double-count real Mini App opens.
    // P2-7: не слать fallback сразу — при медленном MAX-мосте настоящий
    // app_open ещё может прийти (гонка: fallback + настоящий = дубль
    // в воронке). Ждём окно моста и проверяем флаг повторно в момент
    // отправки; если настоящий успел — fallback не нужен.
    if (!buffered.some(({ event }) => event === 'app_open') && !appOpenSeen) {
      const client = analytics;
      const fallbackGeneration = generation;
      globalThis.setTimeout(() => {
        if (fallbackGeneration !== analyticsGeneration || appOpenSeen || appOpenFallbackSent) return;
        appOpenFallbackSent = true;
        client.track('app_open', { screen: 'menu' });
      }, appOpenFallbackDelayMs);
    }
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
  if (event === 'app_open') {
    // P2-7: fallback уже посчитал открытие (мост ответил позже окна) —
    // второй app_open в Umami не шлём. Серверный /api/event при этом не
    // затронут: он отправляется отдельным путём в trackProductEvent.
    if (appOpenFallbackSent) return;
  }
  if (webReady) {
    // CR-R3-12: appOpenSeen — только после успешной отправки (track
    // возвращает false, когда Umami недоступен). Иначе открытие
    // потеряется молча, а fallback будет подавлен.
    const sent = analytics.track(event, props);
    if (event === 'app_open' && sent) appOpenSeen = true;
  } else if (earlyEvents.length < MAX_EARLY_EVENTS) {
    earlyEvents.push({ event, props: { ...props } });
    // CR-R3-12: appOpenSeen — только после принятия в буфер. Раньше seen
    // ставился до проверки вместимости: при полном буфере (48 событий)
    // app_open выбрасывался, а fallback подавлялся — сессия оставалась
    // без opening event. Подавление после принятого app_open сохранено.
    if (event === 'app_open') appOpenSeen = true;
  }
  // Буфер полон — событие выброшено, seen не ставится: readiness
  // fallback при готовности Umami пошлёт opening event.
}

export function cosmeticColor(id: string): number {
  return id === 'skin.virulent-magenta' ? 0xff79c6 : id === 'skin.abyssal-teal' ? 0x77e6d2
    : id === 'skin.gilded-prime' ? 0xffd56a : 0xffffff;
}
