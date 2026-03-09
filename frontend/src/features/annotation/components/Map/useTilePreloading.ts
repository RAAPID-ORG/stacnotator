/**
 * useTilePreloading – background tile preloading for task mode.
 *
 * Priority levels (lower = higher priority):
 *   P1 – Other windows at the current viewport.
 *   P2 – Next task's default window.
 *   P3 – Next task's other windows.
 *
 * Empty-slice handling:
 *   Before enqueuing tiles for a window, we probe a single tile from
 *   slice 0. If it returns a non-2xx response (empty/nodata), we try
 *   slice 1, then slice 2, etc., until we find one with data.
 *   For current-task windows we also call setWindowSliceIndex so the
 *   UI starts on the correct slice when the user switches to it.
 */

import { useEffect, useRef, useCallback } from 'react';
import { toLonLat } from 'ol/proj';
import type OLMap from 'ol/Map';
import { TilePreloader, tileUrlsForExtent, probeTile } from './tilePreloader';
import type { PreloadJob } from './tilePreloader';
import type { LayerManager } from './layerManager';
import type { SliceLayerMap } from '../../hooks/useStacRegistration';
import type { ImageryWithWindowsOut, AnnotationTaskOut } from '~/api/client';
import { extractLatLonFromWKT } from '~/shared/utils/utility';
import useAnnotationStore from '../../annotation.store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_OTHER_WINDOWS = 1;
const PRIORITY_NEXT_TASK_DEFAULT = 2;
const PRIORITY_NEXT_TASK_OTHER = 3;

const GROUP_CURRENT_OTHER = 'current-other';
const GROUP_NEXT_DEFAULT = 'next-default';
const GROUP_NEXT_OTHER = 'next-other';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
 * Get sorted slice indices registered for a window in the sliceLayerMap.
 */
function sliceIndicesForWindow(windowId: number, sliceLayerMap: SliceLayerMap): number[] {
  const indices: number[] = [];
  for (const key of sliceLayerMap.keys()) {
    const [wId, sIdx] = key.split('-');
    if (Number(wId) === windowId) indices.push(Number(sIdx));
  }
  return indices.sort((a, b) => a - b);
}

/**
 * Find the first slice for a window that has data at the given extent/zoom.
 *
 * Probes one tile per slice. Returns the slice index and its searchId,
 * or null if all slices are empty.
 */
async function findValidSlice(
  windowId: number,
  sliceLayerMap: SliceLayerMap,
  urlTemplateBase: string,
  extent: [number, number, number, number],
  zoom: number,
): Promise<{ sliceIndex: number; searchId: string } | null> {
  const indices = sliceIndicesForWindow(windowId, sliceLayerMap);

  for (const idx of indices) {
    const searchId = sliceLayerMap.get(`${windowId}-${idx}`);
    if (!searchId) continue;

    const urlTemplate = urlTemplateBase.replace(/\{searchId\}/g, searchId);
    // Get one tile URL from the center of the extent to probe
    const probeUrls = tileUrlsForExtent(urlTemplate, extent, zoom);
    if (probeUrls.length === 0) continue;

    // Probe the middle tile (most likely to be representative)
    const probeUrl = probeUrls[Math.floor(probeUrls.length / 2)];
    const ok = await probeTile(probeUrl);
    if (ok) return { sliceIndex: idx, searchId };
  }

  return null;
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

  // Store action — set the starting slice for a window so the UI doesn't
  // flash an empty slice when the user switches to it.
  const setWindowSliceIndex = useAnnotationStore((s) => s.setWindowSliceIndex);
  const setWindowSliceIndexRef = useRef(setWindowSliceIndex);
  setWindowSliceIndexRef.current = setWindowSliceIndex;

  // Create / dispose the preloader
  useEffect(() => {
    if (!enabled) return;
    const p = new TilePreloader();
    preloaderRef.current = p;
    return () => {
      p.dispose();
      preloaderRef.current = null;
    };
  }, [enabled]);

  /**
   * For each non-active window, probe slices to find one with data,
   * update the store's windowSliceIndex, then enqueue the tiles.
   */
  const enqueueCurrentOtherWindows = useCallback(async () => {
    const p = preloaderRef.current;
    const m = mapRef.current;
    const img = imageryRef.current;
    const winId = activeWindowIdRef.current;
    if (!p || !m || !img || winId == null) return;

    const extent = getViewportExtent(m);
    if (!extent) return;
    const zoom = m.getView().getZoom() ?? defaultZoomRef.current;

    const vizTemplate = img.visualization_url_templates[0];
    if (!vizTemplate) return;

    p.abort(GROUP_CURRENT_OTHER);

    const jobs: PreloadJob[] = [];

    for (const win of img.windows) {
      if (win.id === winId) continue;

      const result = await findValidSlice(
        win.id, sliceLayerMapRef.current, vizTemplate.visualization_url, extent, zoom,
      );
      if (!result) continue;

      // Update the store so the UI will start on this slice
      if (result.sliceIndex > 0) {
        setWindowSliceIndexRef.current(win.id, result.sliceIndex);
      }

      const urlTemplate = vizTemplate.visualization_url.replace(
        /\{searchId\}/g, result.searchId,
      );
      jobs.push({
        priority: PRIORITY_OTHER_WINDOWS,
        groupId: GROUP_CURRENT_OTHER,
        urlTemplate,
        extent,
        zoom,
      });
    }

    if (jobs.length > 0) p.enqueueMany(jobs);
  }, []);

  /**
   * Probe + enqueue tiles for the next task's windows.
   */
  const enqueueNextTask = useCallback(async () => {
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

    const vizTemplate = img.visualization_url_templates[0];
    if (!vizTemplate) return;

    const zoom = defaultZoomRef.current;
    const extent = estimateExtent([latLon.lat, latLon.lon], zoom);
    const defaultWindowId = img.default_main_window_id ?? img.windows[0]?.id;

    p.abort(GROUP_NEXT_DEFAULT);
    p.abort(GROUP_NEXT_OTHER);

    const jobs: PreloadJob[] = [];

    for (const win of img.windows) {
      const result = await findValidSlice(
        win.id, sliceLayerMapRef.current, vizTemplate.visualization_url, extent, zoom,
      );
      if (!result) continue;

      const isDefault = win.id === defaultWindowId;
      const urlTemplate = vizTemplate.visualization_url.replace(
        /\{searchId\}/g, result.searchId,
      );
      jobs.push({
        priority: isDefault ? PRIORITY_NEXT_TASK_DEFAULT : PRIORITY_NEXT_TASK_OTHER,
        groupId: isDefault ? GROUP_NEXT_DEFAULT : GROUP_NEXT_OTHER,
        urlTemplate,
        extent,
        zoom,
      });
    }

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

      p.abort(GROUP_CURRENT_OTHER);
      p.abort(GROUP_NEXT_DEFAULT);
      p.abort(GROUP_NEXT_OTHER);

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
