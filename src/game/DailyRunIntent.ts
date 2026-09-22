import type { PlatformAdapter } from '../platform/PlatformBridge';
import { requestDailyRunDetailed, type DailyRunTicket, type DailyTicketStatus } from '../systems/DailyRunClient';
import { RunCheckpoint } from '../systems/RunCheckpoint';

/**
 * Daily run intent (SLICE-DAILY-CTA-A).
 *
 * Single owner of the in-memory daily intent marker and the atomic launch write.
 * The marker deliberately lives in a key SEPARATE from `runSeedOverride`: a run that
 * merely carries a seed override (ordinary replay / duel) must never be treated as a
 * daily run, and a daily run must never fall through to the ordinary ranked path.
 *
 * This module is presentation-free: no Phaser import and no player-facing string.
 */

export const DAILY_INTENT_KEY = 'dailyIntent';
export const DAILY_TICKET_KEY = 'dailyTicket';

export interface DailyIntent {
  runId: string;
}

/** Minimal in-memory key/value store shape (matches Phaser's `DataManager` registry). */
export interface RegistryLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

function isDailyIntent(value: unknown): value is DailyIntent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { runId?: unknown }).runId === 'string'
  );
}

/**
 * Returns the daily intent marker when a daily launch is pending, otherwise `null`.
 * Anything that is not a well-formed marker is treated as "no daily intent".
 */
export function readDailyIntent(registry: RegistryLike): DailyIntent | null {
  const value = registry.get(DAILY_INTENT_KEY);
  return isDailyIntent(value) ? { runId: value.runId } : null;
}

/** Clears both the intent marker and the ticket in a single call. */
export function clearDailyIntent(registry: RegistryLike): void {
  registry.remove(DAILY_INTENT_KEY);
  registry.remove(DAILY_TICKET_KEY);
}

/**
 * Atomic daily launch. Either the whole registry block is written on an accepted
 * ticket, or the registry is left byte-untouched on every failure path.
 */
export async function launchDailyRun({
  registry,
  platform,
}: {
  registry: RegistryLike;
  platform: PlatformAdapter;
}): Promise<DailyTicketStatus> {
  const { ticket, status } = await requestDailyRunDetailed(platform);
  // Fail-closed: a non-ok ticket status must never leave partial registry state behind.
  if (status !== 'ok' || !ticket) return status;

  registry.set(DAILY_TICKET_KEY, ticket);
  registry.set(DAILY_INTENT_KEY, { runId: ticket.runId } satisfies DailyIntent);
  registry.set('runSeedOverride', ticket.runSeed);
  registry.set('difficultyId', 'standard');
  registry.set('duelChallenge', null);
  // A daily run is never resumable (option 1: no checkpoint), so no stale ordinary
  // checkpoint may be carried into it.
  RunCheckpoint.clear();
  registry.remove('runCheckpointResume');
  return 'ok';
}

export type DailyResultBranch = 'resumed' | 'daily' | 'blocked' | 'inactive';

/**
 * Pure decision for `UIScene.renderGameOver`. Guarantees that a pending daily intent
 * can only resolve to `'daily'` (detailed submission) or `'blocked'` (submit nothing) -
 * never to the ordinary path.
 */
export function resolveDailyResultBranch(input: {
  resumed: boolean;
  dailyIntent: DailyIntent | null;
  ticket: DailyRunTicket | null;
  runSeed: string;
  now: number;
}): DailyResultBranch {
  if (input.resumed) return 'resumed';
  if (input.dailyIntent === null) return 'inactive';
  const ticket = input.ticket;
  if (
    !ticket ||
    ticket.runId !== input.dailyIntent.runId ||
    ticket.runSeed !== input.runSeed ||
    input.now >= ticket.expiresAt
  ) {
    return 'blocked';
  }
  return 'daily';
}

/** Option 1: daily runs never checkpoint; ordinary runs keep the existing behaviour. */
export function shouldCheckpoint(isDailyRun: boolean): boolean {
  return !isDailyRun;
}