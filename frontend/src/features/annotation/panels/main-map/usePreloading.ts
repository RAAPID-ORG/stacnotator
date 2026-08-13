import { useEffect, useRef } from 'react';
import {
  collectionsInView,
  emptyKey,
  layerSpecFor,
  type Catalog,
  type SliceAddress,
} from '~/features/annotation/core/catalog';
import { useImageryStore, usePrefsStore, type PreloadTier } from '~/features/annotation/stores';
import { mainCamera } from '~/features/annotation/shared/cameras';
import {
  TilePreloader,
  type Bbox,
  type LonLat,
  type PreloadJob,
} from '~/features/annotation/engine/map';
import type { ComposeCtx } from '../../composition';

/** In-flight cap per tier. Heavy suits links where the server, not the pipe,
 *  is the bottleneck; the lower tiers leave bandwidth and HTTP/2 stream
 *  priority for the tiles the user is actually looking at. */
export const PRELOAD_TIER_CONCURRENCY = {
  off: 0,
  conservative: 4,
  balanced: 16,
  heavy: 50,
} as const;

export type ResolvedPreloadTier = keyof typeof PRELOAD_TIER_CONCURRENCY;

const TILE_PX = 256;
/** Queue order: what the user is looking at now outranks what they are about
 *  to be shown. Exported so a test can name the tier it expects. */
export const PRIORITY_CURRENT = 1;
export const PRIORITY_UPCOMING = 2;
const SETTLE_MS = 300;

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
}

function isTouchOnly(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

/**
 * Chromium/Edge expose `navigator.connection`; Safari/Firefox do not, and a
 * missing connection is assumed fast. Touch-only devices default to off so a
 * user on cellular does not burn data on tiles they may never see.
 */
export function autoPreloadTier(): ResolvedPreloadTier {
  if (isTouchOnly()) return 'off';
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection) return 'heavy';
  if (connection.saveData) return 'off';
  switch (connection.effectiveType) {
    case 'slow-2g':
    case '2g':
      return 'off';
    case '3g':
      return 'conservative';
    case '4g':
      // 4g spans ~10 Mbps to gigabit; refine by downlink where it is reported.
      return connection.downlink != null && connection.downlink < 10 ? 'balanced' : 'heavy';
    default:
      return 'heavy';
  }
}

export function resolvePreloadTier(tier: PreloadTier): ResolvedPreloadTier {
  return tier === 'auto' ? autoPreloadTier() : tier;
}

export function preloadConcurrency(tier: PreloadTier): number {
  return PRELOAD_TIER_CONCURRENCY[resolvePreloadTier(tier)];
}

function groupId(collectionId: number, sliceIndex: number): string {
  return `preload-c${collectionId}-s${sliceIndex}`;
}

function parseGroupId(id: string): { collectionId: number; sliceIndex: number } | null {
  const match = /^preload-c(\d+)-s(\d+)$/.exec(id);
  if (!match) return null;
  return { collectionId: Number(match[1]), sliceIndex: Number(match[2]) };
}

/** Tile-aligned box around a point, sized to the viewport plus a one-tile
 *  border so the edges are covered. Falls back to a conservative 6x5 tiles
 *  when the viewport size is not known yet. */
function extentAround(center: LonLat, zoom: number, viewportPx: [number, number] | null): Bbox {
  const degreesPerTile = 360 / Math.pow(2, zoom);
  const tilesW = viewportPx ? Math.ceil(viewportPx[0] / TILE_PX) + 2 : 6;
  const tilesH = viewportPx ? Math.ceil(viewportPx[1] / TILE_PX) + 2 : 5;
  const halfW = (degreesPerTile * tilesW) / 2;
  const halfH = (degreesPerTile * tilesH) / 2;
  const [lon, lat] = center;
  return [lon - halfW, lat - halfH, lon + halfW, lat + halfH];
}

/** The visualization a collection would actually be shown with: the one the
 *  user is on when it belongs to the same source, else that source's first.
 *  Preloading any other viz fetches tiles OL will never request. */
function vizIdFor(catalog: Catalog, sourceId: number, active: SliceAddress | null): string | null {
  if (active && active.sourceId === sourceId) return active.vizId;
  const first = catalog.sources.get(sourceId)?.visualizations[0]?.id;
  return first == null ? null : String(first);
}

export interface CoverSliceJobsArgs {
  catalog: Catalog;
  sourceIds: number[];
  around: LonLat;
  zoom: number;
  priority: number;
  viewportPx?: [number, number] | null;
  /** The collection the map itself is already loading. */
  excludeCollectionId?: number | null;
  /** The address on screen, which decides each collection's visualization. */
  active: SliceAddress | null;
}

/** Cover-slice jobs for every collection of the view except the one already
 *  on screen - that one is being loaded by the map itself. */
export function coverSliceJobs({
  catalog,
  sourceIds,
  around,
  zoom,
  priority,
  viewportPx = null,
  excludeCollectionId = null,
  active,
}: CoverSliceJobsArgs): PreloadJob[] {
  const extent = extentAround(around, zoom, viewportPx);
  const jobs: PreloadJob[] = [];

  for (const collection of collectionsInView(catalog, { source_ids: sourceIds })) {
    if (collection.id === excludeCollectionId) continue;
    const sliceIndex = collection.cover_slice_index ?? 0;
    const slice = collection.slices[sliceIndex];
    if (!slice) continue;
    const sourceId = catalog.sourceIdByCollectionId.get(collection.id);
    if (sourceId == null) continue;
    const vizId = vizIdFor(catalog, sourceId, active);
    if (vizId == null) continue;

    // Same url assembly the layer itself uses (key proxy included), so a
    // preloaded tile is the byte-identical request OL will make. A cover
    // slice that publishes no tiles for this visualization is simply not
    // prefetchable - layerSpecFor says so by throwing.
    let urlTemplate: string;
    try {
      urlTemplate = layerSpecFor(catalog, {
        sourceId,
        collectionId: collection.id,
        sliceIndex,
        vizId,
      }).url;
    } catch {
      continue;
    }

    jobs.push({
      priority,
      groupId: groupId(collection.id, sliceIndex),
      urlTemplate,
      extent,
      zoom,
      tileProvider: slice.tile_urls[0]?.tile_provider ?? null,
    });
  }

  return jobs;
}

/** The zoom a task opens at: the active source's configured default, else
 *  wherever the camera is now. */
function defaultZoomFor(catalog: Catalog, active: SliceAddress | null, fallback: number): number {
  const configured = active ? catalog.sources.get(active.sourceId)?.default_zoom : null;
  return configured ?? fallback;
}

export interface PreloadingOptions {
  enabled: boolean;
  /** Foreground map traffic always outranks speculative work. */
  activeLoading: boolean;
  /** Where the map is centred now (the task point in tasks mode). */
  focus: LonLat | null;
  /** Centres the user is about to be shown, most imminent first. */
  upcoming?: LonLat[];
  viewportPx?: [number, number] | null;
}

export function usePreloading(ctx: ComposeCtx, options: PreloadingOptions): void {
  const { enabled, activeLoading, focus, upcoming, viewportPx = null } = options;
  const tier = usePrefsStore((s) => s.preloadTier);
  const concurrency = preloadConcurrency(tier);
  const preloaderRef = useRef<TilePreloader | null>(null);
  const activeLoadingRef = useRef(activeLoading);
  activeLoadingRef.current = activeLoading;

  useEffect(() => {
    if (!enabled || concurrency === 0) return;

    const preloader = new TilePreloader({ maxConcurrent: concurrency });
    preloaderRef.current = preloader;
    // An empty cover slice is a fact about the catalog, not about this map:
    // recording it here keeps every map (and the slice picker) from offering
    // it again.
    preloader.onGroupEmpty = (id) => {
      const parsed = parseGroupId(id);
      if (parsed)
        useImageryStore.getState().markEmpty(emptyKey(parsed.collectionId, parsed.sliceIndex));
    };

    return () => {
      preloader.dispose();
      preloaderRef.current = null;
    };
  }, [enabled, concurrency]);

  // Pause while the camera moves: the user's own tiles come first.
  useEffect(() => {
    if (!enabled) return;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = mainCamera.onChange(() => {
      preloaderRef.current?.pause();
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        if (!activeLoadingRef.current) preloaderRef.current?.resume();
      }, SETTLE_MS);
    });
    return () => {
      unsubscribe();
      if (settle) clearTimeout(settle);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (activeLoading) preloaderRef.current?.pause();
    else preloaderRef.current?.resume();
  }, [activeLoading, enabled]);

  const sourceIds = ctx.view?.source_ids;
  const address = useImageryStore((s) => s.address);
  const upcomingKey = JSON.stringify(upcoming ?? []);

  useEffect(() => {
    const preloader = preloaderRef.current;
    if (!preloader || !focus || !sourceIds) return;

    // Focus/address changes enqueue synchronously, while CameraController
    // coalesces its change notification to the next animation frame. Pause at
    // this boundary so enqueueMany cannot drain a speculative request before
    // the foreground map has even announced that it is loading.
    preloader.pause();
    const settle = setTimeout(() => {
      if (!activeLoadingRef.current) preloader.resume();
    }, SETTLE_MS);

    // A new focus makes the queued neighbourhood stale. clearCache() as well
    // as clear(): the seen-URL set is what stops a tile being queued twice,
    // and leaving it populated turns every later enqueue into a no-op.
    preloader.clear();
    preloader.clearCache();

    const jobs: PreloadJob[] = [];
    // Upcoming centres are prefetched at the source's default zoom, not the
    // user's current one: that is the zoom the next task will open at, and
    // tiles fetched at a zoom nobody lands on are wasted bandwidth
    // (useTilePreloading.ts:325).
    const upcomingZoom = defaultZoomFor(ctx.catalog, address, mainCamera.getState().zoom);
    for (const center of upcoming ?? []) {
      jobs.push(
        ...coverSliceJobs({
          catalog: ctx.catalog,
          sourceIds,
          around: center,
          zoom: upcomingZoom,
          priority: PRIORITY_UPCOMING,
          viewportPx,
          active: address,
        })
      );
    }
    if (jobs.length > 0) preloader.enqueueMany(jobs);
    // upcomingKey stands in for the upcoming array's contents; the array
    // itself is rebuilt by the caller on every render.
    return () => clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.catalog, sourceIds, focus, address, viewportPx, upcomingKey, concurrency, enabled]);
}
