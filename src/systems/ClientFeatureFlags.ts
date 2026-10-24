export interface ClientFeatureFlags {
  readonly skins: { readonly gallery: boolean };
  readonly collection: { readonly enabled: boolean };
  readonly juice: { readonly enhanced: boolean };
  readonly telemetry: { readonly web: boolean };
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
});

const OVERRIDABLE_FLAGS = Object.freeze({
  'skins.gallery': ['skins', 'gallery'],
  'collection.enabled': ['collection', 'enabled'],
  'juice.enhanced': ['juice', 'enhanced'],
  'telemetry.web': ['telemetry', 'web'],
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
  };

  if (options.qaTools === true && typeof options.search === 'string') {
    const params = new URLSearchParams(options.search.startsWith('?') ? options.search.slice(1) : options.search);
    for (const [key, path] of Object.entries(OVERRIDABLE_FLAGS)) {
      const value = params.get(`flag.${key}`);
      if (value !== 'true' && value !== 'false') continue;
      const [section, flag] = path;
      (result[section] as Record<string, boolean>)[flag] = value === 'true';
    }
  }

  return Object.freeze({
    skins: Object.freeze(result.skins),
    collection: Object.freeze(result.collection),
    juice: Object.freeze(result.juice),
    telemetry: Object.freeze(result.telemetry),
  });
}
