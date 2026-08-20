import { useSyncExternalStore } from 'react';
import type MVT from 'ol/format/MVT';
import type ImageTile from 'ol/ImageTile';
import type { Projection } from 'ol/proj';
import type RenderFeature from 'ol/render/Feature';
import type { LoadFunction } from 'ol/Tile';
import type Tile from 'ol/Tile';
import TileLayer from 'ol/layer/Tile';
import type CanvasTileLayerRenderer from 'ol/renderer/canvas/TileLayer';
import VectorTileSource from 'ol/source/VectorTile';
import XYZ from 'ol/source/XYZ';
import TileState from 'ol/TileState';
import type VectorTile from 'ol/VectorTile';
import { unByKey } from 'ol/Observable';
import { ensureTilerSession } from '~/api/tilerToken';
import { authManager } from '~/features/auth/index';
import { isProxiedTileUrl } from '../campaign/tileUrls';

export type CrossOrigin = 'anonymous' | 'use-credentials';

/** True for one of our titiler-pgstac tilers, which need cookie auth.
 *  `provider` is "mpc" for MPC-direct, null for a direct URL, or a configured
 *  tiler name for ours. */
export function isSelfHostedTiler(provider?: string | null): boolean {
  return !!provider && provider !== 'mpc';
}

/** Credentialed for our self-hosted tilers and for our backend key-proxy URLs
 *  (both authenticate via the tiler cookie); anonymous for MPC and public. */
export function crossOriginForTile(url: string, provider?: string | null): CrossOrigin {
  return isProxiedTileUrl(url) || isSelfHostedTiler(provider) ? 'use-credentials' : 'anonymous';
}

/** Only credentialed sources need the cookie; MPC and public tiles need nothing. */
export function ensureSessionFor(crossOrigin: string | null): Promise<void> {
  return crossOrigin === 'use-credentials' ? ensureTilerSession() : Promise.resolve();
}

/**
 * Tile loader for active-layer imagery. Requests at high priority so tiles the
 * user is waiting on are not starved by background preloads, which request at
 * low. The cookie rides along automatically; this only makes sure it is fresh.
 */
export const foregroundTileLoader: LoadFunction = (tile, src) => {
  const image = (tile as ImageTile).getImage() as HTMLImageElement;
  image.fetchPriority = 'high';
  // A failed refresh still attempts the tile: the existing cookie may be fine,
  // and OL's own error handling is the right place for a real auth failure.
  const load = () => {
    image.src = src;
  };
  ensureSessionFor(image.crossOrigin).then(load, load);
};

/**
 * Loader for MVT served by our own API. OpenLayers fetches vector tiles itself
 * and sends neither the bearer token nor the cookie, so without this every tile
 * comes back 401 and the layer renders nothing at all.
 */
export function bearerVectorTileLoader(format: MVT): LoadFunction {
  return (tile, url) => {
    const vectorTile = tile as VectorTile<RenderFeature>;
    vectorTile.setLoader(async (extent, _resolution, projection) => {
      try {
        const token = await authManager.getIdToken();
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`Tile request failed: ${response.status}`);
        const features = format.readFeatures(await response.arrayBuffer(), {
          extent,
          featureProjection: projection as Projection,
        });
        vectorTile.setFeatures(features);
        return features;
      } catch {
        vectorTile.onError();
        return [];
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Error recovery. OpenLayers keeps an errored tile terminal for the life of its
// source, which presents as a permanent white square.
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [250, 1_000] as const;
const attempts = new WeakMap<Tile, number>();
const detachByLayer = new WeakMap<TileLayer<XYZ>, () => void>();

function retry(tile: Tile): void {
  if (tile.getState() !== TileState.ERROR) return;
  const attempt = attempts.get(tile) ?? 0;
  if (attempt >= RETRY_DELAYS_MS.length) return;
  attempts.set(tile, attempt + 1);
  tile.load();
}

/** Recovers transient foreground failures without letting hidden dates carry
 *  on fetching. */
export function attachTileErrorRecovery(layer: TileLayer<XYZ>): void {
  detachTileErrorRecovery(layer);
  const source = layer.getSource();
  if (!source) return;

  const errorKey = source.on('tileloaderror', ({ tile }) => {
    const attempt = attempts.get(tile) ?? 0;
    if (attempt >= RETRY_DELAYS_MS.length) return;
    window.setTimeout(() => {
      if (layer.getVisible() && layer.getSource() === source) retry(tile);
    }, RETRY_DELAYS_MS[attempt]);
  });
  const endKey = source.on('tileloadend', ({ tile }) => attempts.delete(tile));
  detachByLayer.set(layer, () => {
    unByKey([errorKey, endKey]);
    detachByLayer.delete(layer);
  });
}

export function detachTileErrorRecovery(layer: TileLayer<XYZ>): void {
  detachByLayer.get(layer)?.();
}

/** Retry terminal tiles when a retained date becomes visible again. */
export function retryErroredTiles(layer: TileLayer<XYZ>): void {
  if (!layer.hasRenderer()) return;
  const renderer = layer.getRenderer() as CanvasTileLayerRenderer;
  let retried = false;
  renderer.getTileCache().forEach((tile: Tile) => {
    if (tile.getState() !== TileState.ERROR) return;
    // A new visibility episode gets a fresh retry budget.
    attempts.delete(tile);
    retry(tile);
    retried = true;
  });
  if (retried) layer.changed();
}

// ---------------------------------------------------------------------------
// Source pool: share one OL tile cache, and one request per tile, wherever the
// same tiles are on screen more than once. A campaign can have a hundred
// imagery windows open, all drawing the same annotations over their own date -
// unshared, that is a hundred requests for every tile.
// ---------------------------------------------------------------------------

type SharedSource = XYZ | VectorTileSource<RenderFeature>;

const pool = new Map<string, { source: SharedSource; users: number }>();

function acquire(key: string, create: () => SharedSource): SharedSource {
  const existing = pool.get(key);
  if (existing) {
    existing.users++;
    return existing.source;
  }
  const source = create();
  pool.set(key, { source, users: 1 });
  return source;
}

/** Keys are prefixed per kind, so a pooled source is always the kind its key
 *  says. The check is what makes that a fact rather than an assumption. */
function pooled<T extends SharedSource>(
  key: string,
  create: () => T,
  isKind: (source: SharedSource) => source is T
): T {
  const source = acquire(key, create);
  if (!isKind(source)) throw new Error(`Pooled source ${key} is not of the requested kind`);
  return source;
}

export const acquireRasterSource = (key: string, create: () => XYZ): XYZ =>
  pooled(key, create, (source): source is XYZ => source instanceof XYZ);

export const acquireVectorTileSource = (
  key: string,
  create: () => VectorTileSource<RenderFeature>
): VectorTileSource<RenderFeature> =>
  pooled(
    key,
    create,
    (source): source is VectorTileSource<RenderFeature> => source instanceof VectorTileSource
  );

export function releaseSource(key: string): void {
  const entry = pool.get(key);
  if (!entry) return;
  entry.users--;
  if (entry.users === 0) pool.delete(key);
}

// ---------------------------------------------------------------------------
// Foreground load tracking, so speculative preloading can stand aside while
// the user is waiting on something.
// ---------------------------------------------------------------------------

const loadingMaps = new Set<string>();
const loadListeners = new Set<() => void>();

/** Idempotent, and unmounting callers clear their id so a vanished panel
 *  cannot leave preloading paused forever. */
export function setForegroundMapLoading(mapId: string, loading: boolean): void {
  if (loading === loadingMaps.has(mapId)) return;
  if (loading) loadingMaps.add(mapId);
  else loadingMaps.delete(mapId);
  for (const listener of loadListeners) listener();
}

export function isForegroundLoading(): boolean {
  return loadingMaps.size > 0;
}

function subscribeForegroundLoading(onChange: () => void): () => void {
  loadListeners.add(onChange);
  return () => {
    loadListeners.delete(onChange);
  };
}

export function useForegroundLoading(): boolean {
  return useSyncExternalStore(subscribeForegroundLoading, isForegroundLoading, isForegroundLoading);
}
