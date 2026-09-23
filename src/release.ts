const rawRelease = (import.meta.env.VITE_RELEASE_SHA || 'dev').trim() || 'dev';

export const RELEASE_SHA = rawRelease;
export const RELEASE_SHORT = rawRelease === 'dev' ? 'dev' : rawRelease.slice(0, 7);
export const RELEASE_MARKER = `ofeliya-${rawRelease}`;
