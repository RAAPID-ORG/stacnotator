import type { LoadFunction } from 'ol/Tile';
import type ImageTile from 'ol/ImageTile';

export type CrossOrigin = 'anonymous' | 'use-credentials';

let proxiedTileMatcher: (url: string) => boolean = () => false;

/**
 * Register how to recognise a backend tile-proxy URL. Those ride the tiler cookie exactly
 * like a self-hosted tiler, but their route shape belongs to the app, not to the map engine.
 * Unregistered, nothing is treated as proxied.
 */
export function setProxiedTileMatcher(match: (url: string) => boolean): void {
  proxiedTileMatcher = match;
}

export function isProxiedTileUrl(url: string): boolean {
  return proxiedTileMatcher(url);
}

/**
 * True for one of our titiler-pgstac tilers (cookie auth required). `tileProvider` is
 * "mpc" for MPC-direct, null for a manual/direct URL, or a configured tiler name for ours.
 */
export function isSelfHostedTiler(provider?: string | null): boolean {
  return !!provider && provider !== 'mpc';
}

/** crossOrigin for an OL tile source: credentialed for our tilers, anonymous otherwise. */
export function crossOriginFor(provider?: string | null): CrossOrigin {
  return isSelfHostedTiler(provider) ? 'use-credentials' : 'anonymous';
}

/**
 * crossOrigin for a resolved tile URL: credentialed for our self-hosted tilers AND for our
 * backend key-proxy URLs (both authenticate via the tiler cookie); anonymous for MPC/public.
 */
export function crossOriginForTile(url: string, provider?: string | null): CrossOrigin {
  return isProxiedTileUrl(url) || isSelfHostedTiler(provider) ? 'use-credentials' : 'anonymous';
}

let tokenRefresher: () => Promise<void> = () => Promise.resolve();

/**
 * Minting the tiler cookie is an app concern (it needs the api client), and platform
 * code cannot reach it, so the app registers the refresher once at startup. Layers
 * built by olLayerFactory have no other way to receive it.
 */
export function setTilerTokenRefresher(refresh: () => Promise<void>): void {
  tokenRefresher = refresh;
}

export function refreshTilerSession(): Promise<void> {
  return tokenRefresher();
}

/**
 * Resolve once the tiler cookie is fresh, but only for credentialed (our-tiler) sources;
 * MPC/public tiles need nothing. The single place that maps a source's crossOrigin mode to
 * "needs the tiler session", shared by the active-layer loader and the preloader.
 */
export function ensureSessionFor(
  crossOrigin: string | null,
  refreshToken?: () => Promise<void>
): Promise<void> {
  return crossOrigin === 'use-credentials' && refreshToken ? refreshToken() : Promise.resolve();
}

/**
 * OL tile load function for active-layer imagery. Hints the browser to fetch with high
 * priority so user-initiated pan/zoom tiles aren't starved by background preloads (which
 * request at 'low'). The cookie is sent automatically because the source uses
 * 'use-credentials'; we only make sure it is fresh before issuing the request.
 */
export function foregroundTileLoader(refreshToken: () => Promise<void>): LoadFunction {
  return (tile, src) => {
    const image = (tile as ImageTile).getImage() as HTMLImageElement;
    image.fetchPriority = 'high';
    // A failed refresh still attempts the tile: the existing cookie may be fine,
    // and OL's own error handling is the right place for a real auth failure.
    const load = () => {
      image.src = src;
    };
    ensureSessionFor(image.crossOrigin, refreshToken).then(load, load);
  };
}
