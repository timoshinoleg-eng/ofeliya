import type { PlatformAdapter } from '../platform/PlatformBridge';

const DAILY_RUN_TIMEOUT_MS = 2500;

export interface DailyRunTicket {
  runId: string;
  runSeed: string;
  dateKey: string;
  issuedAt: number;
  expiresAt: number;
  difficultyId: 'standard';
  rulesetVersion: number;
  campaignVersion: number;
}

function endpoint(): string {
  if (typeof window === 'undefined') return 'api/daily/run';
  return new URL('api/daily/run', window.location.href).toString();
}

export async function requestDailyRun(
  platform: PlatformAdapter
): Promise<DailyRunTicket | null> {
  if (
    (platform.kind !== 'max' && platform.kind !== 'telegram') ||
    !platform.initData ||
    typeof fetch === 'undefined'
  ) {
    return null;
  }

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), DAILY_RUN_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: platform.kind,
        initData: platform.initData,
      }),
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      ok?: boolean;
      ticket?: Partial<DailyRunTicket>;
    };
    const ticket = body.ticket;
    if (
      body.ok !== true ||
      !ticket ||
      typeof ticket.runId !== 'string' ||
      typeof ticket.runSeed !== 'string' ||
      typeof ticket.dateKey !== 'string' ||
      typeof ticket.issuedAt !== 'number' ||
      typeof ticket.expiresAt !== 'number' ||
      ticket.difficultyId !== 'standard' ||
      typeof ticket.rulesetVersion !== 'number' ||
      typeof ticket.campaignVersion !== 'number'
    ) {
      return null;
    }
    return ticket as DailyRunTicket;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
