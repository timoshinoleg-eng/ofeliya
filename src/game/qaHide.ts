/**
 * QA render-split group selection — pure, node-testable parsing of the
 * ?qaHide= query parameter.
 *
 * Usage (QA builds only, same gate as the perf overlay — dev or
 * VITE_QA_TOOLS=1, see GameScene.create): open the game with
 *   ?qaHide=gems,atmo,ui
 * Groups are comma-separated; unknown tokens are ignored; the parameter may
 * repeat (?qaHide=gems&qaHide=ui). An empty selection means "hide nothing"
 * (the base run).
 *
 * Groups (what each one hides — visibility ONLY, nothing is destroyed and
 * nothing stops updating, so the measurement isolates render cost, not
 * logic cost):
 * - gems: the gem pool (GameScene.gems). Gems respawn visible
 *   (Gem.activate re-shows via enableBody), so GameScene re-hides them
 *   every active frame while this group is selected.
 * - atmo: the atmosphere dressing (AtmosphereSystem: plasma + structure
 *   TileSprites, pulse overlay, erythrocyte/host-cell/particle images) plus
 *   the GameScene vignette image. Atmosphere re-shows itself on stage
 *   change, pulse and governor updates, so AtmosphereSystem re-hides
 *   itself while its QA flag is set.
 * - ui: the whole UIScene (scene visibility flag). The UI scene keeps
 *   updating — only its pixels disappear. The QA overlay Text lives in
 *   GameScene, so hiding the UI scene never hides the overlay.
 *
 * This module never reads the build-time env flag: the gate lives in the caller
 * (GameScene.create), exactly like qaPerf.ts, so the pure parts stay
 * node-testable.
 */

export type QaHideGroup = 'gems' | 'atmo' | 'ui';

export const QA_HIDE_GROUPS: readonly QaHideGroup[] = ['gems', 'atmo', 'ui'];

/** Parse a query string (with or without leading '?') into hidden groups. */
export function parseQaHide(search: string): ReadonlySet<QaHideGroup> {
  const out = new Set<QaHideGroup>();
  if (!search) return out;
  const params = new URLSearchParams(search);
  for (const raw of params.getAll('qaHide')) {
    for (const token of raw.split(',')) {
      const t = token.trim().toLowerCase();
      if (t === 'gems' || t === 'atmo' || t === 'ui') out.add(t);
    }
  }
  return out;
}

/** Canonical label for the overlay: 'none' or groups in fixed order. */
export function qaHideLabel(hide: ReadonlySet<QaHideGroup>): string {
  if (hide.size === 0) return 'none';
  return QA_HIDE_GROUPS.filter((g) => hide.has(g)).join(',');
}

/**
 * Toggle one group in the current selection (pure, node-testable). Used by
 * the in-fight toggle buttons in GameScene: ?qaHide= only sets the initial
 * state, buttons flip groups from there without a reload. Returns a new set;
 * the input is never mutated.
 */
export function toggleQaHide(current: ReadonlySet<QaHideGroup>, group: QaHideGroup): ReadonlySet<QaHideGroup> {
  const next = new Set(current);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}
