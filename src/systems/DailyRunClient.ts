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

export type DailyTicketStatus =
  | 'ok'
  | 'capacity'
  | 'denied'
  | 'http'
  | 'network'
  | 'unavailable';

export interface DailyRunDetailed {
  ticket: DailyRunTicket | null;
  status: DailyTicketStatus;
}

function endpoint(): string {
  if (typeof window === 'undefined') return 'api/daily/run';
  return new URL('api/daily/run', window.location.href).toString();
}

function parseTicket(body: {
  ok?: boolean;
  ticket?: Partial<DailyRunTicket>;
}): DailyRunTicket | null {
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
}

/**
 * Additive, non-breaking variant of requestDailyRun that also reports why a
 * request did not yield an accepted ticket. A returned ticket is identical to
 * what requestDailyRun would return for the same response.
 */
export async function requestDailyRunDetailed(
  platform: PlatformAdapter
): Promise<DailyRunDetailed> {
  if (
    (platform.kind !== 'max' && platform.kind !== 'telegram') ||
    !platform.initData ||
    typeof fetch === 'undefined'
  ) {
    return { ticket: null, status: 'unavailable' };
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
    if (response.status === 503) return { ticket: null, status: 'capacity' };
    if (response.status === 403) return { ticket: null, status: 'denied' };
    if (!response.ok) return { ticket: null, status: 'http' };
    let body: { ok?: boolean; ticket?: Partial<DailyRunTicket> };
    try {
      body = (await response.json()) as {
        ok?: boolean;
        ticket?: Partial<DailyRunTicket>;
      };
    } catch {
      return { ticket: null, status: 'http' };
    }
    const ticket = parseTicket(body);
    if (!ticket) return { ticket: null, status: 'http' };
    return { ticket, status: 'ok' };
  } catch {
    return { ticket: null, status: 'network' };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function requestDailyRun(
  platform: PlatformAdapter
): Promise<DailyRunTicket | null> {
  const { ticket } = await requestDailyRunDetailed(platform);
  return ticket;
}