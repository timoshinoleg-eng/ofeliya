export interface ClientFeatureFlags {
  readonly skins: { readonly gallery: boolean };
  readonly collection: { readonly enabled: boolean };
  readonly juice: { readonly enhanced: boolean };
  readonly telemetry: { readonly web: boolean };
  /** Ported Phase 2: «double RNA» event — all gem drops x2. Default false. */
  readonly events: { readonly doubleRna: boolean };
  /** Ported Phase 2: early-run difficulty scale for the first 3 minutes (1 = authored). */
  readonly difficulty: { readonly earlyGame: number };
}

export interface ResolveClientFlagsOptions {
  /** Pass true only when the build explicitly enables VITE_QA_TOOLS. */
  qaTools?: boolean;
  /** Location search string, normally window.location.search. */
  search?: string;
}

const DEFAULT_FLAGS: ClientFeatureFlags = Object.freeze({
  skins: Object.freeze({ gallery: true }),
  collection: Object.freeze({ enabled: true }),
  juice: Object.freeze({ enhanced: true }),
  telemetry: Object.freeze({ web: false }),
  events: Object.freeze({ doubleRna: false }),
  difficulty: Object.freeze({ earlyGame: 1 }),
});

const OVERRIDABLE_FLAGS = Object.freeze({
  'skins.gallery': ['skins', 'gallery'],
  'collection.enabled': ['collection', 'enabled'],
  'juice.enhanced': ['juice', 'enhanced'],
  'telemetry.web': ['telemetry', 'web'],
  'events.doubleRna': ['events', 'doubleRna'],
} as const);

/** Numeric `?flag.` overrides (boolean table above cannot express them). */
const NUMERIC_OVERRIDES = Object.freeze({
  /** Ported Phase 2: early-run difficulty scale, 0 < n <= 10. */
  'difficulty.earlyGame': { section: 'difficulty', flag: 'earlyGame', min: 0, max: 10 },
} as const);

/**
 * Resolve safe, presentation-only client flags. Query overrides are a QA tool
 * and stay inert unless the caller passes the explicit build-time QA switch.
 */
export function resolveClientFlags(options: ResolveClientFlagsOptions = {}): ClientFeatureFlags {
  const result = {
    skins: { gallery: DEFAULT_FLAGS.skins.gallery },
    collection: { enabled: DEFAULT_FLAGS.collection.enabled },
    juice: { enhanced: DEFAULT_FLAGS.juice.enhanced },
    telemetry: { web: DEFAULT_FLAGS.telemetry.web },
    events: { doubleRna: DEFAULT_FLAGS.events.doubleRna },
    difficulty: { earlyGame: DEFAULT_FLAGS.difficulty.earlyGame },
  };

  if (options.qaTools === true && typeof options.search === 'string') {
    const params = new URLSearchParams(options.search.startsWith('?') ? options.search.slice(1) : options.search);
    for (const [key, path] of Object.entries(OVERRIDABLE_FLAGS)) {
      const value = params.get(`flag.${key}`);
      if (value !== 'true' && value !== 'false') continue;
      const [section, flag] = path;
      (result[section] as Record<string, boolean>)[flag] = value === 'true';
    }
    for (const [key, spec] of Object.entries(NUMERIC_OVERRIDES)) {
      const raw = params.get(`flag.${key}`);
      if (raw === null) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n > spec.min && n <= spec.max) {
        (result[spec.section] as Record<string, number>)[spec.flag] = n;
      }
    }
  }

  return Object.freeze({
    skins: Object.freeze(result.skins),
    collection: Object.freeze(result.collection),
    juice: Object.freeze(result.juice),
    telemetry: Object.freeze(result.telemetry),
    events: Object.freeze(result.events),
    difficulty: Object.freeze(result.difficulty),
  });
}
