import { useEffect, useRef, useState, useCallback } from 'react';
import type { LayerManager } from './layerManager';
import { XYZLayer } from './Layer';
import type { Layer } from './Layer';
import type { ImageryWithWindowsOut } from '~/api/client';
import { useSliceLayerMap } from '../../context/SliceLayerMapContext';
import useAnnotationStore from '../../annotation.store';
import { computeTimeSlices } from '~/shared/utils/utility';

// ── Basemap definitions ─────────────────────────────────────────────────

export const BASEMAP_LAYERS = [
    new XYZLayer({
        id: 'esri-world-imagery',
        name: 'ESRI World Imagery',
        layerType: 'basemap',
        urlTemplate:
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles © Esri',
    }),
    new XYZLayer({
        id: 'opentopomap',
        name: 'OpenTopoMap',
        layerType: 'basemap',
        urlTemplate: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap contributors',
    }),
];

// ── Layer ID convention ─────────────────────────────────────────────────

/** Stable layer ID: `stac-w{windowId}-s{sliceIndex}-v{templateId}` */
export function makeLayerId(windowId: number, sliceIndex: number, templateId: number): string {
    return `stac-w${windowId}-s${sliceIndex}-v${templateId}`;
}

// ── Hook ────────────────────────────────────────────────────────────────

interface UseSliceLayersOptions {
    imagery: ImageryWithWindowsOut | null;
    layerManager: LayerManager | null;
    mapReady: boolean;
    /** Called once when the active layer finishes rendering. */
    onReady?: () => void;
    /** Called whenever the UI-visible layer list changes. */
    onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
}

/**
 * Shared hook that manages STAC slice layer registration + active layer selection.
 *
 * Used by both TaskModeMap (task mode) and OpenModeMap (open mode).
 * Responsibilities:
 *   - Register basemap layers once on init
 *   - Incrementally register STAC imagery layers as sliceLayerMap grows
 *   - Activate the correct layer when window/slice/viz selection changes
 *   - Build the deduplicated UI layer list for the LayerSelector
 *
 * Returns the current layers and activeLayerId for the selector UI.
 */
export function useSliceLayers({
    imagery,
    layerManager,
    mapReady,
    onReady,
    onLayersChange,
}: UseSliceLayersOptions) {
    const [layers, setLayers] = useState<Layer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState('');

    // Pre-resolved slice → tile URL map from context
    const { sliceLayerMap } = useSliceLayerMap();

    // Store subscriptions
    const activeWindowId = useAnnotationStore((s) => s.activeWindowId);
    const activeSliceIndex = useAnnotationStore((s) => s.activeSliceIndex);
    const selectedLayerIndex = useAnnotationStore((s) => s.selectedLayerIndex);

    const effectiveActiveWindowId =
        activeWindowId ?? imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;

    const vizTemplates = imagery?.visualization_url_templates ?? [];
    const activeVizTemplate = vizTemplates[selectedLayerIndex] ?? vizTemplates[0] ?? null;

    // Refs for one-shot callbacks
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const hasCalledOnReadyRef = useRef(false);
    const registeredSliceKeysRef = useRef<Set<string>>(new Set());
    const prevImageryIdRef = useRef<number | null>(null);

    // ── Activate the correct layer for the current selection ─────────────

    const activateCorrectLayer = useCallback((lm: LayerManager) => {
        if (!imagery || !activeVizTemplate) return;

        const targetId = makeLayerId(
            effectiveActiveWindowId ?? imagery.windows[0]?.id,
            activeSliceIndex,
            activeVizTemplate.id,
        );

        lm.setActiveLayer(targetId);
        setActiveLayerId(targetId);

        // Fire onReady once after the first active layer renders
        if (!hasCalledOnReadyRef.current && onReadyRef.current) {
            hasCalledOnReadyRef.current = true;
            lm.onceActiveLayerRendered(() => { onReadyRef.current?.(); });
        }

        // Build deduplicated layer list for the selector UI:
        // one entry per viz template (at the current window + slice) + basemaps
        const allLayers = lm.getLayers();
        const basemapLayers = allLayers.filter((l) => l.layerType === 'basemap');
        const vizLayers = (imagery.visualization_url_templates ?? [])
            .map((t) => {
                const id = makeLayerId(
                    effectiveActiveWindowId ?? imagery.windows[0]?.id,
                    activeSliceIndex,
                    t.id,
                );
                return allLayers.find((l) => l.id === id) ?? null;
            })
            .filter((l): l is Layer => l !== null);

        const uiLayers = [...vizLayers, ...basemapLayers];
        setLayers(uiLayers);
        onLayersChange?.(uiLayers, targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imagery?.id, effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id]);

    // ── Register STAC slice layers incrementally ────────────────────────

    const syncSliceLayers = useCallback((lm: LayerManager, isImageryChange = false) => {
        if (!imagery) return;

        if (isImageryChange) {
            lm.getLayers()
                .filter((l) => l.id.startsWith('stac-'))
                .forEach((l) => lm.removeLayer(l.id));
            registeredSliceKeysRef.current.clear();
        }

        const newLayers: XYZLayer[] = [];

        for (const window of imagery.windows) {
            const slices = computeTimeSlices(
                window.window_start_date,
                window.window_end_date,
                imagery.slicing_interval,
                imagery.slicing_unit,
            );
            for (const slice of slices) {
                const sliceKey = `${window.id}-${slice.index}`;
                const resolvedUrls = sliceLayerMap.get(sliceKey);
                if (!resolvedUrls) continue;
                if (registeredSliceKeysRef.current.has(sliceKey)) continue;

                for (const urlEntry of resolvedUrls) {
                    newLayers.push(new XYZLayer({
                        id: makeLayerId(window.id, slice.index, urlEntry.templateId),
                        name: urlEntry.templateName,
                        layerType: 'imagery',
                        urlTemplate: urlEntry.url,
                    }));
                }
                registeredSliceKeysRef.current.add(sliceKey);
            }
        }

        if (newLayers.length > 0) {
            lm.registerLayers(newLayers);
        }

        activateCorrectLayer(lm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliceLayerMap, imagery?.id, activateCorrectLayer]);

    // ── Init basemaps on first mount ────────────────────────────────────

    const initLayers = useCallback((lm: LayerManager) => {
        for (const bm of BASEMAP_LAYERS) {
            lm.registerLayer(bm);
        }
        lm.setActiveLayer(BASEMAP_LAYERS[0].id);
        const initial = lm.getLayers();
        setLayers(initial);
        setActiveLayerId(BASEMAP_LAYERS[0].id);
        onLayersChange?.(initial, BASEMAP_LAYERS[0].id);

        // Register any already-resolved slices
        syncSliceLayers(lm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncSliceLayers]);

    // ── Sync when sliceLayerMap grows or imagery changes ────────────────

    useEffect(() => {
        if (!layerManager || !mapReady || !imagery) return;
        const isImageryChange = imagery.id !== prevImageryIdRef.current;
        prevImageryIdRef.current = imagery.id;
        syncSliceLayers(layerManager, isImageryChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliceLayerMap, imagery?.id]);

    // ── Re-activate when selection changes ──────────────────────────────

    useEffect(() => {
        if (!layerManager || !mapReady || !imagery) return;
        activateCorrectLayer(layerManager);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id]);

    // ── Dispose on unmount ──────────────────────────────────────────────

    useEffect(() => {
        return () => { layerManager?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        layers,
        activeLayerId,
        setActiveLayerId,
        initLayers,
    };
}
