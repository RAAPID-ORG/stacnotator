/**
 * useTilePreloading - background tile preloading for task mode.
 *
 * Priority levels (lower = higher priority):
 *   P1 - Other windows/slices at the current viewport.
 *   P2 - Next task's default window slices.
 *   P3 - Next task's other window slices.
 *
 * Empty-slice handling:
 *   All slices for each window are enqueued with per-slice groupIds.
 *   The TilePreloader counts errors vs. successes per group (same
 *   threshold as WindowMap) and fires onGroupEmpty when a slice is
 *   detected as empty. We then call markSliceEmpty in the map store
 *   and auto-advance to the first non-empty slice.
 */

import { useEffect, useRef, useCallback } from 'react';
import { toLonLat } from 'ol/proj';
import type OLMap from 'ol/Map';
import { TilePreloader } from './tilePreloader';
import type { PreloadJob } from './tilePreloader';
import type { LayerManager } from './layerManager';
import type { SliceLayerMap } from '../../hooks/useStacRegistration';
import type { ImageryWithWindowsOut, AnnotationTaskOut } from '~/api/client';
import { extractLatLonFromWKT, computeTimeSlices } from '~/shared/utils/utility';
import { useMapStore } from '../../stores/map.store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_OTHER_WINDOWS = 1;
const PRIORITY_NEXT_TASK_DEFAULT = 2;
const PRIORITY_NEXT_TASK_OTHER = 3;

/** Group ID prefix for current-task preloads. */
const PREFIX_CURRENT = 'cur';
/** Group ID prefix for next-task preloads. */
const PREFIX_NEXT = 'nxt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a group ID that encodes prefix + windowId + sliceIndex. */
function groupId(prefix: string, windowId: number, sliceIndex: number): string {
  return `${prefix}-w${windowId}-s${sliceIndex}`;
}

/** Parse a group ID back into its components. Returns null if malformed. */
function parseGroupId(gid: string): { prefix: string; windowId: number; sliceIndex: number } | null {
  const m = gid.match(/^(\w+)-w(\d+)-s(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], windowId: Number(m[2]), sliceIndex: Number(m[3]) };
}

function getViewportExtent(map: OLMap): [number, number, number, number] | null {
  const view = map.getView();
  const extent = view.calculateExtent(map.getSize());
  if (!extent) return null;
  const [w, s] = toLonLat([extent[0], extent[1]]);
  const [e, n] = toLonLat([extent[2], extent[3]]);
  return [w, s, e, n];
}

function estimateExtent(
  center: [number, number], // [lat, lon]
  zoom: number,
): [number, number, number, number] {
  const degreesPerTile = 360 / Math.pow(2, zoom);
  const halfW = (degreesPerTile * 4) / 2;
  const halfH = (degreesPerTile * 3) / 2;
  const [lat, lon] = center;
  return [lon - halfW, lat - halfH, lon + halfW, lat + halfH];
}

/**
 * Build preload jobs for all slices of the given windows.
 */
function buildSliceJobs(
  windows: ImageryWithWindowsOut['windows'],
  imagery: ImageryWithWindowsOut,
  sliceLayerMap: SliceLayerMap,
  extent: [number, number, number, number],
  zoom: number,
  prefix: string,
  getPriority: (windowId: number) => number,
): PreloadJob[] {
  const vizTemplate = imagery.visualization_url_templates[0];
  if (!vizTemplate) return [];

  const jobs: PreloadJob[] = [];

  for (const win of windows) {
    const slices = computeTimeSlices(
      win.window_start_date,
      win.window_end_date,
      imagery.slicing_interval,
      imagery.slicing_unit,
    );

    for (const slice of slices) {
      const searchId = sliceLayerMap.get(`${win.id}-${slice.index}`);
      if (!searchId) continue;

      const urlTemplate = vizTemplate.visualization_url.replace(
        /\{searchId\}/g, searchId,
      );
      jobs.push({
        priority: getPriority(win.id),
        groupId: groupId(prefix, win.id, slice.index),
        urlTemplate,
        extent,
        zoom,
      });
    }
  }

  return jobs;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseTilePreloadingOptions {
  map: OLMap | null;
  layerManager: LayerManager | null;
  imagery: ImageryWithWindowsOut | null;
  sliceLayerMap: SliceLayerMap;
  activeWindowId: number | null;
  visibleTasks: AnnotationTaskOut[];
  currentTaskIndex: number;
  defaultZoom: number;
  enabled: boolean;
}

export function useTilePreloading({
  map,
  layerManager,
  imagery,
  sliceLayerMap,
  activeWindowId,
  visibleTasks,
  currentTaskIndex,
  defaultZoom,
  enabled,
}: UseTilePreloadingOptions) {
  const preloaderRef = useRef<TilePreloader | null>(null);
  const hasEnqueuedCurrentRef = useRef(false);
  const hasEnqueuedNextRef = useRef(false);

  // Keep latest values in refs so callbacks don't need deps
  const imageryRef = useRef(imagery);
  imageryRef.current = imagery;
  const sliceLayerMapRef = useRef(sliceLayerMap);
  sliceLayerMapRef.current = sliceLayerMap;
  const activeWindowIdRef = useRef(activeWindowId);
  activeWindowIdRef.current = activeWindowId;
  const visibleTasksRef = useRef(visibleTasks);
  visibleTasksRef.current = visibleTasks;
  const currentTaskIndexRef = useRef(currentTaskIndex);
  currentTaskIndexRef.current = currentTaskIndex;
  const defaultZoomRef = useRef(defaultZoom);
  defaultZoomRef.current = defaultZoom;
  const mapRef = useRef(map);
  mapRef.current = map;

  // Store actions
  const setWindowSliceIndex = useMapStore((s) => s.setWindowSliceIndex);
  const markSliceEmpty = useMapStore((s) => s.markSliceEmpty);
  const setWindowSliceIndexRef = useRef(setWindowSliceIndex);
  setWindowSliceIndexRef.current = setWindowSliceIndex;
  const markSliceEmptyRef = useRef(markSliceEmpty);
  markSliceEmptyRef.current = markSliceEmpty;

  // Create / dispose the preloader
  useEffect(() => {
    if (!enabled) return;
    const p = new TilePreloader();
    preloaderRef.current = p;

    // When a slice group is detected as empty, mark it in the store and
    // auto-advance inactive windows to the first non-empty slice.
    p.onGroupEmpty = (gid) => {
      const parsed = parseGroupId(gid);
      if (!parsed) return;

      const sliceKey = `${parsed.windowId}-${parsed.sliceIndex}`;
      markSliceEmptyRef.current(sliceKey);

      // Auto-advance: find the first non-empty slice for this window.
      // Only update the stored slice index for non-active windows;
      // the active window's slice is managed by ImageryContainer.
      const img = imageryRef.current;
      if (!img) return;
      const win = img.windows.find((w) => w.id === parsed.windowId);
      if (!win) return;

      const { emptySlices } = useMapStore.getState();
      const slices = computeTimeSlices(
        win.window_start_date,
        win.window_end_date,
        img.slicing_interval,
        img.slicing_unit,
      );

      const firstValid = slices.findIndex(
        (_, i) => !emptySlices[`${parsed.windowId}-${i}`],
      );

      if (firstValid !== -1 && firstValid !== parsed.sliceIndex) {
        // Only set for non-active windows — active window handled by ImageryContainer
        if (parsed.windowId !== activeWindowIdRef.current) {
          setWindowSliceIndexRef.current(parsed.windowId, firstValid);
        }
      }
    };

    return () => {
      p.dispose();
      preloaderRef.current = null;
    };
  }, [enabled]);

  /**
   * Enqueue tiles for all slices of all non-active windows (P1).
   */
  const enqueueCurrentOtherWindows = useCallback(() => {
    const p = preloaderRef.current;
    const m = mapRef.current;
    const img = imageryRef.current;
    const winId = activeWindowIdRef.current;
    if (!p || !m || !img || winId == null) return;

    const extent = getViewportExtent(m);
    if (!extent) return;
    const zoom = m.getView().getZoom() ?? defaultZoomRef.current;

    // Abort any previous current-window groups
    for (const win of img.windows) {
      if (win.id === winId) continue;
      const slices = computeTimeSlices(
        win.window_start_date, win.window_end_date,
        img.slicing_interval, img.slicing_unit,
      );
      for (const s of slices) p.abort(groupId(PREFIX_CURRENT, win.id, s.index));
    }

    const otherWindows = img.windows.filter((w) => w.id !== winId);
    const jobs = buildSliceJobs(
      otherWindows, img, sliceLayerMapRef.current,
      extent, zoom, PREFIX_CURRENT,
      () => PRIORITY_OTHER_WINDOWS,
    );

    if (jobs.length > 0) p.enqueueMany(jobs);
  }, []);

  /**
   * Enqueue tiles for all slices of all windows for the next task (P2+P3).
   */
  const enqueueNextTask = useCallback(() => {
    const p = preloaderRef.current;
    const img = imageryRef.current;
    const tasks = visibleTasksRef.current;
    const idx = currentTaskIndexRef.current;
    if (!p || !img || tasks.length === 0) return;

    const nextIdx = idx >= tasks.length - 1 ? 0 : idx + 1;
    if (nextIdx === idx) return;

    const nextTask = tasks[nextIdx];
    if (!nextTask) return;

    const latLon = extractLatLonFromWKT(nextTask.geometry.geometry);
    if (!latLon) return;

    const zoom = defaultZoomRef.current;
    const extent = estimateExtent([latLon.lat, latLon.lon], zoom);
    const defaultWindowId = img.default_main_window_id ?? img.windows[0]?.id;

    // Abort previous next-task groups
    for (const win of img.windows) {
      const slices = computeTimeSlices(
        win.window_start_date, win.window_end_date,
        img.slicing_interval, img.slicing_unit,
      );
      for (const s of slices) p.abort(groupId(PREFIX_NEXT, win.id, s.index));
    }

    const jobs = buildSliceJobs(
      img.windows, img, sliceLayerMapRef.current,
      extent, zoom, PREFIX_NEXT,
      (winId) => winId === defaultWindowId ? PRIORITY_NEXT_TASK_DEFAULT : PRIORITY_NEXT_TASK_OTHER,
    );

    if (jobs.length > 0) p.enqueueMany(jobs);
  }, []);

  // Wire up LayerManager busy/idle → pause/resume + trigger P1
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
          enqueueCurrentOtherWindows();
        }
      }
    });

    return unsub;
  }, [enabled, layerManager, enqueueCurrentOtherWindows]);

  // Once P1 is done, trigger P2+P3
  useEffect(() => {
    const p = preloaderRef.current;
    if (!p || !enabled) return;

    p.onIdle = () => {
      if (!hasEnqueuedNextRef.current) {
        hasEnqueuedNextRef.current = true;
        enqueueNextTask();
      }
    };

    return () => { if (p) p.onIdle = undefined; };
  }, [enabled, enqueueNextTask]);

  // On viewport change, re-enqueue P1
  useEffect(() => {
    if (!enabled || !map) return;

    const handleMoveEnd = () => {
      hasEnqueuedCurrentRef.current = false;
      hasEnqueuedNextRef.current = false;

      const p = preloaderRef.current;
      if (!p) return;

      p.clear();

      if (layerManager && !layerManager.busy) {
        hasEnqueuedCurrentRef.current = true;
        enqueueCurrentOtherWindows();
      }
    };

    map.on('moveend', handleMoveEnd);
    return () => { map.un('moveend', handleMoveEnd); };
  }, [enabled, map, layerManager, enqueueCurrentOtherWindows]);

  // On task navigation, clear everything
  useEffect(() => {
    const p = preloaderRef.current;
    if (!p) return;

    p.clear();
    p.clearCache();
    hasEnqueuedCurrentRef.current = false;
    hasEnqueuedNextRef.current = false;
  }, [currentTaskIndex]);

  // When sliceLayerMap updates, trigger if idle
  useEffect(() => {
    if (!enabled || !layerManager) return;
    if (!layerManager.busy && !hasEnqueuedCurrentRef.current) {
      hasEnqueuedCurrentRef.current = true;
      enqueueCurrentOtherWindows();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceLayerMap]);
}
