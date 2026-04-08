/**
 * Custom tile load function that appends auth tokens only to self-hosted
 * tiler requests. External providers (MPC etc.) load directly.
 */
import type ImageTile from 'ol/ImageTile';
import { getTilerToken } from '~/api/tilerToken';

const TILER_BASE = import.meta.env.VITE_TILER_BASE_URL || import.meta.env.VITE_API_BASE_URL || '';

export function tileLoadWithAuth(tile: ImageTile, src: string): void {
  const img = tile.getImage() as HTMLImageElement;

  if (!TILER_BASE || !src.startsWith(TILER_BASE)) {
    img.src = src;
    return;
  }

  getTilerToken()
    .then((token) => {
      const sep = src.includes('?') ? '&' : '?';
      img.src = `${src}${sep}token=${encodeURIComponent(token)}`;
    })
    .catch(() => {
      img.src = '';
    });
}
