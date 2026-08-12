import type { TileStats } from '../types';

/** Consecutive tile-load errors that mean a source is empty/nodata rather than flaky. */
export const EMPTY_TILE_THRESHOLD = 4;

export function emptyTileStats(): TileStats {
  return { errors: 0, successes: 0, empties: 0 };
}

/**
 * A source counts as empty when the tiler explicitly answered "no content" (HTTP 204,
 * which a probe flags as an empty), or when enough tiles failed without a single one
 * ever loading. One success is enough to prove the source has data.
 */
export function classifyEmpty(stats: TileStats): boolean {
  if (stats.empties > 0) return true;
  return stats.successes === 0 && stats.errors >= EMPTY_TILE_THRESHOLD;
}
