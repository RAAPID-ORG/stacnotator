import { useEffect, useRef, useState, useCallback } from 'react';
import type { LayerManager } from './layerManager';
import { XYZLayer } from './Layer';
import type { Layer } from './Layer';
import type { ImageryWithWindowsOut } from '~/api/client';
import type { SliceLayerMap } from '../../hooks/useStacRegistration';
import { useMapStore } from '../../stores/map.store';
import { computeTimeSlices } from '~/shared/utils/utility';

// Basemap definitions

export const BASEMAP_LAYERS = [
    new XYZLayer({
        id: 'carto-light',
        name: 'CartoDB Light',
        layerType: 'basemap',
        urlTemplate: 'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap, © CARTO',
        maxZoom: 19,
    }),
    new XYZLayer({
        id: 'esri-world-imagery',
        name: 'ESRI World Imagery',
        layerType: 'basemap',
        urlTemplate:
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles © Esri',
        maxZoom: 17,   // source tile limit - global coverage is solid at z17; OL stretches beyond
    }),
    new XYZLayer({
        id: 'opentopomap',
        name: 'OpenTopoMap',
        layerType: 'basemap',
        urlTemplate: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap contributors',
        maxZoom: 17,   // source tile limit
    }),
];

// Layer ID convention

/** Stable layer ID: `stac-w{windowId}-s{sliceIndex}-v{templateId}` */
export function makeLayerId(windowId: number, sliceIndex: number, templateId: number): string {
    return `stac-w${windowId}-s${sliceIndex}-v${templateId}`;
}

// Hook

interface UseSliceLayersOptions {
    imagery: ImageryWithWindowsOut | null;
    layerManager: LayerManager | null;
    mapReady: boolean;
    /** Pre-resolved STAC tile URLs (from useStacRegistration). */
    sliceLayerMap: SliceLayerMap;
    /** Called once when the active layer finishes rendering. */
    onReady?: () => void;
    /** Called whenever the UI-visible layer list changes. */
    onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
    /** OL preload depth for imagery layers. Use Infinity for open mode. */
    preloadDepth?: number;
}

/**
 * Manages OL layer registration + active layer selection.
 *
 * - Registers basemap layers once on init
 * - Registers all STAC imagery layers at once when sliceLayerMap arrives
 * - Activates the correct layer when window/slice/viz selection changes
 * - Builds the UI layer list for the LayerSelector
 */
export function useSliceLayers({
    imagery,
    layerManager,
    mapReady,
    sliceLayerMap,
    onReady,
    onLayersChange,
    preloadDepth,
}: UseSliceLayersOptions) {
    const [layers, setLayers] = useState<Layer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState('');

    // Store subscriptions
    const activeWindowId = useMapStore((s) => s.activeWindowId);
    const activeSliceIndex = useMapStore((s) => s.activeSliceIndex);
    const selectedLayerIndex = useMapStore((s) => s.selectedLayerIndex);
    const showBasemap = useMapStore((s) => s.showBasemap);
    const basemapType = useMapStore((s) => s.basemapType);

    const effectiveActiveWindowId =
        activeWindowId ?? imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;

    const vizTemplates = imagery?.visualization_url_templates ?? [];
    const activeVizTemplate = vizTemplates[selectedLayerIndex] ?? vizTemplates[0] ?? null;

    // Refs for one-shot callbacks
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const hasCalledOnReadyRef = useRef(false);
    const prevImageryIdRef = useRef<number | null>(null);

    // Activate the correct layer for the current selection

    const activateCorrectLayer = useCallback((lm: LayerManager) => {
        if (!imagery) return;

        // Determine which layer to activate
        let targetId: string;

        if (showBasemap) {
            // Basemap mode: activate the selected basemap layer
            targetId = basemapType;
        } else {
            // STAC imagery mode: activate the correct viz layer
            if (!activeVizTemplate) return;
            targetId = makeLayerId(
                effectiveActiveWindowId ?? imagery.windows[0]?.id,
                activeSliceIndex,
                activeVizTemplate.id,
            );
        }

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
    }, [imagery?.id, effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id, showBasemap, basemapType]);

    // Register STAC slice layers (called once when sliceLayerMap arrives complete)
    const syncSliceLayers = useCallback((lm: LayerManager, isImageryChange = false) => {
        if (!imagery) return;

        if (isImageryChange) {
            lm.getLayers()
                .filter((l) => l.id.startsWith('stac-'))
                .forEach((l) => lm.removeLayer(l.id));
            // Reset ready gate so onReady fires again for the new imagery
            hasCalledOnReadyRef.current = false;
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
                const searchId = sliceLayerMap.get(sliceKey);
                if (!searchId) continue;

                for (const tpl of vizTemplates) {
                    const layerId = makeLayerId(window.id, slice.index, tpl.id);
                    if (lm.getLayerById(layerId)) continue;

                    newLayers.push(new XYZLayer({
                        id: layerId,
                        name: tpl.name,
                        layerType: 'imagery',
                        urlTemplate: tpl.visualization_url.replace(/\{searchId\}/g, searchId),
                        preload: preloadDepth,
                    }));
                }
            }
        }

        if (newLayers.length > 0) {
            lm.registerLayers(newLayers);
        }

        activateCorrectLayer(lm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliceLayerMap, imagery?.id, activateCorrectLayer]);

    // Init basemaps on first mount
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

    // Sync when sliceLayerMap grows or imagery changes (e.g. new imagery selected, or windows/slices change)
    useEffect(() => {
        if (!layerManager || !mapReady || !imagery) return;
        const isImageryChange = imagery.id !== prevImageryIdRef.current;
        prevImageryIdRef.current = imagery.id;
        syncSliceLayers(layerManager, isImageryChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliceLayerMap, imagery?.id]);

    // Re-activate when selection changes
    useEffect(() => {
        if (!layerManager || !mapReady || !imagery) return;
        activateCorrectLayer(layerManager);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id, showBasemap, basemapType]);

    // Dispose on unmount
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
