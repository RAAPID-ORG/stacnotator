import { useCatalog } from '../../stores/campaign';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type ImageryCatalog } from '../../campaign/imagery';
import { type SliceAddress } from '../../campaign/imageryNav';
import { sliceRaster } from '../../campaign/tileUrls';
import { addressAtSlice } from '../../campaign/imageryNav';
import { useImageryStore } from '../../stores/imagery';
import { usePrefsStore, type PreloadTier } from '../../stores/prefs';
import { mainCamera } from '../../map/camera';
import {
  TilePreloader,
  tileUrlsForExtent,
  type GroupProgress,
  type PreloadJob,
} from '../../map/preloader';
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

function groupId(taskIndex: number, collectionId: number, sliceIndex: number): string {
  return `preload-t${taskIndex}-c${collectionId}-s${sliceIndex}`;
}

/** Roll the groups of each upcoming task up into one 0-100 figure per task,
 *  ordered as the caller's `upcoming` centres are: nearest task first. */
export function taskPercents(progress: Map<string, GroupProgress>, count: number): number[] {
  const done = new Array<number>(count).fill(0);
  const total = new Array<number>(count).fill(0);

  for (const [id, counts] of progress) {
    const taskIndex = Number(/^preload-t(\d+)-/.exec(id)?.[1]);
    if (!Number.isInteger(taskIndex) || taskIndex >= count) continue;
    done[taskIndex] += counts.done;
    total[taskIndex] += counts.total;
  }

  return done.map((d, i) => (total[i] > 0 ? Math.round((d / total[i]) * 100) : 0));
}

const NO_PROGRESS: readonly number[] = [];
let preloadProgress = NO_PROGRESS;
const progressListeners = new Set<() => void>();
const readPreloadProgress = () => preloadProgress;

/** Whole percents only, so a run of a few hundred tiles cannot re-render the
 *  header per tile - equal snapshots never reach a subscriber. */
function publishPreloadProgress(next: readonly number[]): void {
  if (next.length === preloadProgress.length && next.every((p, i) => p === preloadProgress[i])) {
    return;
  }
  preloadProgress = next;
  for (const listener of progressListeners) listener();
}

function subscribePreloadProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

/** How warm each upcoming task's imagery is, for the preload control to show. */
export function usePreloadProgress(): readonly number[] {
  return useSyncExternalStore(subscribePreloadProgress, readPreloadProgress, readPreloadProgress);
}

/** Viewport plus a one-tile border, in whole tiles. Falls back to a
 *  conservative 6x5 when the viewport size is not known yet. */
function tileSpan(px: number | undefined, fallback: number): number {
  return px === undefined ? fallback : Math.ceil(px / TILE_PX) + 2;
}

/** Tile-aligned box around a point, sized to the viewport plus a one-tile
 *  border so the edges are covered. */
function extentAround(center: LonLat, zoom: number, viewportPx: [number, number] | null): Bbox {
  const degreesPerTile = 360 / Math.pow(2, zoom);
  const halfW = (degreesPerTile * tileSpan(viewportPx?.[0], 6)) / 2;
  const halfH = (degreesPerTile * tileSpan(viewportPx?.[1], 5)) / 2;
  const [lon, lat] = center;
  return [lon - halfW, lat - halfH, lon + halfW, lat + halfH];
}

/** The neighbourhood only grows in whole tiles, so a reflow that nudges the
 *  viewport by a fraction of a pixel - a longer date label in the header
 *  relaying the panel out - must not rebuild the queue. */
function viewportTileKey(viewportPx: [number, number] | null): string {
  return `${tileSpan(viewportPx?.[0], 6)}x${tileSpan(viewportPx?.[1], 5)}`;
}

export interface VisibleSliceJobsArgs {
  catalog: ImageryCatalog;
  addresses: SliceAddress[];
  around: LonLat;
  fallbackZoom: number;
  priority: number;
  /** Which upcoming task these jobs warm, so their progress stays separable. */
  taskIndex: number;
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
  taskIndex,
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
      groupId: groupId(taskIndex, address.collectionId, address.sliceIndex),
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
  catalog: ImageryCatalog,
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
  const upcomingCountRef = useRef(0);
  upcomingCountRef.current = upcoming?.length ?? 0;

  useEffect(() => {
    if (!enabled || concurrency === 0) {
      publishPreloadProgress(NO_PROGRESS);
      return;
    }

    const preloader = new TilePreloader({ maxConcurrent: concurrency });
    preloader.onProgress = () =>
      publishPreloadProgress(taskPercents(preloader.progress(), upcomingCountRef.current));
    preloaderRef.current = preloader;

    return () => {
      preloader.dispose();
      preloaderRef.current = null;
      publishPreloadProgress(NO_PROGRESS);
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
  const viewportKey = viewportTileKey(viewportPx);
  const focusKey = focus ? `${focus[0]},${focus[1]}` : '';
  const lastFocusRef = useRef('');

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

    // Only a new focus makes the warm set stale. Browsing imagery within the
    // same task rebuilds the queue but keeps what is already fetched, so
    // stepping back onto a date or visualization already seen reads as warm
    // instead of re-requesting every tile from zero.
    if (lastFocusRef.current !== focusKey) {
      preloader.clearCache();
      lastFocusRef.current = focusKey;
    }
    preloader.clear();

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
      taskIndex: 0,
      viewportPx,
    });
    const foregroundUrls = new Set(
      currentJobs.flatMap((job) => tileUrlsForExtent(job.urlTemplate, job.extent, job.zoom))
    );
    // Heavy mode may have fifty old-task requests in flight. Keep only requests
    // the new viewport can reuse; stale work must not hold the connection while
    // the user waits, but shared URLs must not be aborted (see TilePreloader).
    preloader.cancelInflightExcept(foregroundUrls);
    (upcoming ?? []).forEach((center, taskIndex) => {
      jobs.push(
        ...visibleSliceJobs({
          catalog: catalog,
          addresses,
          around: center,
          fallbackZoom: mainCamera.getState().zoom,
          priority: PRIORITY_UPCOMING,
          taskIndex,
          viewportPx,
        })
      );
    });
    if (jobs.length > 0) preloader.enqueueMany(jobs);
    // upcomingKey stands in for the upcoming array's contents; the array
    // itself is rebuilt by the caller on every render.
    return () => clearTimeout(settle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    catalog,
    focusKey,
    address,
    viewportKey,
    upcomingKey,
    visibleCollectionsKey,
    windowSlices,
    viewSync,
    concurrency,
    enabled,
  ]);
}
