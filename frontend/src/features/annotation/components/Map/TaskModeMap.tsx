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
import {
  createCrosshairElement,
  updateCrosshairColor,
  EXTENT_LAYER_Z_INDEX,
  PAN_DISTANCE_PIXELS,
  ZOOM_ANIMATION_MS,
  PAN_ANIMATION_MS,
} from './mapUtils';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { fromLonLat, toLonLat } from 'ol/proj';
import { Style, Fill, Stroke } from 'ol/style';
import { GeoJSON as OLGeoJSON } from 'ol/format';
import type OLFeature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import type { Layer } from './Layer';
import type { CampaignOutFull } from '~/api/client';
import { LayerManager } from './layerManager';
import { useSliceLayers } from './useSliceLayers';
import { useTilePreloading } from './useTilePreloading';
import { useTaskStore } from '../../stores/task.store';
import { useMapStore } from '../../stores/map.store';

interface TaskModeMapProps {
  campaign: CampaignOutFull;
  initialCenter?: [number, number];
  initialZoom?: number;
  center?: [number, number];
  refocusTrigger?: number;
  crosshair?: { lat: number; lon: number; color?: string };
  showCrosshair?: boolean;
  sampleExtent?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  onLayersChange?: (layers: Layer[], activeLayerId: string) => void;
  activeLayerId?: string;
  onViewChange?: (
    center: [number, number],
    zoom: number,
    bounds: [number, number, number, number]
  ) => void;
  onReady?: () => void;
  activeTool?: 'pan' | 'annotate' | 'edit' | 'timeseries';
  onTimeseriesClick?: (lat: number, lon: number) => void;
  probePoint?: { lat: number; lon: number } | null;
}

// Component

const TaskModeMap = ({
  campaign,
  initialCenter,
  initialZoom,
  center,
  refocusTrigger,
  crosshair,
  showCrosshair = true,
  sampleExtent,
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
  const [layerManager, setLayerManager] = useState<LayerManager | null>(null);
  const mapReadyRef = useRef(false);
  const crosshairOverlayRef = useRef<Overlay | null>(null);
  const crosshairElRef = useRef<HTMLDivElement | null>(null);
  const probeOverlayRef = useRef<Overlay | null>(null);
  const extentSourceRef = useRef<VectorSource<OLFeature<Geometry>> | null>(null);
  const lastRefocusTriggerRef = useRef(refocusTrigger);

  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onTimeseriesClickRef = useRef(onTimeseriesClick);
  onTimeseriesClickRef.current = onTimeseriesClick;

  // Store subscriptions for preloading
  const visibleTasks = useTaskStore((s) => s.visibleTasks);
  const currentTaskIndex = useTaskStore((s) => s.currentTaskIndex);
  const activeCollectionId = useMapStore((s) => s.activeCollectionId);
  const currentMapZoom = useMapStore((s) => s.currentMapZoom);
  const preloadingEnabled = useMapStore((s) => s.preloadingEnabled);
  const zoomInTrigger = useMapStore((s) => s.zoomInTrigger);
  const zoomOutTrigger = useMapStore((s) => s.zoomOutTrigger);
  const panTrigger = useMapStore((s) => s.panTrigger);

  // Shared layer management
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
  });

  // Tile preloading (task mode only) - temporarily disabled for debugging
  useTilePreloading({
    layerManager,
    campaign,
    activeCollectionId,
    visibleTasks,
    currentTaskIndex,
    defaultZoom: initialZoom ?? 10,
    currentZoom: currentMapZoom ?? undefined,
    enabled: !!campaign && preloadingEnabled,
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
      view.animate({ zoom: currentZoom + 1, duration: ZOOM_ANIMATION_MS });
    }
  }, [zoomInTrigger]);

  // Keyboard zoom out
  useEffect(() => {
    if (!zoomOutTrigger || !mapRef.current) return;
    const view = mapRef.current.getView();
    const currentZoom = view.getZoom();
    if (currentZoom !== undefined) {
      view.animate({ zoom: currentZoom - 1, duration: ZOOM_ANIMATION_MS });
    }
  }, [zoomOutTrigger]);

  // Keyboard pan
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

  // Crosshair overlay
  useEffect(() => {
    const overlay = crosshairOverlayRef.current;
    const el = crosshairElRef.current;
    if (!overlay) return;
    if (crosshair && showCrosshair) {
      if (el) {
        updateCrosshairColor(el, crosshair.color ?? 'ff0000');
      }
      overlay.setPosition(fromLonLat([crosshair.lon, crosshair.lat]));
    } else {
      overlay.setPosition(undefined);
    }
  }, [crosshair, crosshair?.lat, crosshair?.lon, crosshair?.color, showCrosshair]);

  // Sample extent polygon overlay
  useEffect(() => {
    const source = extentSourceRef.current;
    if (!source) return;
    source.clear();
    if (!sampleExtent) return;
    const features = new OLGeoJSON().readFeatures(
      { type: 'Feature', geometry: sampleExtent },
      { featureProjection: 'EPSG:3857' }
    );
    source.addFeatures(features as OLFeature<Geometry>[]);
  }, [sampleExtent]);

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
    map.on('singleclick', handler as () => void);
    map.getTargetElement().style.cursor = 'crosshair';

    return () => {
      map.un('singleclick', handler as () => void);
      map.getTargetElement().style.cursor = '';
    };
  }, [activeTool]);

  // External active layer control
  useEffect(() => {
    if (!controlledActiveLayerId || !layerManagerRef.current) return;
    layerManagerRef.current.setActiveLayer(controlledActiveLayerId);
    setActiveLayerId(controlledActiveLayerId);
  }, [controlledActiveLayerId, setActiveLayerId]);

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

          // Expose map instance for E2E testing (dev/test only)
          if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
            (window as unknown as Record<string, unknown>).__OL_MAP__ = map;
          }

          // Expose to state so hooks (e.g. useTilePreloading) can subscribe
          setLayerManager(lm);

          initLayers(lm);

          // Publish view changes on every frame during pan/zoom
          const view = map.getView();
          const syncView = () => {
            const olCenter = view.getCenter();
            const z = view.getZoom();
            if (!olCenter || z === undefined) return;
            const size = map.getSize();
            // Guard: skip if map hasn't laid out yet (size is 0)
            if (!size || size[0] === 0 || size[1] === 0) return;
            const [lon, lat] = toLonLat(olCenter);
            const extent = view.calculateExtent(size);
            const [minLon, minLat] = toLonLat([extent[0], extent[1]]);
            const [maxLon, maxLat] = toLonLat([extent[2], extent[3]]);
            onViewChangeRef.current?.([lat, lon], z, [minLon, minLat, maxLon, maxLat]);
          };
          view.on('change:center', syncView);
          view.on('change:resolution', syncView);
          // Wait for the first full render so map.getSize() returns real dimensions
          map.once('rendercomplete', syncView);

          // Create crosshair overlay
          const el = createCrosshairElement(crosshair?.color);
          crosshairElRef.current = el;

          const overlay = new Overlay({
            element: el,
            positioning: 'center-center',
            stopEvent: false,
          });
          map.addOverlay(overlay);
          crosshairOverlayRef.current = overlay;

          // Expose crosshair overlay for E2E testing
          if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
            (window as unknown as Record<string, unknown>).__OL_CROSSHAIR__ = overlay;
          }

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

          // Sample extent vector layer
          const extentSource = new VectorSource<OLFeature<Geometry>>();
          extentSourceRef.current = extentSource;
          const extentLayer = new VectorLayer({
            source: extentSource,
            zIndex: EXTENT_LAYER_Z_INDEX,
            style: new Style({
              fill: new Fill({ color: 'rgba(255,255,255,0.08)' }),
              stroke: new Stroke({ color: '#ef4444', width: 1.5, lineDash: [6, 4] }),
            }),
          });
          map.addLayer(extentLayer);
        }}
      />
    </div>
  );
};

export default memo(TaskModeMap);
