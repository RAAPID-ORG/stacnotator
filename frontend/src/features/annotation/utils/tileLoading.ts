/**
 * Tile URL construction + auth-aware load function shared by every OL/Leaflet
 * surface that renders tiles. Backend bakes viz params into the URL at
 * registration time; the frontend just prefixes the tiler base for
 * self-hosted tiles and appends an HMAC token when the tile is fetched.
 */
import type ImageTile from 'ol/ImageTile';
import { getTilerToken } from '~/api/tilerToken';

export const TILER_BASE =
  import.meta.env.VITE_TILER_BASE_URL || import.meta.env.VITE_API_BASE_URL || '';

export interface TileUrlEntry {
  tile_url: string;
  tile_provider?: string | null;
}

/** Prefix self-hosted tile URLs with the tiler base; pass third-party URLs through. */
export function buildTileUrl(tileUrl: TileUrlEntry): string {
  if (tileUrl.tile_provider === 'self_hosted') {
    return `${TILER_BASE}${tileUrl.tile_url}`;
  }
  return tileUrl.tile_url;
}

/** Returns true if the URL points to the self-hosted tiler (and therefore needs auth). */
export function isSelfHostedUrl(url: string): boolean {
  return !!TILER_BASE && url.startsWith(TILER_BASE);
}

/**
 * OL tile load function for active-layer imagery. Hints the browser to fetch
 * with high priority so user-initiated pan/zoom tiles aren't starved by
 * background preloads (which set fetchPriority='low'). Appends the HMAC
 * token for self-hosted tiles; for third-party tiles just sets src.
 */
export function tileLoadImagery(tile: ImageTile, src: string): void {
  const img = tile.getImage() as HTMLImageElement;
  img.fetchPriority = 'high';
  if (isSelfHostedUrl(src)) {
    getTilerToken()
      .then((token) => {
        const sep = src.includes('?') ? '&' : '?';
        img.src = `${src}${sep}token=${encodeURIComponent(token)}`;
      })
      .catch(() => {
        img.src = '';
      });
  } else {
    img.src = src;
  }
}
