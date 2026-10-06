const ANALYTICS_RUN_ID_BYTES = 16;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX32_PATTERN = /^[0-9a-f]{32}$/;

function cryptoSource(): Crypto | null {
  try {
    const source = globalThis.crypto;
    return source && typeof source.getRandomValues === 'function' ? source : null;
  } catch {
    // Hardened WebViews may expose a throwing crypto getter; telemetry must fail soft.
    return null;
  }
}

/**
 * Mints one cryptographically random correlation id for a single attempt.
 * It is deliberately independent of RunRng: consuming gameplay RNG here would shift
 * checkpointed gameplay streams, and a math.random fallback would be predictable.
 * Returns null when the host exposes no usable WebCrypto API; callers must fail soft.
 */
export function createAnalyticsRunId(source: Crypto | null = cryptoSource()): string | null {
  if (!source || typeof source.getRandomValues !== 'function') return null;
  try {
    if (typeof source.randomUUID === 'function') {
      const uuid = source.randomUUID();
      if (isAnalyticsRunId(uuid)) return uuid;
    }
  } catch {
    // Some hardened webviews expose randomUUID but throw when called; use getRandomValues.
  }
  try {
    const bytes = source.getRandomValues(new Uint8Array(ANALYTICS_RUN_ID_BYTES));
    let hex = '';
    for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
    return isAnalyticsRunId(hex) ? hex : null;
  } catch {
    return null;
  }
}

export function isAnalyticsRunId(value: unknown): value is string {
  return typeof value === 'string' && (UUID_PATTERN.test(value) || HEX32_PATTERN.test(value));
}
