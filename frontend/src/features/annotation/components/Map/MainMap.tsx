import { LayerManager } from './layerManager';
import { useEffect, useRef, useState, memo } from 'react';
import Map from './Map';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import { XYZLayer } from './Layer';
import type { Layer } from './Layer';
import { useStacImagery } from '../../hooks/useStacImagery';
import type { ImageryWithWindowsOut } from '~/api/client';
import PrefetchStatsOverlay from './PrefetchStatsOverlay';

interface MainMapProps {
    imagery?: ImageryWithWindowsOut | null;
    bbox?: [number, number, number, number];
    startDate?: string;
    endDate?: string;
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
    /**
     * Next anticipated navigation target [lat, lon] + zoom.
     * When set, the prefetcher pre-warms tiles at that location before the user arrives.
     * Pass null to clear (e.g. in open mode).
     */
    nextNavTarget?: { latLon: [number, number]; zoom: number } | null;
}

const MainMap = ({
    imagery = null,
    bbox = [0, 0, 0, 0],
    startDate = '',
    endDate = '',
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
    nextNavTarget,
}: MainMapProps) => {
    const mapRef = useRef<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const crosshairOverlayRef = useRef<Overlay | null>(null);
    const crosshairElRef = useRef<HTMLDivElement | null>(null);
    // Refs that bridge the map-ready callback (created once) with values that arrive later
    const tileUrlsRef = useRef<typeof tileUrls>([]);
    const mapReadyRef = useRef(false);
    // Keep onViewChange in a ref so moveend never needs re-registration
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;

    const [layers, setLayers] = useState<Layer[]>([]);
    const [activeLayerId, setActiveLayerId] = useState<string>('');
    const [prefetchStats, setPrefetchStats] = useState<Parameters<typeof PrefetchStatsOverlay>[0]['stats']>(null);

    const { tileUrls, loading: stacLoading, error: stacError } = useStacImagery({
        registrationUrl: imagery?.registration_url ?? '',
        searchBody: imagery?.search_body ?? {},
        bbox,
        startDate,
        endDate,
        visualizationUrlTemplates: imagery?.visualization_url_templates ?? [],
        enabled: !!imagery,
    });

    // Shared logic: register resolved STAC tile URLs as layers and auto-select the first one.
    // Called both from onMapReady (if tileUrls already resolved) and from the tileUrls effect.
    const applyTileUrls = (urls: typeof tileUrls) => {
        const lm = layerManagerRef.current;
        if (!lm || urls.length === 0) return;

        lm.getLayers()
            .filter((l) => l.id.startsWith('stac-'))
            .forEach((l) => lm.removeLayer(l.id));

        urls.forEach(({ id, name, url }) => {
            lm.registerLayer(new XYZLayer({ id: `stac-${id}`, name, layerType: 'imagery', urlTemplate: url }));
        });

        const firstId = `stac-${urls[0].id}`;
        lm.setActiveLayer(firstId);
        setActiveLayerId(firstId);
        const updatedLayers = lm.getLayers();
        setLayers(updatedLayers);
        onLayersChange?.(updatedLayers, firstId);
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

    // When resolved tile URLs arrive, register them as XYZLayers and auto-select the first one.
    // Always keep the ref up to date. If the map is already ready, apply immediately;
    // otherwise onMapReady will read from the ref and apply them there.
    useEffect(() => {
        tileUrlsRef.current = tileUrls;
        if (mapReadyRef.current) {
            applyTileUrls(tileUrls);
        }
    }, [tileUrls]);

    // Dispose the LayerManager (and its PrefetchManager) when the map unmounts
    useEffect(() => {
        return () => {
            layerManagerRef.current?.dispose();
        };
    }, []);

    // Pan the map when `center` changes (e.g. task navigation)
    useEffect(() => {
        if (!center || !mapRef.current) return;
        mapRef.current.getView().animate({ center: fromLonLat([center[1], center[0]]), duration: 300 });
    }, [center]);

    // Recenter when refocusTrigger increments
    const lastRefocusTriggerRef = useRef(refocusTrigger);
    useEffect(() => {
        if (!center || !mapRef.current) return;
        if (refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        mapRef.current.getView().animate({ center: fromLonLat([center[1], center[0]]), zoom: initialZoom, duration: 300 });
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

    const handleLayerSelect = (layerId: string) => {
        if (!layerManagerRef.current) return;
        layerManagerRef.current.setActiveLayer(layerId);
        setActiveLayerId(layerId);
        onLayerSelect?.(layerId);
    };

    // When the controlled active layer id changes from outside, switch the OL layer
    useEffect(() => {
        if (!controlledActiveLayerId || !layerManagerRef.current) return;
        layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
        setActiveLayerId(controlledActiveLayerId);
    }, [controlledActiveLayerId]);

    // Forward next navigation target to the prefetcher so it pre-warms tiles
    // before the user navigates to the next task
    useEffect(() => {
        if (!layerManagerRef.current) return;
        layerManagerRef.current.setNextNavTarget(
            nextNavTarget?.latLon ?? null,
            nextNavTarget?.zoom ?? 10,
        );
    }, [nextNavTarget?.latLon?.[0], nextNavTarget?.latLon?.[1], nextNavTarget?.zoom]);

    const selectedLayer = layers.find((l) => l.id === activeLayerId);

    return (
        <div className="relative w-full h-full" ref={mapContainerRef}>
            {/* Loading indicator while STAC registration is in-flight */}
            {stacLoading && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 text-neutral-700 text-xs px-3 py-1.5 rounded shadow pointer-events-none">
                    Loading imagery…
                </div>
            )}

            {/* STAC registration error */}
            {stacError && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-red-50 text-red-600 text-xs px-3 py-1.5 rounded shadow max-w-xs text-center pointer-events-none">
                    {stacError}
                </div>
            )}

            <Map
                center={initialCenter}
                zoom={initialZoom}
                onMapReady={(map) => {
                    mapRef.current = map;
                    layerManagerRef.current = new LayerManager(map);
                    layerManagerRef.current.onPrefetchStats((stats) => setPrefetchStats({ ...stats }));
                    initBaseLayers();

                    // Mark map as ready and apply any tile URLs that already resolved before mount.
                    mapReadyRef.current = true;
                    applyTileUrls(tileUrlsRef.current);

                    // Publish center+zoom continuously on every frame during pan/zoom.
                    // Using change:center + change:resolution (fires per-frame) instead of
                    // moveend (fires only after gesture ends) to eliminate window sync lag.
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
                    // OL Overlay takes ownership of the DOM node; React must never touch it.
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

                    // Set initial position if crosshair is already active
                    if (crosshair && showCrosshair) {
                        overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
                    }
                }}
            />

            {/* Prefetch stats pill + hover popover */}
            <PrefetchStatsOverlay stats={prefetchStats} />
        </div>
    );
};



export default memo(MainMap);