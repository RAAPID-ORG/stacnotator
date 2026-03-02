import { LayerManager } from './layerManager';
import { useEffect, useRef, useState, memo } from 'react';
import Map from './Map';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import { XYZLayer } from './Layer';
import type { Layer } from './Layer';
import type { ImageryWithWindowsOut } from '~/api/client';
import PrefetchStatsOverlay from './PrefetchStatsOverlay';
import { useSliceLayerMap } from '../../context/SliceLayerMapContext';
import { computeTimeSlices } from '~/shared/utils/utility';
import useAnnotationStore from '../../annotation.store';

interface MainMapProps {
    imagery?: ImageryWithWindowsOut | null;
    /** Set once on mount. The OL map owns its view position after that. */
    initialCenter?: [number, number];
    /** Set once on mount. */
    initialZoom?: number;
    /** When this changes the map pans to the new position. */
    center?: [number, number];
    /** When this increments the map recenters to `center`. */
    refocusTrigger?: number;
    crosshair?: { lat: number; lon: number; color?: string };
    showCrosshair?: boolean;
    onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
    onLayerSelect?: (layerId: string) => void;
    /** Controlled active layer id — when set from outside, the map switches to this layer */
    activeLayerId?: string;
    /** Called on moveend/zoomend so consumers can sync other maps */
    onViewChange?: (center: [number, number], zoom: number) => void;
    /** Called once the active imagery layer has finished loading all visible tiles */
    onReady?: () => void;
    /**
     * Called on every prefetch stats tick while the map is loading — useful for
     * showing a live progress text in the loading overlay.
     */
    onPrefetchStats?: (queued: number, loading: number) => void;
    /**
     * Next anticipated navigation target [lat, lon] + zoom.
     * When set, the prefetcher pre-warms tiles at that location before the user arrives.
     * Pass null to clear (e.g. in open mode).
     */
    nextNavTarget?: { latLon: [number, number]; zoom: number } | null;
    /**
     * When true, background prefetch syncing is paused (e.g. during timeline drag).
     * When it flips back to false, one sync is triggered immediately.
     */
    prefetchPaused?: boolean;
    /**
     * When true, spatial prefetching for the active layer is disabled.
     * Background (window warming) and next-nav prefetch are unaffected.
     * Use this in task mode where the viewport is fixed per task and
     * loading tiles around it wastes bandwidth.
     */
    disableSpatialPrefetch?: boolean;
}

/**
 * Stable layer ID for the STAC imagery layer for a specific window + slice + viz template.
 * Format: `stac-w{windowId}-s{sliceIndex}-v{templateId}`
 */
function makeLayerId(windowId: number, sliceIndex: number, templateId: number): string {
    return `stac-w${windowId}-s${sliceIndex}-v${templateId}`;
}

const MainMap = ({
    imagery = null,
    initialCenter,
    initialZoom,
    center,
    refocusTrigger,
    crosshair,
    showCrosshair = true,
    onLayersChange,
    onLayerSelect,
    activeLayerId: controlledActiveLayerId,
    onViewChange,
    onReady,
    onPrefetchStats,
    nextNavTarget,
    prefetchPaused = false,
    disableSpatialPrefetch = false,
}: MainMapProps) => {
    const mapRef = useRef<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const crosshairOverlayRef = useRef<Overlay | null>(null);
    const crosshairElRef = useRef<HTMLDivElement | null>(null);
    const mapReadyRef = useRef(false);
    // Keep onViewChange in a ref so view listeners never need re-registration
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;
    // Keep onReady in a ref; fire it only once after the first active layer renders
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    const hasCalledOnReadyRef = useRef(false);
    // Keep onPrefetchStats in a ref so the subscription never needs re-registering
    const onPrefetchStatsRef = useRef(onPrefetchStats);
    onPrefetchStatsRef.current = onPrefetchStats;
    // Track which slice keys have already been registered as OL layers
    const registeredSliceKeysRef = useRef<Set<string>>(new Set());

    const [layers, setLayers] = useState<Layer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState<string>('');
    // Stable subscribe function passed to PrefetchStatsOverlay so that component
    // owns its own state. We store it in state (not a ref) so the overlay receives
    // it after onMapReady fires, but it's set only once so there's no re-render churn.
    const [prefetchSubscribe, setPrefetchSubscribe] = useState<Parameters<typeof PrefetchStatsOverlay>[0]['subscribe']>(null);

    // ── Pre-resolved slice → tile URL map from AnnotationPage ──────────────
    const { sliceLayerMap } = useSliceLayerMap();

    // ── Active slice/window/viz selection from the store ───────────────────
    const activeWindowId = useAnnotationStore((state) => state.activeWindowId);
    const activeSliceIndex = useAnnotationStore((state) => state.activeSliceIndex);
    const selectedLayerIndex = useAnnotationStore((state) => state.selectedLayerIndex);

    // Effective active window (fall back to default)
    const effectiveActiveWindowId =
        activeWindowId ?? imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;

    // Derive the currently-selected viz template
    const vizTemplates = imagery?.visualization_url_templates ?? [];
    const activeVizTemplate = vizTemplates[selectedLayerIndex] ?? vizTemplates[0] ?? null;

    // ── Register ALL timepoint layers once the map is ready ────────────────
    // We register every window × every slice × every viz template as an OL layer
    // up-front. The active one is made visible; all others stay hidden.
    // This lets OL prefetch all of them without re-registering on selection change.
    //
    // This function is INCREMENTAL — it only adds layers for slices that have newly
    // arrived in the sliceLayerMap. It never tears down existing layers, so it is
    // safe to call repeatedly as the map is filled in.
    const syncSliceLayers = (lm: LayerManager, isImageryChange = false) => {
        if (!imagery) return;

        // On imagery change, clear all previously registered stac layers
        if (isImageryChange) {
            lm.getLayers()
                .filter((l) => l.id.startsWith('stac-'))
                .forEach((l) => lm.removeLayer(l.id));
            registeredSliceKeysRef.current.clear();
        }

        // Collect newly-arrived layers (batch them for a single _syncPrefetchLayers call)
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
                if (!resolvedUrls) continue; // not yet registered
                if (registeredSliceKeysRef.current.has(sliceKey)) continue; // already added

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

        // Activate the correct layer for the current selection
        activateCorrectLayer(lm);
    };

    /**
     * Make the layer matching the current window/slice/viz active,
     * and tell the LayerManager which viz is "selected" so it can skip
     * non-selected viz layers during prefetch.
     */
    const activateCorrectLayer = (lm: LayerManager) => {
        if (!imagery || !activeVizTemplate) return;

        const targetId = makeLayerId(
            effectiveActiveWindowId ?? imagery.windows[0]?.id,
            activeSliceIndex,
            activeVizTemplate.id,
        );

        lm.setActiveLayerAndViz(targetId, activeVizTemplate.id);
        setActiveLayerId(targetId);

        // Fire onReady once — after the very first imagery layer finishes rendering.
        if (!hasCalledOnReadyRef.current && onReadyRef.current) {
            hasCalledOnReadyRef.current = true;
            lm.onceActiveLayerRendered(
                () => { onReadyRef.current?.(); },
            );
        }

        // Build a deduplicated layer list for the selector UI:
        // - one entry per viz template (using the active window + current slice)
        // - all basemap layers
        // This avoids flooding the selector with window×slice×viz combinations.
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
    };

    const initBaseLayers = () => {
        if (!layerManagerRef.current) return;

        const esriLayer = new XYZLayer({
            id: 'esri-world-imagery',
            name: 'ESRI World Imagery',
            layerType: 'basemap',
            urlTemplate:
                'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles © Esri',
        });

        const topoLayer = new XYZLayer({
            id: 'opentopomap',
            name: 'OpenTopoMap',
            layerType: 'basemap',
            urlTemplate: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors',
        });

        layerManagerRef.current.registerLayer(esriLayer);
        layerManagerRef.current.registerLayer(topoLayer);
        layerManagerRef.current.setActiveLayer(esriLayer.id);

        const initialLayers = layerManagerRef.current.getLayers();
        setLayers(initialLayers);
        setActiveLayerId(esriLayer.id);
        onLayersChange?.(initialLayers, esriLayer.id);
    };

    // Register all slice layers when the sliceLayerMap grows or imagery changes.
    // This fires once after all slice-0s are ready (AnnotationPage unblocks the Canvas
    // only at that point) and again as remaining slices come in.
    // Because syncSliceLayers is incremental it only ever adds new layers, never tears down existing ones.
    const prevImageryIdRef = useRef<number | null | undefined>(null);
    useEffect(() => {
        const lm = layerManagerRef.current;
        if (!lm || !mapReadyRef.current || !imagery) return;
        const isImageryChange = imagery.id !== prevImageryIdRef.current;
        prevImageryIdRef.current = imagery.id;
        syncSliceLayers(lm, isImageryChange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sliceLayerMap, imagery?.id]);

    // Re-activate the correct layer whenever the selection changes
    useEffect(() => {
        const lm = layerManagerRef.current;
        if (!lm || !mapReadyRef.current || !imagery) return;
        activateCorrectLayer(lm);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveActiveWindowId, activeSliceIndex, activeVizTemplate?.id]);

    // Dispose the LayerManager (and its PrefetchManager) when the map unmounts
    useEffect(() => {
        return () => {
            layerManagerRef.current?.dispose();
        };
    }, []);

    // Pan the map when `center` changes (e.g. task navigation).
    // We snap instantly (setCenter/setZoom + renderSync) rather than animating —
    // the prefetcher has already loaded tiles at the destination, so the view
    // appears fully painted on the very first frame with no visible transition.
    useEffect(() => {
        if (!center || !mapRef.current) return;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        mapRef.current.renderSync();
    }, [center]);

    // Recenter when refocusTrigger increments
    const lastRefocusTriggerRef = useRef(refocusTrigger);
    useEffect(() => {
        if (!center || !mapRef.current) return;
        if (refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        if (initialZoom !== undefined) view.setZoom(initialZoom);
        mapRef.current.renderSync();
    }, [refocusTrigger]);

    // Update the OL Overlay position when crosshair prop changes
    useEffect(() => {
        const overlay = crosshairOverlayRef.current;
        if (!overlay) return;
        if (crosshair && showCrosshair) {
            overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
        } else {
            overlay.setPosition(undefined);
        }
    }, [crosshair?.lat, crosshair?.lon, showCrosshair]);

    // When the controlled active layer id changes from outside, switch the OL layer
    useEffect(() => {
        if (!controlledActiveLayerId || !layerManagerRef.current) return;
        layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
        setActiveLayerId(controlledActiveLayerId);
    }, [controlledActiveLayerId]);

    // Forward next navigation target to the prefetcher immediately so it starts
    // warming tiles for the next task as soon as the current task is shown.
    useEffect(() => {
        if (!layerManagerRef.current) return;
        layerManagerRef.current.setNextNavTarget(
            nextNavTarget?.latLon ?? null,
            nextNavTarget?.zoom ?? 10,
        );
    }, [nextNavTarget?.latLon?.[0], nextNavTarget?.latLon?.[1], nextNavTarget?.zoom]);

    // Pause / resume background prefetching (e.g. during timeline drag)
    useEffect(() => {
        const lm = layerManagerRef.current;
        if (!lm) return;
        if (prefetchPaused) {
            lm.pausePrefetch();
        } else {
            lm.resumePrefetch();
        }
    }, [prefetchPaused]);

    // Enable / disable spatial prefetching for the active layer (e.g. task mode).
    useEffect(() => {
        layerManagerRef.current?.setSpatialPrefetchEnabled(!disableSpatialPrefetch);
    }, [disableSpatialPrefetch]);

    return (
        <div className="relative w-full h-full" ref={mapContainerRef}>
            <Map
                center={initialCenter}
                zoom={initialZoom}
                onMapReady={(map) => {
                    mapRef.current = map;
                    layerManagerRef.current = new LayerManager(map);
                    // Capture the subscribe function so PrefetchStatsOverlay can own its own state.
                    // setState is called only once (on map ready) so there's no render churn.
                    const lm = layerManagerRef.current!;
                    setPrefetchSubscribe(() => lm.onPrefetchStats.bind(lm));
                    // Forward live prefetch stats to the consumer (e.g. for overlay progress text).
                    // We subscribe once here; the ref lets the callback always see the latest prop.
                    lm.onPrefetchStats((stats) => {
                        onPrefetchStatsRef.current?.(stats.queued, stats.loading);
                    });
                    initBaseLayers();

                    mapReadyRef.current = true;

                    // Register all pre-resolved slice layers immediately
                    syncSliceLayers(layerManagerRef.current!);

                    // Publish center+zoom continuously on every frame during pan/zoom.
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

                    // Create the crosshair element imperatively — NOT in the React tree.
                    const color = crosshair?.color ?? 'ff0000';
                    const el = document.createElement('div');
                    el.style.pointerEvents = 'none';
                    el.style.width = '20px';
                    el.style.height = '20px';
                    el.innerHTML = `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">` +
                        `<line x1="0" y1="10" x2="20" y2="10" stroke="#${color}" stroke-width="1.5"/>` +
                        `<line x1="10" y1="0" x2="10" y2="20" stroke="#${color}" stroke-width="1.5"/>` +
                        `</svg>`;
                    crosshairElRef.current = el;

                    const overlay = new Overlay({
                        element: el,
                        positioning: 'center-center',
                        stopEvent: false,
                    });
                    map.addOverlay(overlay);
                    crosshairOverlayRef.current = overlay;

                    if (crosshair && showCrosshair) {
                        overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
                    }
                }}
            />

            {/* Prefetch stats pill + hover popover */}
            <PrefetchStatsOverlay subscribe={prefetchSubscribe} />
        </div>
    );
};

export default memo(MainMap);
