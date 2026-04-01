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
import type { PreloadJob } from './tilePreloader';
import type { LayerManager } from './layerManager';
import type { CampaignOutFull, AnnotationTaskOut } from '~/api/client';
import { extractCentroidFromWKT } from '~/shared/utils/utility';
import { useMapStore } from '../../stores/map.store';

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

function estimateExtent(center: [number, number], zoom: number): [number, number, number, number] {
  const degreesPerTile = 360 / Math.pow(2, zoom);
  const halfW = (degreesPerTile * 4) / 2;
  const halfH = (degreesPerTile * 3) / 2;
  const [lat, lon] = center;
  return [lon - halfW, lat - halfH, lon + halfW, lat + halfH];
}

function buildCoverSliceJobs(
  campaign: CampaignOutFull,
  extent: [number, number, number, number],
  zoom: number,
  prefix: string,
  getPriority: (collectionId: number) => number,
  excludeCollectionId?: number | null
): PreloadJob[] {
  const jobs: PreloadJob[] = [];

  for (const source of campaign.imagery_sources) {
    for (const collection of source.collections) {
      if (excludeCollectionId != null && collection.id === excludeCollectionId) continue;

      // Only prefetch the cover slice (the default-visible slice for each collection)
      const si = collection.cover_slice_index ?? 0;
      const slice = collection.slices[si];
      if (!slice) continue;
      const tileUrl = slice.tile_urls[0]?.tile_url;
      if (!tileUrl) continue;

      jobs.push({
        priority: getPriority(collection.id),
        groupId: groupId(prefix, collection.id, si),
        urlTemplate: tileUrl,
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
  /** Current map zoom level — used for prefetching current task at the zoom the user is at */
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

  const setCollectionSliceIndex = useMapStore((s) => s.setCollectionSliceIndex);
  const markSliceEmpty = useMapStore((s) => s.markSliceEmpty);
  const setCollectionSliceIndexRef = useRef(setCollectionSliceIndex);
  setCollectionSliceIndexRef.current = setCollectionSliceIndex;
  const markSliceEmptyRef = useRef(markSliceEmpty);
  markSliceEmptyRef.current = markSliceEmpty;

  useEffect(() => {
    if (!enabled) return;
    const p = new TilePreloader();
    preloaderRef.current = p;

    p.onGroupEmpty = (gid) => {
      const parsed = parseGroupId(gid);
      if (!parsed) return;

      const sliceKey = `${parsed.collectionId}-${parsed.sliceIndex}`;
      markSliceEmptyRef.current(sliceKey);

      const camp = campaignRef.current;
      if (!camp) return;

      // Find the collection
      let collection = null;
      for (const src of camp.imagery_sources) {
        collection = src.collections.find((c) => c.id === parsed.collectionId) ?? null;
        if (collection) break;
      }
      if (!collection) return;

      const { emptySlices } = useMapStore.getState();
      const firstValid = collection.slices.findIndex(
        (_, i) => !emptySlices[`${parsed.collectionId}-${i}`]
      );

      if (firstValid !== -1 && firstValid !== parsed.sliceIndex) {
        if (parsed.collectionId !== activeCollectionIdRef.current) {
          setCollectionSliceIndexRef.current(parsed.collectionId, firstValid);
        }
      }
    };

    return () => {
      p.dispose();
      preloaderRef.current = null;
    };
  }, [enabled]);

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
    const extent = estimateExtent([latLon.lat, latLon.lon], zoom);

    const jobs = buildCoverSliceJobs(
      camp,
      extent,
      zoom,
      PREFIX_CURRENT,
      () => PRIORITY_OTHER_COLLECTIONS,
      colId
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

      const extent = estimateExtent([latLon.lat, latLon.lon], zoom);
      const jobs = buildCoverSliceJobs(camp, extent, zoom, prefix, (colId) =>
        colId === defaultColId ? priDefault : priOther
      );

      if (jobs.length > 0) p.enqueueMany(jobs);
    }
  }, []);

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
