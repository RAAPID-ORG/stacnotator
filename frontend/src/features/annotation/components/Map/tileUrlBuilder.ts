/**
 * Tile URL construction for different tile providers.
 *
 * Viz params are baked into the tile_url by the backend at registration time.
 * The frontend only prepends the tiler base URL for self_hosted tiles.
 */

const TILER_BASE = import.meta.env.VITE_TILER_BASE_URL || import.meta.env.VITE_API_BASE_URL || '';

export interface TileUrlEntry {
  tile_url: string;
  tile_provider?: string | null;
}

export function buildTileUrl(tileUrl: TileUrlEntry): string {
  if (tileUrl.tile_provider === 'self_hosted') {
    return `${TILER_BASE}${tileUrl.tile_url}`;
  }
  return tileUrl.tile_url;
}
