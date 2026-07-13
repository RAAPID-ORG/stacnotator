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
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { isEmpty } from 'ol/extent';

import BaseMap from './BaseMap';
import DrawingLayer from './DrawingLayer';
import { LayerManager } from './layerManager';
import type { Layer } from './Layer';
import { PAN_DISTANCE_PIXELS, ZOOM_ANIMATION_MS, PAN_ANIMATION_MS } from './mapUtils';

import { getAnnotationsExtent, type CampaignOutFull } from '~/api/client';
import { useMapStore, type AnnotationTool } from '../../stores/map.store';
import type { ExtendedLabel } from '../../utils/labelMetadata';
import { useSliceLayers } from './useSliceLayers';
import { useCustomMapLayer } from './useCustomMapLayer';
import { useVectorLayers } from './useVectorLayers';
import { useAnnotationTileLayer } from './useAnnotationTileLayer';
import VectorLabelLayer from './VectorLabelLayer';

// Furthest the open-mode map may zoom out (~regional / tens-of-km view). Kept a
// few levels below per-field detail so users can pull back for context, but not
// so far that the map hits the downsampled, feature-dense low-zoom tiles. The
// wider distribution is served by the minimap density indicators. Lower this
// (e.g. 7) to allow zooming out further.
const OPEN_MODE_MIN_ZOOM = 8;

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
  activeTool: AnnotationTool;
  magicWandActive: boolean;
  onTimeseriesClick?: (lat: number, lon: number) => void;
  refocusTrigger?: number;
  probePoint?: { lat: number; lon: number } | null;
  showCrosshair?: boolean;
  crosshairColor?: string;
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
      crosshairColor,
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

    const {
      layers: _layers,
      activeLayerId: _activeLayerId,
      setActiveLayerId,
      initLayers,
    } = useSliceLayers({
      campaign,
      layerManager: layerManagerRef.current,
      mapReady: mapReadyRef.current,
      onReady,
      onLayersChange,
      preloadDepth: 2,
    });

    useCustomMapLayer(layerManagerRef.current, campaign.custom_maps ?? []);
    // Mount the active PMTiles vector layer (managed directly on the OL map).
    const activeVectorLayerId = useMapStore((s) => s.activeVectorLayerId);
    const showVectorLayer = useMapStore((s) => s.showVectorLayer);
    const shownVectorLayerId = showVectorLayer ? activeVectorLayerId : null;
    useVectorLayers(olMap, campaign.vector_layers ?? [], shownVectorLayerId);
    // Mount the read-only annotation vector-tile display + highlight layers.
    useAnnotationTileLayer(olMap, campaign);

    // Imperative handle: fitAnnotations
    //
    // When navigating to a specific annotation, fit to that nav item's bbox.
    // Otherwise fit to the whole campaign's extent (fetched on demand, never by
    // loading every geometry into the client).
    const doFitAnnotations = useCallback(async () => {
      const map = mapRef.current;
      if (!map) return;

      const fitBbox4326 = (
        bbox: [number, number, number, number],
        padding: number,
        maxZoom = 18
      ) => {
        const ext = transformExtent(bbox, 'EPSG:4326', 'EPSG:3857');
        if (isEmpty(ext)) return false;
        map.getView().fit(ext, {
          padding: [padding, padding, padding, padding],
          maxZoom,
          duration: 400,
        });
        return true;
      };

      try {
        const response = await getAnnotationsExtent({ path: { campaign_id: campaign.id } });
        const bbox = response.data?.bbox;
        if (bbox) fitBbox4326(bbox, 60);
      } catch {
        // no annotations / fit unavailable
      }
    }, [campaign.id]);

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

    // Keyboard zoom in
    const zoomInTrigger = useMapStore((s) => s.zoomInTrigger);
    useEffect(() => {
      if (!zoomInTrigger || !mapRef.current) return;
      const view = mapRef.current.getView();
      const currentZoom = view.getZoom();
      if (currentZoom !== undefined) {
        view.animate({ zoom: currentZoom + 1, duration: ZOOM_ANIMATION_MS });
      }
    }, [zoomInTrigger]);

    // Keyboard zoom out
    const zoomOutTrigger = useMapStore((s) => s.zoomOutTrigger);
    useEffect(() => {
      if (!zoomOutTrigger || !mapRef.current) return;
      const view = mapRef.current.getView();
      const currentZoom = view.getZoom();
      if (currentZoom !== undefined) {
        view.animate({ zoom: currentZoom - 1, duration: ZOOM_ANIMATION_MS });
      }
    }, [zoomOutTrigger]);

    // Keyboard pan
    const panTrigger = useMapStore((s) => s.panTrigger);
    useEffect(() => {
      if (!panTrigger.count || !mapRef.current) return;
      const view = mapRef.current.getView();
      const resolution = view.getResolution();
      const currentCenter = view.getCenter();
      if (!resolution || !currentCenter) return;

      const panDistance = resolution * PAN_DISTANCE_PIXELS;
      let [x, y] = currentCenter;
      switch (panTrigger.direction) {
        case 'up':
          y += panDistance;
          break;
        case 'down':
          y -= panDistance;
          break;
        case 'left':
          x -= panDistance;
          break;
        case 'right':
          x += panDistance;
          break;
      }
      view.animate({ center: [x, y], duration: PAN_ANIMATION_MS });
    }, [panTrigger]);

    // External active layer control

    useEffect(() => {
      if (!controlledActiveLayerId || !layerManagerRef.current) return;
      layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
      setActiveLayerId(controlledActiveLayerId);
    }, [controlledActiveLayerId, setActiveLayerId]);

    // Probe marker overlay - hidden when probePoint is null OR the chart
    // legend has hidden the corresponding datasets (probeMarkerHidden).
    const probeMarkerHidden = useMapStore((s) => s.probeMarkerHidden);
    useEffect(() => {
      const overlay = probeOverlayRef.current;
      if (!overlay) return;
      if (probePoint && !probeMarkerHidden) {
        overlay.setPosition(fromLonLat([probePoint.lon, probePoint.lat]));
      } else {
        overlay.setPosition(undefined);
      }
    }, [probePoint?.lat, probePoint?.lon, probePoint, probeMarkerHidden]);

    // Render

    return (
      <div className="relative w-full h-full">
        <BaseMap
          center={initialCenter}
          zoom={initialZoom}
          minZoom={OPEN_MODE_MIN_ZOOM}
          onMapReady={(map) => {
            mapRef.current = map;
            setOlMap(map);

            const lm = new LayerManager(map);
            layerManagerRef.current = lm;
            mapReadyRef.current = true;

            initLayers(lm);

            // Publish view changes so window maps stay synced, coalesced to one
            // store write per frame (center + resolution can both change in one).
            const view = map.getView();
            let viewSyncRaf: number | null = null;
            const emitViewChange = () => {
              viewSyncRaf = null;
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
            const syncView = () => {
              if (viewSyncRaf !== null) return;
              viewSyncRaf = requestAnimationFrame(emitViewChange);
            };
            view.on('change:center', syncView);
            view.on('change:resolution', syncView);
            // Wait for the first full render so map.getSize() returns real dimensions
            map.once('rendercomplete', emitViewChange);

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

        {/* PMTiles vector-layer hover highlight + label-by-click interactions */}
        {olMap && (
          <VectorLabelLayer
            map={olMap}
            activeTool={activeTool}
            selectedLabel={selectedLabel}
            hasEnabledLayers={shownVectorLayerId != null}
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
                  stroke={crosshairColor ? `#${crosshairColor}` : '#ffffff'}
                  strokeWidth="1.5"
                  opacity="0.7"
                />
                <line
                  x1="10"
                  y1="0"
                  x2="10"
                  y2="20"
                  stroke={crosshairColor ? `#${crosshairColor}` : '#ffffff'}
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
