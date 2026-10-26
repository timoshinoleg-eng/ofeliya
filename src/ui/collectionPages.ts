/**
 * OFELIYA — collection pagination arithmetic.
 *
 * Pure: no Phaser, no scene, no state. The collection board owns the layout,
 * this module owns the arithmetic, so the "one page needs no paginator" rule can
 * be asserted on its own.
 */

/** Number of pages a list of `total` items occupies with `pageSize` items per page. */
export function collectionPageCount(total: number, pageSize: number): number {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const safeSize = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 1;
  return Math.max(1, Math.ceil(safeTotal / safeSize));
}

/**
 * A paginator is shown only when the list does not fit on one page.
 *
 * One page needs no paginator: the controls would be dead.
 */
export function shouldShowPaginator(total: number, pageSize: number): boolean {
  return collectionPageCount(total, pageSize) > 1;
}
