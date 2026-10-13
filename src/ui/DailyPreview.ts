import { dailyMutatorForDate } from '../game/DailyMutator';
import type { DailySnapshot } from '../systems/SocialClient';

/** Never guess a server challenge from the device's calendar or clock. */
export function dailyPreviewTitle(daily: DailySnapshot | null): string {
  // dateKey is the date of the player's latest result, which may be weeks old.
  const dateKey = daily?.challengeDateKey;
  if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return 'МУТАТОР УТОЧНИТСЯ ПЕРЕД СТАРТОМ';
  }
  return dailyMutatorForDate(dateKey).title.replace('МУТАТОР ДНЯ · ', '');
}

/** Relative server duration avoids a fast/slow device clock at midnight. */
export function dailyPreviewRefreshDelay(daily: DailySnapshot | null): number {
  const { serverTime, nextDayAt } = daily ?? {};
  if (!Number.isFinite(serverTime) || !Number.isFinite(nextDayAt)) return 60_000;
  return Math.max(100, Math.min(86_400_000, nextDayAt! - serverTime! + 100));
}
