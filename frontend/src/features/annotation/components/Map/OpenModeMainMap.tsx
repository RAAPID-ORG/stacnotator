/**
 * OpenModeMainMap
 *
 * The OL-based main map for open-mode annotation.  It is the open-mode
 * counterpart of MainMap (which is used in task-mode).
 *
 * Key differences from MainMap:
 *   - Manages only the spatially-visible tiles; no cross-task prefetch target.
 *   - The PrefetchManager is initialised with a tighter spatial buffer only —
 *     no `nextNavTarget` forwarding.
 *   - Mounts OLMapWithDraw to handle annotation drawing and editing on the
 *     same OL map instance (shared canvas, different layer stack).
 *   - Layer management is identical to MainMap (STAC slices from the
 *     SliceLayerMapContext + two basemap layers).
 *
 * View sync:
 *   Every view change (pan / zoom) fires `onViewChange([lat,lon], zoom)` so
 *   the parent can update the store, which the imagery-window maps (WindowMap)
 *   subscribe to and mirror frame-by-frame.
 */

import { useEffect, useRef, useState, memo, useCallback, forwardRef, useImperativeHandle } from 'react';
import type OLMap from 'ol/Map';
import { fromLonLat, toLonLat } from 'ol/proj';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import { GeoJSON as OLGeoJSON } from 'ol/format';

import Map from './Map';
import OLMapWithDraw from './OLMapWithDraw';
import { LayerManager } from './layerManager';
import { XYZLayer } from './Layer';
import type { Layer } from './Layer';
import LayerSelector from './LayerSelector';
import PrefetchStatsOverlay from './PrefetchStatsOverlay';

import type { ImageryWithWindowsOut } from '~/api/client';
import { useSliceLayerMap } from '../../context/SliceLayerMapContext';
import { computeTimeSlices, convertWKTToGeoJSON } from '~/shared/utils/utility';
import useAnnotationStore from '../../annotation.store';
import type { ExtendedLabel } from '../ControlsOpenMode';

// ---------------------------------------------------------------------------
// Layer ID convention (mirrors MainMap)
// ---------------------------------------------------------------------------

function makeLayerId(windowId: number, sliceIndex: number, templateId: number): string {
    return `stac-w${windowId}-s${sliceIndex}-v${templateId}`;
}

// ---------------------------------------------------------------------------
// Basemap definitions
// ---------------------------------------------------------------------------

const BASEMAP_LAYERS = [
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OpenModeMainMapProps {
    imagery: ImageryWithWindowsOut | null;
    /** Set once on mount — the OL map owns its view position after that. */
    initialCenter: [number, number];
    initialZoom: number;
    /** Called on every view change so the store can sync window maps. */
    onViewChange?: (center: [number, number], zoom: number) => void;
    /** Called once the first active imagery layer finishes rendering. */
    onReady?: () => void;
    /** Controlled active layer id — when set externally, switches the map layer. */
    activeLayerId?: string;
    /** Called whenever the layer list or active layer changes. */
    onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
    /** Currently selected label for drawing. */
    selectedLabel: ExtendedLabel | null;
    /** Active tool from the annotation store. */
    activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
    /** Whether magic wand is active for the current label. */
    magicWandActive: boolean;
    /** Called when the timeseries probe tool clicks the map. */
    onTimeseriesClick?: (lat: number, lon: number) => void;
    /** Increment to snap back to initialCenter/initialZoom. */
    refocusTrigger?: number;
}

/** Imperative handle exposed to parents via ref */
export interface OpenModeMainMapHandle {
    /** Animate the view to fit the bounding box of all current annotations. */
    fitAnnotations: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const OpenModeMainMap = forwardRef<OpenModeMainMapHandle, OpenModeMainMapProps>(({
    imagery,
    initialCenter,
    initialZoom,
    onViewChange,
    onReady,
    activeLayerId: controlledActiveLayerId,
    onLayersChange,
    selectedLabel,
    activeTool,
    magicWandActive,
    onTimeseriesClick,
    refocusTrigger,
}, ref) => {
    // ── OL infrastructure ──────────────────────────────────────────────
    const mapRef = useRef<OLMap | null>(null);
    /** Stable OL Map instance stored in state so OLMapWithDraw mounts once it's available */
    const [olMap, setOlMap] = useState<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const mapReadyRef = useRef(false);
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const hasCalledOnReadyRef = useRef(false);



    // Track registered slice keys to avoid double-adding
    const registeredSliceKeysRef = useRef<Set<string>>(new Set());
    const prevImageryIdRef = useRef<number | null | undefined>(null);

    // Layer selector state
    const [layers, setLayers] = useState<Layer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState<string>('');
    const [prefetchSubscribe, setPrefetchSubscribe] = useState<
        Parameters<typeof PrefetchStatsOverlay>[0]['subscribe']
    >(null);

    // ── Pre-resolved slice → tile URL map ──────────────────────────────
    const { sliceLayerMap } = useSliceLayerMap();

    // ── Store subscriptions ────────────────────────────────────────────
    const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
    const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
    const selectedLayerIndex = useAnnotationStore((state) => state.selectedLayerIndex);

    const effectiveActiveWindowId =
        activeWindowId ?? imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;

    const vizTemplates = imagery?.visualization_url_templates ?? [];
    const activeVizTemplate = vizTemplates[selectedLayerIndex] ?? vizTemplates[0] ?? null;

    // ── Imperative handle: fitAnnotations ──────────────────────────────
    const geoJsonFormat = useRef(new OLGeoJSON());

    const doFitAnnotations = useCallback(() => {
        const map = mapRef.current;
        if (!map) return;

        const annotations = useAnnotationStore.getState().annotations;
        if (annotations.length === 0) return;

        const combined = createEmpty();
        let hasExtent = false;

        for (const ann of annotations) {
            const geoJSON = convertWKTToGeoJSON(ann.geometry.geometry);
            if (!geoJSON) continue;
            try {
                const geom = geoJsonFormat.current.readGeometry(geoJSON, {
                    featureProjection: 'EPSG:3857',
                });
                extend(combined, geom.getExtent());
                hasExtent = true;
            } catch {
                // skip malformed geometry
            }
        }

        if (!hasExtent || isEmpty(combined)) return;

        map.getView().fit(combined, {
            padding: [60, 60, 60, 60],
            maxZoom: 18,
            duration: 400,
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mapRef is stable

    useImperativeHandle(ref, () => ({
        fitAnnotations: doFitAnnotations,
    }), [doFitAnnotations]);

    // Watch store trigger for Space-key fitAnnotations
    const fitAnnotationsTrigger = useAnnotationStore((state) => state.fitAnnotationsTrigger);
    const lastFitAnnotationsTriggerRef = useRef(fitAnnotationsTrigger);
    useEffect(() => {
        if (fitAnnotationsTrigger === lastFitAnnotationsTriggerRef.current) return;
        lastFitAnnotationsTriggerRef.current = fitAnnotationsTrigger;
        doFitAnnotations();
    }, [fitAnnotationsTrigger, doFitAnnotations]);

    // Refocus trigger tracking
    const lastRefocusTriggerRef = useRef(refocusTrigger);
    useEffect(() => {
        if (!mapRef.current || refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        mapRef.current.getView().animate({
            center: fromLonLat([initialCenter[1], initialCenter[0]]),
            zoom: initialZoom,
            duration: 300,
        });
    }, [refocusTrigger, initialCenter, initialZoom]);

    // ── Layer helpers (mirrors MainMap logic) ──────────────────────────

    const activateCorrectLayer = useCallback((lm: LayerManager) => {
        if (!imagery || !activeVizTemplate) return;

        const targetId = makeLayerId(
            effectiveActiveWindowId ?? imagery.windows[0]?.id,
            activeSliceIndex,
            activeVizTemplate.id,
        );

        lm.setActiveLayerAndViz(targetId, activeVizTemplate.id);
        setActiveLayerId(targetId);

        if (!hasCalledOnReadyRef.current && onReadyRef.current) {
            hasCalledOnReadyRef.current = true;
            lm.onceActiveLayerRendered(() => { onReadyRef.current?.(); });
        }

        // Build a deduplicated layer list for the layer selector UI
        const allLayers = lm.getLayers();
        const basemapLayers = allLayers.filter((l) => l.layerType === 'basemap');
        const vizLayers = (imagery.visualization_url_templates ?? []).map((t) => {
            const id = makeLayerId(
                effectiveActiveWindowId ?? imagery.windows[0]?.id,
                activeSliceIndex,
                t.id,
            );
            return allLayers.find((l) => l.id === id) ?? null;
        }).filter((l): l is Layer => l !== null);

        const uiLayers = [...vizLayers, ...basemapLayers];
        setLayers(uiLayers);
        onLayersChange?.(uiLayers, targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [imagery?.id, effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id]);

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

    // Re-sync when the slice map grows
    useEffect(() => {
        const lm = layerManagerRef.current;
        if (!lm || !mapReadyRef.current || !imagery) return;
        const isImageryChange = imagery.id !== prevImageryIdRef.current;
        prevImageryIdRef.current = imagery.id;
        syncSliceLayers(lm, isImageryChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliceLayerMap, imagery?.id]);

    // Re-activate correct layer when selection changes
    useEffect(() => {
        const lm = layerManagerRef.current;
        if (!lm || !mapReadyRef.current || !imagery) return;
        activateCorrectLayer(lm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id]);

    // Apply externally-controlled active layer
    useEffect(() => {
        if (!controlledActiveLayerId || !layerManagerRef.current) return;
        layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
        setActiveLayerId(controlledActiveLayerId);
    }, [controlledActiveLayerId]);

    // Dispose LayerManager on unmount
    useEffect(() => {
        return () => { layerManagerRef.current?.dispose(); };
    }, []);

    // ── Render ─────────────────────────────────────────────────────────
    return (
        <div className="relative w-full h-full">
            <Map
                center={initialCenter}
                zoom={initialZoom}
                onMapReady={(map) => {
                    mapRef.current = map;
                    setOlMap(map);

                    const lm = new LayerManager(map);
                    layerManagerRef.current = lm;

                    // Capture prefetch subscribe function for the stats overlay
                    setPrefetchSubscribe(() => lm.onPrefetchStats.bind(lm));

                    // Register basemaps first
                    for (const bm of BASEMAP_LAYERS) {
                        lm.registerLayer(bm);
                    }
                    lm.setActiveLayer(BASEMAP_LAYERS[0].id);
                    const initialLayers = lm.getLayers();
                    setLayers(initialLayers);
                    setActiveLayerId(BASEMAP_LAYERS[0].id);
                    onLayersChange?.(initialLayers, BASEMAP_LAYERS[0].id);

                    mapReadyRef.current = true;

                    // Register any already-resolved slices
                    syncSliceLayers(lm);

                    // Publish view changes every frame during pan/zoom so window maps stay locked
                    const view = map.getView();
                    const syncView = () => {
                        const olCenter = view.getCenter();
                        const zoom = view.getZoom();
                        if (!olCenter || zoom === undefined) return;
                        const [lon, lat] = toLonLat(olCenter);
                        onViewChangeRef.current?.([lat, lon], zoom);
                    };
                    view.on('change:center', syncView);
                    view.on('change:resolution', syncView);
                }}
            />

            {/* Drawing / editing overlay — rendered inside the same container so
                that the floating edit controls (confirm / delete buttons) are
                absolutely-positioned relative to this div. */}
            {olMap && (
                <OLMapWithDraw
                    map={olMap}
                    selectedLabel={selectedLabel}
                    activeTool={activeTool}
                    magicWandActive={magicWandActive}
                    onTimeseriesClick={onTimeseriesClick}
                />
            )}

            {/* Layer selector — top-right inside this component */}
            {layers.length > 0 && (
                <div className="absolute top-2 right-2 z-[1000]">
                    <LayerSelector
                        layers={layers}
                        selectedLayer={layers.find((l) => l.id === activeLayerId)}
                        onLayerSelect={(layerId) => {
                            setActiveLayerId(layerId);
                            onLayersChange?.(layers, layerId);
                        }}
                    />
                </div>
            )}

            {/* Prefetch stats overlay */}
            <PrefetchStatsOverlay subscribe={prefetchSubscribe} />

            {/* Stable crosshair — CSS-only, never moves with the view */}
            <div className="absolute inset-0 pointer-events-none z-[500]" aria-hidden>
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                        <line x1="0" y1="10" x2="20" y2="10" stroke="#ffffff" strokeWidth="1.5" opacity="0.7"/>
                        <line x1="10" y1="0" x2="10" y2="20" stroke="#ffffff" strokeWidth="1.5" opacity="0.7"/>
                    </svg>
                </div>
            </div>
        </div>
    );
});

OpenModeMainMap.displayName = 'OpenModeMainMap';

export default memo(OpenModeMainMap);
