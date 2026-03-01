import { useEffect, useRef, memo } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultInteractions } from 'ol/interaction';
import 'ol/ol.css';

/** Number of tile-load errors with zero successes before we call onEmptyTiles */
const EMPTY_ERROR_THRESHOLD = 4;

interface WindowMapProps {
    // [lat, lon] — initial map position, set once on mount
    initialCenter: [number, number];
    initialZoom: number;
    // Reactive: pan/zoom the map when these change (synced from main map via store)
    center?: [number, number];
    zoom?: number;
    // The single tile URL to display (already resolved by the parent)
    tileUrl: string;
    // Crosshair
    crosshair?: { lat: number; lon: number; color?: string };
    showCrosshair?: boolean;
    // When this increments, animate back to center+initialZoom
    refocusTrigger?: number;
    /**
     * Increment this whenever the task changes so that empty-tile detection
     * counters are reset even when tileUrl stays the same (URLs are registered
     * per campaign bbox, not per task).
     */
    detectionKey?: number;
    /**
     * Called once when the tile source appears empty/broken —
     * i.e. EMPTY_ERROR_THRESHOLD errors occur with no successful loads.
     * Resets whenever tileUrl changes.
     */
    onEmptyTiles?: () => void;
}

const WindowMap = ({
    initialCenter,
    initialZoom,
    center,
    zoom,
    tileUrl,
    crosshair,
    showCrosshair = true,
    refocusTrigger,
    detectionKey,
    onEmptyTiles,
}: WindowMapProps) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<OLMap | null>(null);
    const tileLayerRef = useRef<TileLayer<XYZ> | null>(null);
    const overlayRef = useRef<Overlay | null>(null);
    const overlayElRef = useRef<HTMLDivElement | null>(null);
    const lastRefocusTriggerRef = useRef(refocusTrigger);
    // Keep a stable ref to the latest callback so the tile-swap effect can use it
    const onEmptyTilesRef = useRef(onEmptyTiles);
    useEffect(() => { onEmptyTilesRef.current = onEmptyTiles; }, [onEmptyTiles]);

    // Create the map once on mount
    useEffect(() => {
        if (!containerRef.current) return;

        const source = new XYZ({
            url: tileUrl,
            crossOrigin: 'anonymous',
            cacheSize: 256,
            transition: 0,
        });

        // Track consecutive tile-load errors vs. successes for empty-tile detection
        let errorCount = 0;
        let successCount = 0;
        let emptyFired = false;
        source.on('tileloaderror', () => {
            errorCount++;
            if (!emptyFired && successCount === 0 && errorCount >= EMPTY_ERROR_THRESHOLD) {
                emptyFired = true;
                onEmptyTilesRef.current?.();
            }
        });
        source.on('tileloadend', () => { successCount++; });

        const tileLayer = new TileLayer({
            preload: 4,
            source,
        });
        tileLayerRef.current = tileLayer;

        const map = new OLMap({
            target: containerRef.current,
            layers: [tileLayer],
            maxTilesLoading: 4,  // small — windows only load what's visible, main map gets priority
            view: new View({
                center: fromLonLat([initialCenter[1], initialCenter[0]]),
                zoom: initialZoom,
            }),
            controls: [],
            interactions: defaultInteractions(),
        });

        // Crosshair overlay — created imperatively, not in React tree
        const color = crosshair?.color ?? 'ff0000';
        const el = document.createElement('div');
        el.style.pointerEvents = 'none';
        el.style.width = '20px';
        el.style.height = '20px';
        el.innerHTML =
            `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">` +
            `<line x1="0" y1="10" x2="20" y2="10" stroke="#${color}" stroke-width="1.5"/>` +
            `<line x1="10" y1="0" x2="10" y2="20" stroke="#${color}" stroke-width="1.5"/>` +
            `</svg>`;
        overlayElRef.current = el;

        const overlay = new Overlay({
            element: el,
            positioning: 'center-center',
            stopEvent: false,
        });
        map.addOverlay(overlay);
        overlayRef.current = overlay;

        if (crosshair && showCrosshair) {
            overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
        }

        mapRef.current = map;

        return () => {
            map.setTarget(undefined);
            mapRef.current = null;
            tileLayerRef.current = null;
            overlayRef.current = null;
            overlayElRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- map created once; tileUrl, crosshair handled by effects below
    }, []);

    // Swap tile source when tileUrl changes, and reset empty-tile detection.
    // Also re-runs when detectionKey increments (task navigation) — the URL may
    // be identical across tasks but counters must start fresh each time.
    useEffect(() => {
        if (!tileLayerRef.current || !tileUrl) return;

        const source = new XYZ({
            url: tileUrl,
            crossOrigin: 'anonymous',
            cacheSize: 256,
            transition: 0,
        });

        // Reset counters for the new URL
        let errorCount = 0;
        let successCount = 0;
        let emptyFired = false;
        source.on('tileloaderror', () => {
            errorCount++;
            if (!emptyFired && successCount === 0 && errorCount >= EMPTY_ERROR_THRESHOLD) {
                emptyFired = true;
                onEmptyTilesRef.current?.();
            }
        });
        source.on('tileloadend', () => { successCount++; });

        tileLayerRef.current.setSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tileUrl, detectionKey]);

    // Sync center+zoom from main map (store-driven).
    // Use instant setCenter/setZoom (no animation) so windows track the main map
    // frame-by-frame with zero lag. The main map now fires change:center every frame.
    useEffect(() => {
        if (!center || !mapRef.current) return;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        if (zoom !== undefined) view.setZoom(zoom);
    }, [center, zoom]);

    // Refocus to task center + initial zoom
    useEffect(() => {
        if (!center || !mapRef.current) return;
        if (refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        mapRef.current.getView().animate({
            center: fromLonLat([center[1], center[0]]),
            zoom: initialZoom,
            duration: 300,
        });
    }, [refocusTrigger]);

    // Update crosshair overlay position and color
    useEffect(() => {
        const overlay = overlayRef.current;
        const el = overlayElRef.current;
        if (!overlay) return;
        if (crosshair && showCrosshair) {
            // Update SVG stroke color in case it changed
            if (el) {
                const color = `#${crosshair.color ?? 'ff0000'}`;
                const lines = el.querySelectorAll('line');
                lines.forEach((line) => line.setAttribute('stroke', color));
            }
            overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
        } else {
            overlay.setPosition(undefined);
        }
    }, [crosshair?.lat, crosshair?.lon, crosshair?.color, showCrosshair]);

    return <div ref={containerRef} className="w-full h-full" />;
};

export default memo(WindowMap);
