const configuredRelease = (import.meta.env.VITE_RELEASE_SHA || '').trim();

if (import.meta.env.PROD && !/^[0-9a-f]{40}$/i.test(configuredRelease)) {
  throw new Error('Production build requires VITE_RELEASE_SHA as a 40-character git SHA');
}

const rawRelease = configuredRelease || 'dev';

export const RELEASE_SHA = rawRelease;
export const RELEASE_SHORT = rawRelease === 'dev' ? 'dev' : rawRelease.slice(0, 7);
export const RELEASE_MARKER = `ofeliya-${rawRelease}`;
