/**
 * Custom tile load function for self-hosted tiler tiles only.
 * Appends HMAC auth token as a query parameter.
 */
import type ImageTile from 'ol/ImageTile';
import { getTilerToken } from '~/api/tilerToken';

export const TILER_BASE =
  import.meta.env.VITE_TILER_BASE_URL || import.meta.env.VITE_API_BASE_URL || '';

/** Returns true if the URL points to the self-hosted tiler (needs auth). */
export function isSelfHostedUrl(url: string): boolean {
  return !!TILER_BASE && url.startsWith(TILER_BASE);
}

export function tileLoadWithAuth(tile: ImageTile, src: string): void {
  const img = tile.getImage() as HTMLImageElement;
  getTilerToken()
    .then((token) => {
      const sep = src.includes('?') ? '&' : '?';
      img.src = `${src}${sep}token=${encodeURIComponent(token)}`;
    })
    .catch(() => {
      img.src = '';
    });
}
