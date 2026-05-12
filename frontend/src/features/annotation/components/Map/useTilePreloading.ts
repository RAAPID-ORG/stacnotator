/**
 * useTilePreloading - background tile preloading for task mode.
 *
 * Only cover slices are prefetched (the default-visible slice per collection).
 *
 * Priority levels (lower = higher priority):
 *   P1 - Current task's other collections (cover slices).
 *   P2 - Next task's active collection (cover slice).
 *   P3 - Next task's other collections (cover slices).
 *   P4 - Task after next's active collection (cover slice).
 *   P5 - Task after next's other collections (cover slices).
 */

import { useEffect, useRef, useCallback } from 'react';
import { TilePreloader } from './tilePreloader';
import { buildTileUrl } from '../../utils/tileLoading';
import type { PreloadJob } from './tilePreloader';
import type { LayerManager } from './layerManager';
import type { CampaignOutFull, AnnotationTaskOut } from '~/api/client';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import { useCampaignStore } from '../../stores/campaign.store';

const PRIORITY_OTHER_COLLECTIONS = 1;
const PRIORITY_NEXT1_DEFAULT = 2;
const PRIORITY_NEXT1_OTHER = 3;
const PRIORITY_NEXT2_DEFAULT = 4;
const PRIORITY_NEXT2_OTHER = 5;

const PREFIX_CURRENT = 'cur';
const PREFIX_NEXT1 = 'nxt1';
const PREFIX_NEXT2 = 'nxt2';

function groupId(prefix: string, collectionId: number, sliceIndex: number): string {
  return `${prefix}-c${collectionId}-s${sliceIndex}`;
}

function parseGroupId(
  gid: string
): { prefix: string; collectionId: number; sliceIndex: number } | null {
  const m = gid.match(/^(\w+)-c(\d+)-s(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], collectionId: Number(m[2]), sliceIndex: Number(m[3]) };
}

/**
 * Compute the geographic extent for preloading, centered on the given point.
 * When mapSize (pixels) is available we derive the real tile count from the
 * canvas dimensions; otherwise fall back to a conservative 6×5 tile estimate.
 */
function computeExtent(
  center: [number, number],
  zoom: number,
  mapSize: [number, number] | null
): [number, number, number, number] {
  const degreesPerTile = 360 / Math.pow(2, zoom);
  // +1 buffer tile on each side so edge tiles are covered
  const tilesW = mapSize ? Math.ceil(mapSize[0] / 256) + 2 : 6;
  const tilesH = mapSize ? Math.ceil(mapSize[1] / 256) + 2 : 5;
  const halfW = (degreesPerTile * tilesW) / 2;
  const halfH = (degreesPerTile * tilesH) / 2;
  const [lat, lon] = center;
  return [lon - halfW, lat - halfH, lon + halfW, lat + halfH];
}

function buildCoverSliceJobs(
  campaign: CampaignOutFull,
  extent: [number, number, number, number],
  zoom: number,
  prefix: string,
  getPriority: (collectionId: number) => number,
  excludeCollectionId?: number | null,
  /** When set, only prefetch collections in this set (active view's collections) */
  allowedCollectionIds?: Set<number> | null
): PreloadJob[] {
  const jobs: PreloadJob[] = [];

  for (const source of campaign.imagery_sources) {
    for (const collection of source.collections) {
      if (excludeCollectionId != null && collection.id === excludeCollectionId) continue;
      if (allowedCollectionIds && !allowedCollectionIds.has(collection.id)) continue;

      // Only prefetch the cover slice (the default-visible slice for each collection)
      const si = collection.cover_slice_index ?? 0;
      const slice = collection.slices[si];
      if (!slice) continue;
      const tileUrlEntry = slice.tile_urls[0];
      if (!tileUrlEntry) continue;

      const resolvedUrl = buildTileUrl({
        tile_url: tileUrlEntry.tile_url,
        tile_provider: tileUrlEntry.tile_provider,
      });

      jobs.push({
        priority: getPriority(collection.id),
        groupId: groupId(prefix, collection.id, si),
        urlTemplate: resolvedUrl,
        extent,
        zoom,
      });
    }
  }

  return jobs;
}

interface UseTilePreloadingOptions {
  layerManager: LayerManager | null;
  campaign: CampaignOutFull | null;
  activeCollectionId: number | null;
  visibleTasks: AnnotationTaskOut[];
  currentTaskIndex: number;
  defaultZoom: number;
  currentZoom?: number;
  enabled: boolean;
}

export function useTilePreloading({
  layerManager,
  campaign,
  activeCollectionId,
  visibleTasks,
  currentTaskIndex,
  defaultZoom,
  currentZoom,
  enabled,
}: UseTilePreloadingOptions) {
  const preloaderRef = useRef<TilePreloader | null>(null);
  const hasEnqueuedCurrentRef = useRef(false);
  const hasEnqueuedNextRef = useRef(false);
  const mapSizeRef = useRef<[number, number] | null>(null);

  const campaignRef = useRef(campaign);
  campaignRef.current = campaign;
  const activeCollectionIdRef = useRef(activeCollectionId);
  activeCollectionIdRef.current = activeCollectionId;
  const visibleTasksRef = useRef(visibleTasks);
  visibleTasksRef.current = visibleTasks;
  const currentTaskIndexRef = useRef(currentTaskIndex);
  currentTaskIndexRef.current = currentTaskIndex;
  const defaultZoomRef = useRef(defaultZoom);
  defaultZoomRef.current = defaultZoom;
  const currentZoomRef = useRef(currentZoom ?? defaultZoom);
  currentZoomRef.current = currentZoom ?? defaultZoom;

  /** Collection IDs belonging to the first (active) view - only these get prefetched */
  const selectedViewId = useCampaignStore((s) => s.selectedViewId);
  const viewCollectionIdsRef = useRef<Set<number> | null>(null);
  if (campaign && selectedViewId != null) {
    const view = campaign.imagery_views.find((v) => v.id === selectedViewId);
    viewCollectionIdsRef.current = view
      ? new Set(view.collection_refs.map((r) => r.collection_id))
      : null;
  } else {
    viewCollectionIdsRef.current = null;
  }

  /** When a prefetch group is detected as empty (cover slice has no data),
   *  try the next slice in the same collection so the annotator doesn't
   *  have to wait for it to load when they advance to the next task. */
  const handleGroupEmpty = useCallback((gid: string) => {
    const parsed = parseGroupId(gid);
    if (!parsed) return;
    const { prefix, collectionId, sliceIndex } = parsed;
    const camp = campaignRef.current;
    const p = preloaderRef.current;
    if (!camp || !p) return;

    // Find the collection and try the next slice
    for (const source of camp.imagery_sources) {
      const col = source.collections.find((c) => c.id === collectionId);
      if (!col) continue;

      for (let offset = 1; offset < col.slices.length; offset++) {
        const nextSi = (sliceIndex + offset) % col.slices.length;
        const nextSlice = col.slices[nextSi];
        if (!nextSlice) continue;
        const tileUrlEntry = nextSlice.tile_urls[0];
        if (!tileUrlEntry) continue;

        const resolvedUrl = buildTileUrl({
          tile_url: tileUrlEntry.tile_url,
          tile_provider: tileUrlEntry.tile_provider,
        });

        // Determine priority from prefix
        const isDefault = collectionId === activeCollectionIdRef.current;
        let priority: number;
        if (prefix === PREFIX_CURRENT) priority = PRIORITY_OTHER_COLLECTIONS;
        else if (prefix === PREFIX_NEXT1)
          priority = isDefault ? PRIORITY_NEXT1_DEFAULT : PRIORITY_NEXT1_OTHER;
        else priority = isDefault ? PRIORITY_NEXT2_DEFAULT : PRIORITY_NEXT2_OTHER;

        // Extract extent from existing tasks
        const tasks = visibleTasksRef.current;
        const idx = currentTaskIndexRef.current;
        const taskOffset = prefix === PREFIX_CURRENT ? 0 : prefix === PREFIX_NEXT1 ? 1 : 2;
        const taskIdx = (idx + taskOffset) % tasks.length;
        const task = tasks[taskIdx];
        if (!task) break;
        const latLon = extractCentroidFromWKT(task.geometry.geometry);
        if (!latLon) break;

        const zoom = prefix === PREFIX_CURRENT ? currentZoomRef.current : defaultZoomRef.current;
        const extent = computeExtent([latLon.lat, latLon.lon], zoom, getMapSize());

        p.enqueue({
          priority,
          groupId: groupId(prefix, collectionId, nextSi),
          urlTemplate: resolvedUrl,
          extent,
          zoom,
        });
        break; // Only try one fallback slice at a time
      }
      break;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const p = new TilePreloader();
    preloaderRef.current = p;
    p.onGroupEmpty = handleGroupEmpty;

    return () => {
      p.dispose();
      preloaderRef.current = null;
    };
  }, [enabled, handleGroupEmpty]);

  const enqueueCurrentOtherCollections = useCallback(() => {
    const p = preloaderRef.current;
    const camp = campaignRef.current;
    const colId = activeCollectionIdRef.current;
    const tasks = visibleTasksRef.current;
    const idx = currentTaskIndexRef.current;
    if (!p || !camp || tasks.length === 0) return;

    const currentTask = tasks[idx];
    if (!currentTask) return;

    const latLon = extractCentroidFromWKT(currentTask.geometry.geometry);
    if (!latLon) return;

    // Use current viewport zoom for current task (user may have zoomed in/out)
    const zoom = currentZoomRef.current;
    const extent = computeExtent([latLon.lat, latLon.lon], zoom, getMapSize());

    const jobs = buildCoverSliceJobs(
      camp,
      extent,
      zoom,
      PREFIX_CURRENT,
      () => PRIORITY_OTHER_COLLECTIONS,
      colId,
      viewCollectionIdsRef.current
    );

    if (jobs.length > 0) p.enqueueMany(jobs);
  }, []);

  const enqueueNextTasks = useCallback(() => {
    const p = preloaderRef.current;
    const camp = campaignRef.current;
    const tasks = visibleTasksRef.current;
    const idx = currentTaskIndexRef.current;
    if (!p || !camp || tasks.length === 0) return;

    const zoom = defaultZoomRef.current;
    const defaultColId = activeCollectionIdRef.current;

    // Abort previous next-task groups
    for (const src of camp.imagery_sources) {
      for (const col of src.collections) {
        const si = col.cover_slice_index ?? 0;
        p.abort(groupId(PREFIX_NEXT1, col.id, si));
        p.abort(groupId(PREFIX_NEXT2, col.id, si));
      }
    }

    // Prefetch next 2 tasks (cover slices only)
    const offsets = [
      {
        offset: 1,
        prefix: PREFIX_NEXT1,
        priDefault: PRIORITY_NEXT1_DEFAULT,
        priOther: PRIORITY_NEXT1_OTHER,
      },
      {
        offset: 2,
        prefix: PREFIX_NEXT2,
        priDefault: PRIORITY_NEXT2_DEFAULT,
        priOther: PRIORITY_NEXT2_OTHER,
      },
    ];

    for (const { offset, prefix, priDefault, priOther } of offsets) {
      const nextIdx = (idx + offset) % tasks.length;
      if (nextIdx === idx) continue;

      const nextTask = tasks[nextIdx];
      if (!nextTask) continue;

      const latLon = extractCentroidFromWKT(nextTask.geometry.geometry);
      if (!latLon) continue;

      const extent = computeExtent([latLon.lat, latLon.lon], zoom, getMapSize());
      const jobs = buildCoverSliceJobs(
        camp,
        extent,
        zoom,
        prefix,
        (colId) => (colId === defaultColId ? priDefault : priOther),
        undefined,
        viewCollectionIdsRef.current
      );

      if (jobs.length > 0) p.enqueueMany(jobs);
    }
  }, []);

  /** Read the map canvas pixel size once and cache it. */
  const getMapSize = (): [number, number] | null => {
    if (mapSizeRef.current) return mapSizeRef.current;
    if (!layerManager) return null;
    const size = layerManager.getMap().getSize();
    if (size && size[0] > 0 && size[1] > 0) {
      mapSizeRef.current = [size[0], size[1]];
    }
    return mapSizeRef.current;
  };

  useEffect(() => {
    if (!enabled || !layerManager) return;
    const p = preloaderRef.current;
    if (!p) return;

    const unsub = layerManager.onBusyChange((busy) => {
      if (busy) {
        p.pause();
      } else {
        p.resume();
        if (!hasEnqueuedCurrentRef.current) {
          hasEnqueuedCurrentRef.current = true;
          enqueueCurrentOtherCollections();
        }
      }
    });

    return unsub;
  }, [enabled, layerManager, enqueueCurrentOtherCollections]);

  useEffect(() => {
    const p = preloaderRef.current;
    if (!p || !enabled) return;

    p.onIdle = () => {
      if (!hasEnqueuedNextRef.current) {
        hasEnqueuedNextRef.current = true;
        enqueueNextTasks();
      }
    };

    return () => {
      if (p) p.onIdle = undefined;
    };
  }, [enabled, enqueueNextTasks]);

  useEffect(() => {
    const p = preloaderRef.current;
    if (!p) return;

    p.clear();
    p.clearCache();
    hasEnqueuedCurrentRef.current = false;
    hasEnqueuedNextRef.current = false;
  }, [currentTaskIndex]);
}
