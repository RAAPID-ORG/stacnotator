/**
 * TaskModeMap - task-mode main map component.
 *
 * Displays STAC imagery tiles on an OL map with crosshair, basemaps,
 * and layer selection. The parent controls navigation by setting `center`
 * and `refocusTrigger`.
 *
 * Layer registration and activation are delegated to the shared
 * `useSliceLayers` hook.
 */

import { useEffect, useRef, memo } from 'react';
import BaseMap from './BaseMap';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import type { Layer } from './Layer';
import type { ImageryWithWindowsOut } from '~/api/client';
import { LayerManager } from './layerManager';
import { useSliceLayers } from './useSliceLayers';

// Props

interface TaskModeMapProps {
    imagery?: ImageryWithWindowsOut | null;
    initialCenter?: [number, number];
    initialZoom?: number;
    /** Reactive: pan the map to this position when it changes. */
    center?: [number, number];
    /** When this increments the map recenters to `center`. */
    refocusTrigger?: number;
    crosshair?: { lat: number; lon: number; color?: string };
    showCrosshair?: boolean;
    onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
    /** Controlled active layer id from outside. */
    activeLayerId?: string;
    /** Called on every pan/zoom so consumers can sync other maps. */
    onViewChange?: (center: [number, number], zoom: number) => void;
    /** Called once the active imagery layer has finished loading. */
    onReady?: () => void;
}

// Component

const TaskModeMap = ({
    imagery = null,
    initialCenter,
    initialZoom,
    center,
    refocusTrigger,
    crosshair,
    showCrosshair = true,
    onLayersChange,
    activeLayerId: controlledActiveLayerId,
    onViewChange,
    onReady,
}: TaskModeMapProps) => {
    const mapRef = useRef<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const mapReadyRef = useRef(false);
    const crosshairOverlayRef = useRef<Overlay | null>(null);
    const crosshairElRef = useRef<HTMLDivElement | null>(null);
    const lastRefocusTriggerRef = useRef(refocusTrigger);

    // Keep callbacks in refs to avoid re-registering OL listeners
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;

    // Shared layer management

    const { layers, activeLayerId, setActiveLayerId, initLayers } = useSliceLayers({
        imagery: imagery ?? null,
        layerManager: layerManagerRef.current,
        mapReady: mapReadyRef.current,
        onReady,
        onLayersChange,
    });

    // Pan to center on task navigation

    useEffect(() => {
        if (!center || !mapRef.current) return;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        mapRef.current.renderSync();
    }, [center]);

    // Recenter when refocusTrigger increments
    useEffect(() => {
        if (!center || !mapRef.current) return;
        if (refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        if (initialZoom !== undefined) view.setZoom(initialZoom);
        mapRef.current.renderSync();
    }, [refocusTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

    // Crosshair overlay

    useEffect(() => {
        const overlay = crosshairOverlayRef.current;
        if (!overlay) return;
        if (crosshair && showCrosshair) {
            overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
        } else {
            overlay.setPosition(undefined);
        }
    }, [crosshair?.lat, crosshair?.lon, showCrosshair]);

    // External active layer control

    useEffect(() => {
        if (!controlledActiveLayerId || !layerManagerRef.current) return;
        layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
        setActiveLayerId(controlledActiveLayerId);
    }, [controlledActiveLayerId, setActiveLayerId]);

    // Render

    return (
        <div className="relative w-full h-full">
            <BaseMap
                center={initialCenter}
                zoom={initialZoom}
                onMapReady={(map) => {
                    mapRef.current = map;
                    const lm = new LayerManager(map);
                    layerManagerRef.current = lm;
                    mapReadyRef.current = true;

                    initLayers(lm);

                    // Publish view changes on every frame during pan/zoom
                    const view = map.getView();
                    const syncView = () => {
                        const olCenter = view.getCenter();
                        const z = view.getZoom();
                        if (!olCenter || z === undefined) return;
                        const [lon, lat] = toLonLat(olCenter);
                        onViewChangeRef.current?.([lat, lon], z);
                    };
                    view.on('change:center', syncView);
                    view.on('change:resolution', syncView);

                    // Create crosshair overlay imperatively
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
        </div>
    );
};

export default memo(TaskModeMap);
