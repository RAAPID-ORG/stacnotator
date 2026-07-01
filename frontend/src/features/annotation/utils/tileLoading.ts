/**
 * Tile URL helpers + auth-aware load function shared by every OL surface that renders
 * tiles. The backend bakes viz params into an absolute tile URL at registration time and
 * authenticates via a cookie (set by `ensureTilerSession`), so the frontend neither
 * prefixes a base nor appends a token. Our tiler sources use `crossOrigin: 'use-credentials'`
 * so the browser sends the cookie; MPC/public sources stay `anonymous`.
 */
import type ImageTile from 'ol/ImageTile';
import { ensureTilerSession } from '~/api/tilerToken';
import { isProxiedTileUrl } from './proxyTile';

/**
 * True for one of our titiler-pgstac tilers (cookie auth required). `tile_provider` is
 * "mpc" for MPC-direct, null for a manual/direct URL, or a configured tiler name for ours.
 */
export function isSelfHostedTiler(provider?: string | null): boolean {
  return !!provider && provider !== 'mpc';
}

/** crossOrigin for an OL tile source: credentialed for our tilers, anonymous otherwise. */
export function crossOriginFor(provider?: string | null): 'anonymous' | 'use-credentials' {
  return isSelfHostedTiler(provider) ? 'use-credentials' : 'anonymous';
}

/**
 * crossOrigin for a resolved tile URL: credentialed for our self-hosted tilers AND for our
 * backend key-proxy URLs (both authenticate via the tiler cookie); anonymous for MPC/public.
 */
export function crossOriginForTile(
  url: string,
  provider?: string | null
): 'anonymous' | 'use-credentials' {
  return isProxiedTileUrl(url) || isSelfHostedTiler(provider) ? 'use-credentials' : 'anonymous';
}

/**
 * Resolve once the tiler cookie is fresh, but only for credentialed (our-tiler) sources;
 * MPC/public tiles need nothing. The single place that maps a source's crossOrigin mode to
 * "needs the tiler session", shared by the active-layer loader and the preloader.
 */
export function ensureSessionFor(crossOrigin: string | null): Promise<void> {
  return crossOrigin === 'use-credentials' ? ensureTilerSession() : Promise.resolve();
}

/**
 * OL tile load function for active-layer imagery. Hints the browser to fetch with high
 * priority so user-initiated pan/zoom tiles aren't starved by background preloads. Auth is
 * via the tiler cookie (sent automatically because the source uses 'use-credentials'); we
 * just make sure the cookie is fresh before issuing the request.
 */
export function tileLoadImagery(tile: ImageTile, src: string): void {
  const img = tile.getImage() as HTMLImageElement;
  img.fetchPriority = 'high';
  ensureSessionFor(img.crossOrigin).finally(() => {
    img.src = src;
  });
}
