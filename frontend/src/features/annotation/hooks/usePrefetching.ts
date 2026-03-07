import { useEffect, useRef, useCallback } from 'react';
import { fromLonLat } from 'ol/proj';
import type { LayerManager, PrefetchStatsSnapshot } from '../components/Map/layerManager';
import { makeLayerId } from '../components/Map/useSliceLayers';
import type { ImageryWithWindowsOut } from '~/api/client';
import useAnnotationStore from '../annotation.store';
import { computeTimeSlices, extractLatLonFromWKT } from '~/shared/utils/utility';
import type { SliceLayerMap } from './useStacAllSlices';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface PrefetchConfig {
    mode: 'tasks' | 'open';
    imagery: ImageryWithWindowsOut | null;
    layerManager: LayerManager | null;
    sliceLayerMap: SliceLayerMap;
    /** Stats callback - called from outside React render cycle. */
    onStats?: (stats: PrefetchStatsSnapshot) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

/**
 * Configures the PrefetchManager on the LayerManager according to the
 * campaign mode.
 *
 * **Task mode:**
 *   - No spatial prefetching (the viewport doesn't pan spatially).
 *   - Background layers = first available slice of every time-window of
 *     the current task. Priority increases with distance from the initial
 *     window.
 *   - Next-nav target = the next task's location. Prefetch the initial
 *     window's first available slice there.
 *
 * **Open mode:**
 *   - Spatial prefetching enabled for the active layer.
 *   - Background layers = all other registered imagery layers.
 *   - No next-nav targets.
 *
 * The hook is stable: it reacts only to meaningful state changes and never
 * causes parent re-renders.
 */
export function usePrefetching({
    mode,
    imagery,
    layerManager,
    sliceLayerMap,
    onStats,
}: PrefetchConfig) {
    const onStatsRef = useRef(onStats);
    onStatsRef.current = onStats;

    const prefetchInitializedRef = useRef(false);
    const lastActiveKeyRef = useRef('');
    const lastBgKeyRef = useRef('');
    const lastNextNavKeyRef = useRef('');

    // Store subscriptions (read once per effect, not reactive in React sense)
    const activeWindowId = useAnnotationStore((s) => s.activeWindowId);
    const activeSliceIndex = useAnnotationStore((s) => s.activeSliceIndex);
    const selectedLayerIndex = useAnnotationStore((s) => s.selectedLayerIndex);
    const currentTaskIndex = useAnnotationStore((s) => s.currentTaskIndex);
    const visibleTasks = useAnnotationStore((s) => s.visibleTasks);

    // ── Initialise PrefetchManager once ──────────────────────────────────

    useEffect(() => {
        if (!layerManager || !imagery) return;
        if (prefetchInitializedRef.current) return;

        const isTaskMode = mode === 'tasks';

        layerManager.initPrefetching({
            spatialBufferFactor: isTaskMode ? 0 : 0.5,
            maxConcurrent: 6,
            enableSpatial: !isTaskMode,
        });

        // Wire up stats
        layerManager.onPrefetchStats((stats) => {
            onStatsRef.current?.(stats);
        });

        prefetchInitializedRef.current = true;

        return () => {
            prefetchInitializedRef.current = false;
        };
    }, [layerManager, imagery, mode]);

    // ── Helper: find the first available slice layer ID for a window ─────

    const findFirstAvailableSliceLayerId = useCallback(
        (windowId: number, vizTemplateId: number): string | null => {
            if (!imagery) return null;
            const window = imagery.windows.find((w) => w.id === windowId);
            if (!window) return null;

            const slices = computeTimeSlices(
                window.window_start_date,
                window.window_end_date,
                imagery.slicing_interval,
                imagery.slicing_unit,
            );

            for (const slice of slices) {
                const sliceKey = `${windowId}-${slice.index}`;
                if (sliceLayerMap.has(sliceKey)) {
                    return makeLayerId(windowId, slice.index, vizTemplateId);
                }
            }
            return null;
        },
        [imagery, sliceLayerMap],
    );

    // ── Task Mode: configure background layers & next-nav ────────────────

    useEffect(() => {
        if (mode !== 'tasks' || !layerManager || !imagery) return;
        if (!prefetchInitializedRef.current) return;

        const vizTemplates = imagery.visualization_url_templates ?? [];
        const activeVizTemplate = vizTemplates[selectedLayerIndex] ?? vizTemplates[0];
        if (!activeVizTemplate) return;

        const effectiveActiveWindowId =
            activeWindowId ?? imagery.default_main_window_id ?? imagery.windows[0]?.id;
        if (effectiveActiveWindowId == null) return;

        // -- Active layer for prefetching --
        const activeLayerId = makeLayerId(
            effectiveActiveWindowId,
            activeSliceIndex,
            activeVizTemplate.id,
        );

        // Only update the active layer if it actually changed
        const activeKey = activeLayerId;
        if (activeKey !== lastActiveKeyRef.current) {
            lastActiveKeyRef.current = activeKey;
            layerManager.setPrefetchActiveLayer(activeLayerId);
        }

        // -- Background layers: first available slice of every OTHER window --
        // Sort windows by distance from the active window's index, so nearby
        // windows get prefetched first.
        const activeWindowIndex = imagery.windows.findIndex(
            (w) => w.id === effectiveActiveWindowId,
        );

        const bgEntries: Array<{ layerId: string; priority: number }> = [];

        // For the active window, add all OTHER slices as background
        {
            const activeWindow = imagery.windows.find(
                (w) => w.id === effectiveActiveWindowId,
            );
            if (activeWindow) {
                const slices = computeTimeSlices(
                    activeWindow.window_start_date,
                    activeWindow.window_end_date,
                    imagery.slicing_interval,
                    imagery.slicing_unit,
                );
                for (const slice of slices) {
                    if (slice.index === activeSliceIndex) continue;
                    const sliceKey = `${effectiveActiveWindowId}-${slice.index}`;
                    if (!sliceLayerMap.has(sliceKey)) continue;
                    const layerId = makeLayerId(
                        effectiveActiveWindowId,
                        slice.index,
                        activeVizTemplate.id,
                    );
                    // Priority: close slices first (distance from active slice)
                    const dist = Math.abs(slice.index - activeSliceIndex);
                    bgEntries.push({ layerId, priority: dist });
                }
            }
        }

        // For other windows, add first available slice
        const sortedWindows = [...imagery.windows]
            .map((w, originalIdx) => ({ window: w, originalIdx }))
            .filter((item) => item.window.id !== effectiveActiveWindowId)
            .sort(
                (a, b) =>
                    Math.abs(a.originalIdx - activeWindowIndex) -
                    Math.abs(b.originalIdx - activeWindowIndex),
            );

        for (let i = 0; i < sortedWindows.length; i++) {
            const { window: w } = sortedWindows[i];
            const layerId = findFirstAvailableSliceLayerId(
                w.id,
                activeVizTemplate.id,
            );
            if (layerId) {
                // Priority offset so other-window layers come after active-window slices
                bgEntries.push({ layerId, priority: 100 + i });
            }
        }

        // Only call syncBackgroundLayers if the list actually changed
        const bgKey = bgEntries.map((e) => `${e.layerId}:${e.priority}`).join(',');
        if (bgKey !== lastBgKeyRef.current) {
            lastBgKeyRef.current = bgKey;
            layerManager.setBackgroundLayers(bgEntries);
        }

        // -- Next-nav target: the next task's location --
        const currentTask = visibleTasks[currentTaskIndex];
        const nextIndex =
            currentTaskIndex < visibleTasks.length - 1
                ? currentTaskIndex + 1
                : 0;
        const nextTask = visibleTasks[nextIndex];

        let nextNavKey = 'none';
        if (nextTask && nextTask !== currentTask) {
            const latLon = extractLatLonFromWKT(nextTask.geometry.geometry);
            if (latLon) {
                const center = fromLonLat([latLon.lon, latLon.lat]);
                const zoom = imagery.default_zoom ?? 10;
                nextNavKey = `${latLon.lat},${latLon.lon},${zoom}`;

                if (nextNavKey !== lastNextNavKeyRef.current) {
                    lastNextNavKeyRef.current = nextNavKey;
                    layerManager.setPrefetchNextTargets([{ center: center as [number, number], zoom }]);

                    // Set the next-nav primary layer = first available slice of the
                    // initial window at that location
                    const defaultWindowId =
                        imagery.default_main_window_id ?? imagery.windows[0]?.id;
                    if (defaultWindowId != null) {
                        const nextNavLayerId = findFirstAvailableSliceLayerId(
                            defaultWindowId,
                            activeVizTemplate.id,
                        );
                        if (nextNavLayerId) {
                            layerManager.setPrefetchNextNavLayer(nextNavLayerId);
                        }
                    }
                }
            }
        } else if (lastNextNavKeyRef.current !== 'none') {
            lastNextNavKeyRef.current = 'none';
            layerManager.clearPrefetchNextTargets();
        }

    }, [
        mode,
        layerManager,
        imagery,
        activeWindowId,
        activeSliceIndex,
        selectedLayerIndex,
        currentTaskIndex,
        visibleTasks,
        sliceLayerMap,
        findFirstAvailableSliceLayerId,
    ]);

    // ── Open Mode: configure spatial + background layers ─────────────────

    useEffect(() => {
        if (mode !== 'open' || !layerManager || !imagery) return;
        if (!prefetchInitializedRef.current) return;

        const vizTemplates = imagery.visualization_url_templates ?? [];
        const activeVizTemplate = vizTemplates[selectedLayerIndex] ?? vizTemplates[0];
        if (!activeVizTemplate) return;

        const effectiveActiveWindowId =
            activeWindowId ?? imagery.default_main_window_id ?? imagery.windows[0]?.id;
        if (effectiveActiveWindowId == null) return;

        // Active layer for spatial prefetching
        const activeLayerId = makeLayerId(
            effectiveActiveWindowId,
            activeSliceIndex,
            activeVizTemplate.id,
        );

        const activeKey = activeLayerId;
        if (activeKey !== lastActiveKeyRef.current) {
            lastActiveKeyRef.current = activeKey;
            layerManager.setPrefetchActiveLayer(activeLayerId);
        }

        // Background: all other viz template layers at the same window/slice
        const bgEntries: Array<{ layerId: string; priority: number }> = [];
        for (let i = 0; i < vizTemplates.length; i++) {
            if (i === selectedLayerIndex) continue;
            const t = vizTemplates[i];
            const layerId = makeLayerId(
                effectiveActiveWindowId,
                activeSliceIndex,
                t.id,
            );
            bgEntries.push({ layerId, priority: i });
        }

        const bgKey = bgEntries.map((e) => `${e.layerId}:${e.priority}`).join(',');
        if (bgKey !== lastBgKeyRef.current) {
            lastBgKeyRef.current = bgKey;
            layerManager.setBackgroundLayers(bgEntries);
        }

        // No next-nav targets in open mode
        if (lastNextNavKeyRef.current !== 'none') {
            lastNextNavKeyRef.current = 'none';
            layerManager.clearPrefetchNextTargets();
        }

    }, [
        mode,
        layerManager,
        imagery,
        activeWindowId,
        activeSliceIndex,
        selectedLayerIndex,
        sliceLayerMap,
    ]);
}
