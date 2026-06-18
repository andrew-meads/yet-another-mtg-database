/**
 * Picks which physical-card ids a drag should carry.
 *
 * A collection row may hold several copies; the user can dial how many to drag with the
 * row's drag-count control, and holding Alt at drag start forces a single copy. The count
 * is clamped to `1..ids.length` so an out-of-range control value can never produce an empty
 * or oversized drag.
 */
export function dragCountForItem({
  ids,
  count,
  altHeld
}: {
  ids: string[];
  count: number;
  altHeld: boolean;
}): string[] {
  if (ids.length === 0) return [];
  const n = altHeld ? 1 : Math.min(Math.max(Math.floor(count), 1), ids.length);
  return ids.slice(0, n);
}
