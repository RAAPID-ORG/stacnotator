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

import { useEffect, useRef, memo, useState } from 'react';
import BaseMap from './BaseMap';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import type { Layer } from './Layer';
import type { ImageryWithWindowsOut } from '~/api/client';
import type { SliceLayerMap } from '../../hooks/useStacRegistration';
import { LayerManager } from './layerManager';
import { useSliceLayers } from './useSliceLayers';
import { useTilePreloading } from './useTilePreloading';
import { useTaskStore } from '../../stores/task.store';
import { useMapStore } from '../../stores/map.store';

// Props

interface TaskModeMapProps {
    imagery?: ImageryWithWindowsOut | null;
    sliceLayerMap: SliceLayerMap;
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
    /** Currently active tool (pan, timeseries, etc.). */
    activeTool?: 'pan' | 'annotate' | 'edit' | 'timeseries';
    /** Called when the user clicks the map while timeseries tool is active. */
    onTimeseriesClick?: (lat: number, lon: number) => void;
    /** Timeseries probe point to display on the map. */
    probePoint?: { lat: number; lon: number } | null;
}

// Component

const TaskModeMap = ({
    imagery = null,
    sliceLayerMap,
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
    activeTool = 'pan',
    onTimeseriesClick,
    probePoint,
}: TaskModeMapProps) => {
    const mapRef = useRef<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const [olMap, setOlMap] = useState<OLMap | null>(null);
    const [layerManager, setLayerManager] = useState<LayerManager | null>(null);
    const mapReadyRef = useRef(false);
    const crosshairOverlayRef = useRef<Overlay | null>(null);
    const crosshairElRef = useRef<HTMLDivElement | null>(null);
    const probeOverlayRef = useRef<Overlay | null>(null);
    const lastRefocusTriggerRef = useRef(refocusTrigger);

    // Keep callbacks in refs to avoid re-registering OL listeners
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;
    const onTimeseriesClickRef = useRef(onTimeseriesClick);
    onTimeseriesClickRef.current = onTimeseriesClick;

    // Store subscriptions for preloading
    const visibleTasks = useTaskStore((s) => s.visibleTasks);
    const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
    const activeWindowId = useMapStore((s) => s.activeWindowId);
    const zoomInTrigger = useMapStore((s) => s.zoomInTrigger);
    const zoomOutTrigger = useMapStore((s) => s.zoomOutTrigger);
    const panTrigger = useMapStore((s) => s.panTrigger);

    // Resolved active window ID
    const effectiveActiveWindowId = activeWindowId ?? imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;

    // Shared layer management

    const { layers, activeLayerId, setActiveLayerId, initLayers } = useSliceLayers({
        imagery: imagery ?? null,
        layerManager: layerManagerRef.current,
        mapReady: mapReadyRef.current,
        sliceLayerMap,
        onReady,
        onLayersChange,
    });

    // Tile preloading (task mode only - keeps other windows + next task warm)
    useTilePreloading({
        map: olMap,
        layerManager,
        imagery: imagery ?? null,
        sliceLayerMap,
        activeWindowId: effectiveActiveWindowId,
        visibleTasks,
        currentTaskIndex,
        defaultZoom: imagery?.default_zoom ?? 10,
        enabled: false,
    });

    // Pan to center + reset zoom on task navigation

    useEffect(() => {
        if (!center || !mapRef.current) return;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        // Reset zoom to default on every task change so prefetched tiles
        // (which are always at defaultZoom) are cache hits.
        if (initialZoom !== undefined) view.setZoom(initialZoom);
        mapRef.current.renderSync();
    }, [center, initialZoom]);

    // Recenter when refocusTrigger increments (keep current zoom)
    useEffect(() => {
        if (!center || !mapRef.current) return;
        if (refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        const view = mapRef.current.getView();
        view.setCenter(fromLonLat([center[1], center[0]]));
        mapRef.current.renderSync();
    }, [refocusTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keyboard zoom in
    useEffect(() => {
        if (!zoomInTrigger || !mapRef.current) return;
        const view = mapRef.current.getView();
        const currentZoom = view.getZoom();
        if (currentZoom !== undefined) {
            view.animate({ zoom: currentZoom + 1, duration: 200 });
        }
    }, [zoomInTrigger]);

    // Keyboard zoom out
    useEffect(() => {
        if (!zoomOutTrigger || !mapRef.current) return;
        const view = mapRef.current.getView();
        const currentZoom = view.getZoom();
        if (currentZoom !== undefined) {
            view.animate({ zoom: currentZoom - 1, duration: 200 });
        }
    }, [zoomOutTrigger]);

    // Keyboard pan
    useEffect(() => {
        if (!panTrigger.count || !mapRef.current) return;
        const view = mapRef.current.getView();
        const resolution = view.getResolution();
        const currentCenter = view.getCenter();
        if (!resolution || !currentCenter) return;

        const panDistance = resolution * 100; // pan ~100 pixels
        let [x, y] = currentCenter;
        switch (panTrigger.direction) {
            case 'up':    y += panDistance; break;
            case 'down':  y -= panDistance; break;
            case 'left':  x -= panDistance; break;
            case 'right': x += panDistance; break;
        }
        view.animate({ center: [x, y], duration: 150 });
    }, [panTrigger]);

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

    // Probe marker overlay

    useEffect(() => {
        const overlay = probeOverlayRef.current;
        if (!overlay) return;
        if (probePoint) {
            overlay.setPosition(fromLonLat([probePoint.lon, probePoint.lat]));
        } else {
            overlay.setPosition(undefined);
        }
    }, [probePoint?.lat, probePoint?.lon, probePoint]);

    // Timeseries probe click handler

    useEffect(() => {
        const map = mapRef.current;
        if (!map || activeTool !== 'timeseries') return;

        const handler = (e: { coordinate: number[] }) => {
            const [lon, lat] = toLonLat(e.coordinate);
            onTimeseriesClickRef.current?.(lat, lon);
        };
        map.on('singleclick', handler as any);
        map.getTargetElement().style.cursor = 'crosshair';

        return () => {
            map.un('singleclick', handler as any);
            map.getTargetElement().style.cursor = '';
        };
    }, [activeTool]);

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

                    // Expose to state so hooks (e.g. useTilePreloading) can subscribe
                    setOlMap(map);
                    setLayerManager(lm);

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

                    // Create probe marker overlay
                    const probeEl = document.createElement('div');
                    probeEl.className = 'probe-marker';
                    probeEl.style.pointerEvents = 'none';

                    const probeOverlay = new Overlay({
                        element: probeEl,
                        positioning: 'center-center',
                        stopEvent: false,
                    });
                    map.addOverlay(probeOverlay);
                    probeOverlayRef.current = probeOverlay;
                }}
            />
        </div>
    );
};

export default memo(TaskModeMap);
