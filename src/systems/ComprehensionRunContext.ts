import { isAnalyticsRunId } from './AnalyticsRunId';
import type { ProductEventProps } from './AnalyticsClient';

export interface ComprehensionRunMetadata {
  analyticsRunId: string | null;
  runTimeMs: number;
  firstRun: boolean;
  release: string;
}

const RESERVED_FIELDS = new Set(['analyticsRunId', 'runTimeMs', 'firstRun', 'release']);

/** Resume identity is accepted only when it belongs to the exact checkpoint seed. */
export function restoreAnalyticsRunId(
  runSeed: string,
  storedRunSeed: unknown,
  storedAnalyticsRunId: unknown
): string | null {
  return storedRunSeed === runSeed && isAnalyticsRunId(storedAnalyticsRunId)
    ? storedAnalyticsRunId
    : null;
}

/** Metadata is authoritative and first; comprehension domain props are capped at four. */
export function buildComprehensionEventProps(
  domainProps: ProductEventProps,
  metadata: ComprehensionRunMetadata
): ProductEventProps {
  const output: ProductEventProps = {};
  if (isAnalyticsRunId(metadata.analyticsRunId)) output.analyticsRunId = metadata.analyticsRunId;
  output.runTimeMs = Number.isFinite(metadata.runTimeMs) ? Math.max(0, Math.round(metadata.runTimeMs)) : 0;
  output.firstRun = metadata.firstRun;
  output.release = metadata.release;

  let domainFields = 0;
  for (const [key, value] of Object.entries(domainProps)) {
    if (RESERVED_FIELDS.has(key) || domainFields >= 4) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    output[key] = value;
    domainFields += 1;
  }
  return output;
}
