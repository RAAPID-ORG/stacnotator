/**
 * OpenModeMap - open-mode main map with annotation drawing.
 *
 * The open-mode counterpart of TaskModeMap. Key differences:
 *   - Mounts DrawingLayer for annotation drawing/editing on the same map.
 *   - Has a built-in LayerSelector and crosshair overlay.
 *   - Exposes a `fitAnnotations` imperative handle.
 *
 * Layer management is shared with TaskModeMap via the `useSliceLayers` hook.
 */

import { useEffect, useRef, useState, memo, useCallback, forwardRef, useImperativeHandle } from 'react';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import { GeoJSON as OLGeoJSON } from 'ol/format';

import BaseMap from './BaseMap';
import DrawingLayer from './DrawingLayer';
import { LayerManager } from './layerManager';
import type { Layer } from './Layer';
import LayerSelector from './LayerSelector';

import type { ImageryWithWindowsOut } from '~/api/client';
import type { SliceLayerMap } from '../../hooks/useStacRegistration';
import { convertWKTToGeoJSON } from '~/shared/utils/utility';
import { useAnnotationStore } from '../../stores/annotation.store';
import { useMapStore } from '../../stores/map.store';
import type { ExtendedLabel } from '../ControlsOpenMode';
import { useSliceLayers, BASEMAP_LAYERS } from './useSliceLayers';

// Props

interface OpenModeMapProps {
    imagery: ImageryWithWindowsOut | null;
    sliceLayerMap: SliceLayerMap;
    initialCenter: [number, number];
    initialZoom: number;
    /** Called on every view change so the store can sync window maps. */
    onViewChange?: (center: [number, number], zoom: number) => void;
    /** Called once the first active imagery layer finishes rendering. */
    onReady?: () => void;
    /** Controlled active layer id. */
    activeLayerId?: string;
    onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
    selectedLabel: ExtendedLabel | null;
    activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
    magicWandActive: boolean;
    onTimeseriesClick?: (lat: number, lon: number) => void;
    /** Increment to snap back to initialCenter/initialZoom. */
    refocusTrigger?: number;
    /** Timeseries probe point to display on the map. */
    probePoint?: { lat: number; lon: number } | null;
}

/** Imperative handle exposed to parents via ref */
export interface OpenModeMapHandle {
    fitAnnotations: () => void;
}

// Component

const OpenModeMap = forwardRef<OpenModeMapHandle, OpenModeMapProps>(({
    imagery,
    sliceLayerMap,
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
    probePoint,
}, ref) => {
    const mapRef = useRef<OLMap | null>(null);
    const [olMap, setOlMap] = useState<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const mapReadyRef = useRef(false);
    const probeOverlayRef = useRef<Overlay | null>(null);
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;
    const lastRefocusTriggerRef = useRef(refocusTrigger);

    const setShowBasemap = useMapStore((s) => s.setShowBasemap);
    const setBasemapType = useMapStore((s) => s.setBasemapType);
    const setSelectedLayerIndex = useMapStore((s) => s.setSelectedLayerIndex);

    // Shared layer management

    const { layers, activeLayerId, setActiveLayerId, initLayers } = useSliceLayers({
        imagery,
        layerManager: layerManagerRef.current,
        mapReady: mapReadyRef.current,
        sliceLayerMap,
        onReady,
        onLayersChange,
        preloadDepth: Infinity,
    });

    // Imperative handle: fitAnnotations

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
    }, []);

    useImperativeHandle(ref, () => ({
        fitAnnotations: doFitAnnotations,
    }), [doFitAnnotations]);

    // Watch store trigger for Space-key fitAnnotations
    const fitAnnotationsTrigger = useMapStore((s) => s.fitAnnotationsTrigger);
    const lastFitTriggerRef = useRef(fitAnnotationsTrigger);
    useEffect(() => {
        if (fitAnnotationsTrigger === lastFitTriggerRef.current) return;
        lastFitTriggerRef.current = fitAnnotationsTrigger;
        doFitAnnotations();
    }, [fitAnnotationsTrigger, doFitAnnotations]);

    // Refocus trigger (keep current zoom)

    useEffect(() => {
        if (!mapRef.current || refocusTrigger === lastRefocusTriggerRef.current) return;
        lastRefocusTriggerRef.current = refocusTrigger;
        mapRef.current.getView().animate({
            center: fromLonLat([initialCenter[1], initialCenter[0]]),
            duration: 300,
        });
    }, [refocusTrigger, initialCenter]);

    // External active layer control

    useEffect(() => {
        if (!controlledActiveLayerId || !layerManagerRef.current) return;
        layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
        setActiveLayerId(controlledActiveLayerId);
    }, [controlledActiveLayerId, setActiveLayerId]);

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

    // Render

    return (
        <div className="relative w-full h-full">
            <BaseMap
                center={initialCenter}
                zoom={initialZoom}
                onMapReady={(map) => {
                    mapRef.current = map;
                    setOlMap(map);

                    const lm = new LayerManager(map);
                    layerManagerRef.current = lm;
                    mapReadyRef.current = true;

                    initLayers(lm);

                    // Publish view changes so window maps stay synced
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

            {/* Drawing / editing layer */}
            {olMap && (
                <DrawingLayer
                    map={olMap}
                    selectedLabel={selectedLabel}
                    activeTool={activeTool}
                    magicWandActive={magicWandActive}
                    onTimeseriesClick={onTimeseriesClick}
                />
            )}

            {/* Layer selector */}
            {layers.length > 0 && (
                <div className="absolute top-2 right-2 z-[1000]">
                    <LayerSelector
                        layers={layers}
                        selectedLayer={layers.find((l) => l.id === activeLayerId)}
                        onLayerSelect={(layerId) => {
                            setActiveLayerId(layerId);
                            // Actually switch OL layer visibility
                            layerManagerRef.current?.setActiveLayer(layerId);
                            const layer = layers.find((l) => l.id === layerId);
                            if (layer?.layerType === 'basemap') {
                                setBasemapType(layer.id as Parameters<typeof setBasemapType>[0]);
                                setShowBasemap(true);
                            } else {
                                setShowBasemap(false);
                                const match = layerId.match(/-v(\d+)$/);
                                if (match) {
                                    const templateId = Number(match[1]);
                                    const idx = (imagery?.visualization_url_templates ?? [])
                                        .findIndex((t) => t.id === templateId);
                                    if (idx !== -1) setSelectedLayerIndex(idx);
                                }
                            }
                            onLayersChange?.(layers, layerId);
                        }}
                    />
                </div>
            )}

            {/* Stable center crosshair */}
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

OpenModeMap.displayName = 'OpenModeMap';

export default memo(OpenModeMap);
