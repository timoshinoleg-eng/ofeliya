/** Experimental QA runs never submit canonical scores or duel results. */
export function isQaExperimentMode(): boolean {
  if (import.meta.env.VITE_QA_TOOLS !== '1' || typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('qaGeometry') === '1' || params.get('qaCarry') === 'multi' ||
    params.get('qaVideos') === 'h3' || ['titan-candidate', 'carry-pair'].includes(params.get('qa') ?? '');
}
