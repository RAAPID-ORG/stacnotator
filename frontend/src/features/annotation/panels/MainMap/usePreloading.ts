import { useCatalog } from '../../stores/campaign';
import { useEffect, useRef } from 'react';
import { sliceRaster, type Catalog, type SliceAddress } from '../../domain/catalog';
import { addressAtSlice } from '../../domain/imageryNav';
import { useImageryStore } from '../../stores/imagery';
import { usePrefsStore, type PreloadTier } from '../../stores/prefs';
import { mainCamera } from '../../map/camera';
import { TilePreloader, tileUrlsForExtent, type PreloadJob } from '../../map/preloader';
import { type Bbox, type LonLat } from '../../map/types';

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
/** Visible maps fetch their own tiles. Speculation is limited to the exact
 * imagery those maps will show at the upcoming task centres. */
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

export interface VisibleSliceJobsArgs {
  catalog: Catalog;
  addresses: SliceAddress[];
  around: LonLat;
  fallbackZoom: number;
  priority: number;
  viewportPx?: [number, number] | null;
}

/** One job per raster actually visible in the main map or an imagery window.
 * Hidden collections and other dates never enter the speculative queue. */
export function visibleSliceJobs({
  catalog,
  addresses,
  around,
  fallbackZoom,
  priority,
  viewportPx = null,
}: VisibleSliceJobsArgs): PreloadJob[] {
  const jobs: PreloadJob[] = [];

  for (const address of addresses) {
    const collection = catalog.collections.get(address.collectionId);
    const slice = collection?.slices[address.sliceIndex];
    if (!slice) continue;
    let spec;
    try {
      spec = sliceRaster(catalog, address);
    } catch {
      continue;
    }
    const zoom = catalog.sources.get(address.sourceId)?.default_zoom ?? fallbackZoom;

    jobs.push({
      priority,
      groupId: groupId(address.collectionId, address.sliceIndex),
      urlTemplate: spec.url,
      extent: extentAround(around, zoom, viewportPx),
      zoom,
      tileProvider: slice.tile_urls[0]?.tile_provider ?? null,
    });
  }

  return jobs;
}

/** Resolve the exact addresses visible now: the main map's active address and
 * one selected date for each rendered window. */
export function visibleAddresses(
  catalog: Catalog,
  active: SliceAddress | null,
  visibleCollectionIds: readonly number[],
  windowSlices: Readonly<Record<number, { selected: number }>>,
  viewSync: boolean
): SliceAddress[] {
  const addresses: SliceAddress[] = active ? [active] : [];
  // An unsynchronised background window stays at its own panned location when
  // tasks advance, so preloading the next task into it would be pure waste.
  if (!viewSync) return addresses;
  for (const collectionId of visibleCollectionIds) {
    if (collectionId === active?.collectionId) continue;
    const collection = catalog.collections.get(collectionId);
    const sourceId = catalog.sourceOf.get(collectionId);
    const source = sourceId == null ? undefined : catalog.sources.get(sourceId);
    if (!collection || sourceId == null || !source) continue;
    const base = {
      sourceId,
      collectionId,
      sliceIndex: windowSlices[collectionId]?.selected ?? collection.cover_slice_index ?? 0,
      vizId: String(source.visualizations[0]?.id ?? ''),
    };
    addresses.push(addressAtSlice(catalog, base, base.sliceIndex));
  }
  return addresses;
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
  /** Collection panels currently mounted on the canvas. */
  visibleCollectionIds: number[];
}

export function usePreloading(options: PreloadingOptions): void {
  const catalog = useCatalog();
  const {
    enabled,
    activeLoading,
    focus,
    upcoming,
    viewportPx = null,
    visibleCollectionIds,
  } = options;
  const tier = usePrefsStore((s) => s.preloadTier);
  const concurrency = preloadConcurrency(tier);
  const preloaderRef = useRef<TilePreloader | null>(null);
  const activeLoadingRef = useRef(activeLoading);
  activeLoadingRef.current = activeLoading;

  useEffect(() => {
    if (!enabled || concurrency === 0) return;

    const preloader = new TilePreloader({ maxConcurrent: concurrency });
    preloaderRef.current = preloader;

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

  const address = useImageryStore((s) => s.address);
  const viewSync = useImageryStore((s) => s.viewSync);
  const windowSlices = useImageryStore((s) => s.windowSlices);
  const upcomingKey = JSON.stringify(upcoming ?? []);
  const visibleCollectionsKey = visibleCollectionIds.join(',');

  useEffect(() => {
    const preloader = preloaderRef.current;
    if (!preloader || !focus) return;

    // Focus/address changes enqueue synchronously, while Camera
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
    const addresses = visibleAddresses(
      catalog,
      address,
      visibleCollectionIds,
      windowSlices,
      viewSync
    );
    const currentJobs = visibleSliceJobs({
      catalog: catalog,
      addresses,
      around: focus,
      fallbackZoom: mainCamera.getState().zoom,
      priority: PRIORITY_UPCOMING,
      viewportPx,
    });
    const foregroundUrls = new Set(
      currentJobs.flatMap((job) => tileUrlsForExtent(job.urlTemplate, job.extent, job.zoom))
    );
    // Heavy mode may have fifty old-task requests in flight. Keep only requests
    // the new viewport can reuse; stale work must not hold the connection while
    // the user waits, but shared URLs must not be aborted (see TilePreloader).
    preloader.cancelInflightExcept(foregroundUrls);
    for (const center of upcoming ?? []) {
      jobs.push(
        ...visibleSliceJobs({
          catalog: catalog,
          addresses,
          around: center,
          fallbackZoom: mainCamera.getState().zoom,
          priority: PRIORITY_UPCOMING,
          viewportPx,
        })
      );
    }
    if (jobs.length > 0) preloader.enqueueMany(jobs);
    // upcomingKey stands in for the upcoming array's contents; the array
    // itself is rebuilt by the caller on every render.
    return () => clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    focus,
    address,
    viewportPx,
    upcomingKey,
    visibleCollectionsKey,
    windowSlices,
    viewSync,
    concurrency,
    enabled,
  ]);
}
