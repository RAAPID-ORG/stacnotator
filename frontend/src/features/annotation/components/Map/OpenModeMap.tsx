/**
 * OpenModeMap - open-mode main map with annotation drawing.
 *
 * The open-mode counterpart of TaskModeMap. Key differences:
 *   - Mounts DrawingLayer for annotation drawing/editing on the same map.
 *   - Has a crosshair overlay (toggleable via showCrosshair prop).
 *   - Exposes a `fitAnnotations` imperative handle.
 *
 * Layer management is shared with TaskModeMap via the `useSliceLayers` hook.
 */

import {
  useEffect,
  useRef,
  useState,
  memo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type OLMap from 'ol/Map';
import Overlay from 'ol/Overlay';
import { fromLonLat, toLonLat } from 'ol/proj';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import { GeoJSON as OLGeoJSON } from 'ol/format';

import BaseMap from './BaseMap';
import DrawingLayer from './DrawingLayer';
import { LayerManager } from './layerManager';
import type { Layer } from './Layer';

import type { CampaignOutFull } from '~/api/client';
import { convertWKTToGeoJSON } from '~/shared/utils/utility';
import { useAnnotationStore } from '../../stores/annotation.store';
import { useMapStore } from '../../stores/map.store';
import type { ExtendedLabel } from '../ControlsOpenMode';
import { useSliceLayers } from './useSliceLayers';

interface OpenModeMapProps {
  campaign: CampaignOutFull;
  initialCenter: [number, number];
  initialZoom: number;
  onViewChange?: (
    center: [number, number],
    zoom: number,
    bounds: [number, number, number, number]
  ) => void;
  onReady?: () => void;
  activeLayerId?: string;
  onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
  selectedLabel: ExtendedLabel | null;
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
  magicWandActive: boolean;
  onTimeseriesClick?: (lat: number, lon: number) => void;
  refocusTrigger?: number;
  probePoint?: { lat: number; lon: number } | null;
  showCrosshair?: boolean;
}

/** Imperative handle exposed to parents via ref */
export interface OpenModeMapHandle {
  fitAnnotations: () => void;
}

// Component

const OpenModeMap = forwardRef<OpenModeMapHandle, OpenModeMapProps>(
  (
    {
      campaign,
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
      showCrosshair = true,
    },
    ref
  ) => {
    const mapRef = useRef<OLMap | null>(null);
    const [olMap, setOlMap] = useState<OLMap | null>(null);
    const layerManagerRef = useRef<LayerManager | null>(null);
    const mapReadyRef = useRef(false);
    const probeOverlayRef = useRef<Overlay | null>(null);
    const onViewChangeRef = useRef(onViewChange);
    onViewChangeRef.current = onViewChange;
    const lastRefocusTriggerRef = useRef(refocusTrigger);

    const { layers, activeLayerId, setActiveLayerId, initLayers } = useSliceLayers({
      campaign,
      layerManager: layerManagerRef.current,
      mapReady: mapReadyRef.current,
      onReady,
      onLayersChange,
      preloadDepth: Infinity,
    });

    // Imperative handle: fitAnnotations

    const geoJsonFormat = useRef(new OLGeoJSON());

    const doFitAnnotations = useCallback(() => {
      const map = mapRef.current;
      if (!map) return;

      const store = useAnnotationStore.getState();
      const { currentAnnotationIndex } = store;

      // If navigating to a specific annotation, fit only that one
      if (currentAnnotationIndex >= 0) {
        const sorted = store.getSortedAnnotations();
        const target = sorted[currentAnnotationIndex];
        if (target) {
          const geoJSON = convertWKTToGeoJSON(target.geometry.geometry);
          if (geoJSON) {
            try {
              const geom = geoJsonFormat.current.readGeometry(geoJSON, {
                featureProjection: 'EPSG:3857',
              });
              const ext = geom.getExtent();
              if (!isEmpty(ext)) {
                map.getView().fit(ext, {
                  padding: [100, 100, 100, 100],
                  maxZoom: 18,
                  duration: 400,
                });
                return;
              }
            } catch {
              // fall through to fit all
            }
          }
        }
      }

      const annotations = store.annotations;
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

    useImperativeHandle(
      ref,
      () => ({
        fitAnnotations: doFitAnnotations,
      }),
      [doFitAnnotations]
    );

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

    // Pan-to-center trigger: minimap drag moves the main map
    const panToCenterTrigger = useMapStore((s) => s.panToCenterTrigger);
    const lastPanToCenterRef = useRef(panToCenterTrigger);
    useEffect(() => {
      if (panToCenterTrigger === lastPanToCenterRef.current) return;
      lastPanToCenterRef.current = panToCenterTrigger;
      const map = mapRef.current;
      if (!map) return;
      const newCenter = useMapStore.getState().currentMapCenter;
      if (!newCenter) return;
      map.getView().setCenter(fromLonLat([newCenter[1], newCenter[0]]));
    }, [panToCenterTrigger]);

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
              const size = map.getSize();
              // Guard: skip if map hasn't laid out yet (size is 0)
              if (!size || size[0] === 0 || size[1] === 0) return;
              const [lon, lat] = toLonLat(olCenter);
              const extent = view.calculateExtent(size);
              const [minLon, minLat] = toLonLat([extent[0], extent[1]]);
              const [maxLon, maxLat] = toLonLat([extent[2], extent[3]]);
              onViewChangeRef.current?.([lat, lon], zoom, [minLon, minLat, maxLon, maxLat]);
            };
            view.on('change:center', syncView);
            view.on('change:resolution', syncView);
            // Wait for the first full render so map.getSize() returns real dimensions
            map.once('rendercomplete', syncView);

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

        {/* Stable center crosshair */}
        {showCrosshair && (
          <div className="absolute inset-0 pointer-events-none z-[500]" aria-hidden>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <svg width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                <line
                  x1="0"
                  y1="10"
                  x2="20"
                  y2="10"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  opacity="0.7"
                />
                <line
                  x1="10"
                  y1="0"
                  x2="10"
                  y2="20"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  opacity="0.7"
                />
              </svg>
            </div>
          </div>
        )}
      </div>
    );
  }
);

OpenModeMap.displayName = 'OpenModeMap';

export default memo(OpenModeMap);
