import { useEffect, useRef, useState, memo } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultInteractions, MouseWheelZoom } from 'ol/interaction';
import { platformModifierKeyOnly } from 'ol/events/condition';
import { Style, Fill, Stroke } from 'ol/style';
import { GeoJSON as OLGeoJSON } from 'ol/format';
import type OLFeature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import 'ol/ol.css';
import { createCrosshairElement, updateCrosshairColor, EXTENT_LAYER_Z_INDEX } from './mapUtils';

import { useAnnotationStore } from '../../stores/annotation.store';
import { useCampaignStore } from '../../stores/campaign.store';
import { useMapStore } from '../../stores/map.store';
import { usePreferencesStore } from '../../stores/preferences.store';
import {
  createAnnotationDisplayLayer,
  releaseAnnotationTileSource,
} from './useAnnotationTileLayer';
import { crossOriginForTile, tileLoadImagery } from '../../utils/tileLoading';
import { EMPTY_TILE_THRESHOLD } from './tilePreloader';

interface WindowMapProps {
  // [lat, lon] - initial map position, set once on mount
  initialCenter: [number, number];
  initialZoom: number;
  // Task-anchored position (e.g. task nav). Ignored while `follow` is on.
  center?: [number, number];
  zoom?: number;
  // Mirror the main map's live center/zoom imperatively from the store, so
  // per-frame motion never re-renders React.
  follow?: boolean;
  // The single tile URL to display (already resolved by the parent)
  tileUrl: string;
  // Tile provider ("mpc" / tiler name / null) - drives crossOrigin (cookie vs anonymous).
  tileProvider?: string | null;
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
   * Called once when the tile source appears empty/broken -
   * i.e. EMPTY_TILE_THRESHOLD errors occur with no successful loads.
   * Resets whenever tileUrl changes.
   */
  onEmptyTiles?: () => void;
  /** GeoJSON polygon representing sample extent to render on map */
  sampleExtent?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

const geoJsonFormat = new OLGeoJSON();

const ZOOM_HINT = 'Ctrl/⌘ + scroll to zoom';

const WindowMap = ({
  initialCenter,
  initialZoom,
  center,
  zoom,
  follow = false,
  tileUrl,
  tileProvider,
  crosshair,
  showCrosshair = true,
  refocusTrigger,
  detectionKey,
  onEmptyTiles,
  sampleExtent,
}: WindowMapProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OLMap | null>(null);
  const tileLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const overlayElRef = useRef<HTMLDivElement | null>(null);
  const lastRefocusTriggerRef = useRef(refocusTrigger);
  // Keep a stable ref to the latest callback so the tile-swap effect can use it
  const onEmptyTilesRef = useRef(onEmptyTiles);
  useEffect(() => {
    onEmptyTilesRef.current = onEmptyTiles;
  }, [onEmptyTiles]);

  // Annotations render via the shared read-only vector-tile display layer.
  const campaign = useCampaignStore((state) => state.campaign);
  const annotationStyleOverrides = usePreferencesStore((state) => state.annotationStyles);
  const annotationTileLayerRef = useRef<ReturnType<typeof createAnnotationDisplayLayer> | null>(
    null
  );
  const extentSourceRef = useRef<VectorSource<OLFeature<Geometry>> | null>(null);

  // Wheel zoom is gated behind the platform modifier so plain scroll pages the
  // canvas. Flash a hint when the user scrolls over a window without it.
  const [showZoomHint, setShowZoomHint] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(hintTimerRef.current ?? undefined), []);
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    setShowZoomHint(true);
    clearTimeout(hintTimerRef.current ?? undefined);
    hintTimerRef.current = setTimeout(() => setShowZoomHint(false), 1200);
  };

  // Create the map once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const source = new XYZ({
      url: tileUrl,
      crossOrigin: crossOriginForTile(tileUrl, tileProvider),
      cacheSize: 256,
      transition: 0,
      tileLoadFunction: tileLoadImagery as unknown as (tile: unknown, src: string) => void,
    });

    // Track consecutive tile-load errors vs. successes for empty-tile detection
    let errorCount = 0;
    let successCount = 0;
    let emptyFired = false;
    source.on('tileloaderror', () => {
      errorCount++;
      if (!emptyFired && successCount === 0 && errorCount >= EMPTY_TILE_THRESHOLD) {
        emptyFired = true;
        onEmptyTilesRef.current?.();
      }
    });
    source.on('tileloadend', () => {
      successCount++;
    });

    const tileLayer = new TileLayer({
      preload: 0,
      source,
    });
    tileLayerRef.current = tileLayer;

    // Annotations: read-only vector-tile display layer (same tiles as the main
    // map). Built only once campaign data is available.
    const annotationCampaignId = campaign?.id ?? null;
    const annotationLayer = campaign
      ? createAnnotationDisplayLayer(
          campaign,
          annotationStyleOverrides,
          () => useAnnotationStore.getState().tileVersion
        )
      : null;
    annotationTileLayerRef.current = annotationLayer;

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

    const map = new OLMap({
      target: containerRef.current,
      layers: [tileLayer, ...(annotationLayer ? [annotationLayer] : []), extentLayer],
      maxTilesLoading: 4, // small - windows only load what's visible, main map gets priority
      view: new View({
        center: fromLonLat([initialCenter[1], initialCenter[0]]),
        zoom: initialZoom,
      }),
      controls: [],
      interactions: defaultInteractions({ mouseWheelZoom: false }).extend([
        new MouseWheelZoom({ condition: platformModifierKeyOnly }),
      ]),
    });

    // Crosshair overlay
    const el = createCrosshairElement(crosshair?.color);
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

    // Keep OL in sync when the container resizes (layout shifts, sidebar toggle).
    // After updating the size, poke the tile source so OL requests tiles for
    // any newly-visible area - updateSize() alone doesn't re-evaluate tile coverage.
    const ro = new ResizeObserver(() => {
      map.updateSize();
      tileLayerRef.current?.getSource()?.changed();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      // Clear tile source to abort in-flight tile requests
      tileLayer.setSource(null as unknown as XYZ);
      map.setTarget(undefined);
      mapRef.current = null;
      tileLayerRef.current = null;
      if (annotationCampaignId !== null) releaseAnnotationTileSource(annotationCampaignId);
      annotationTileLayerRef.current = null;
      extentSourceRef.current = null;
      overlayRef.current = null;
      overlayElRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map created once; tileUrl, crosshair handled by effects below
  }, []);

  // Swap tile source when tileUrl changes, and reset empty-tile detection.
  // Also re-runs when detectionKey increments (task navigation) - the URL may
  // be identical across tasks but counters must start fresh each time.
  useEffect(() => {
    if (!tileLayerRef.current || !tileUrl) return;

    const source = new XYZ({
      url: tileUrl,
      crossOrigin: crossOriginForTile(tileUrl, tileProvider),
      cacheSize: 256,
      transition: 0,
      tileLoadFunction: tileLoadImagery as unknown as (tile: unknown, src: string) => void,
    });

    // Reset counters for the new URL
    let errorCount = 0;
    let successCount = 0;
    let emptyFired = false;
    source.on('tileloaderror', () => {
      errorCount++;
      if (!emptyFired && successCount === 0 && errorCount >= EMPTY_TILE_THRESHOLD) {
        emptyFired = true;
        onEmptyTilesRef.current?.();
      }
    });
    source.on('tileloadend', () => {
      successCount++;
    });

    tileLayerRef.current.setSource(source);

    // The view-position effect runs after this one in the same commit.
    // OL may start loading tiles for the old view before the new center/zoom
    // is applied, leaving edge tiles un-requested. After OL finishes its
    // first render pass with the new source, poke it to re-evaluate.
    const map = mapRef.current;
    if (map) {
      map.once('postrender', () => source.changed());
    }
  }, [tileUrl, tileProvider, detectionKey]);

  // Move to the task-anchored center/zoom (non-following windows only; followers
  // are driven by the subscription below). Also runs on `follow` transitions, so
  // a window that stops following returns to its task position.
  useEffect(() => {
    if (follow || !center || !mapRef.current) return;
    const view = mapRef.current.getView();
    view.setCenter(fromLonLat([center[1], center[0]]));
    if (zoom !== undefined) view.setZoom(zoom);
  }, [center, zoom, follow]);

  // While following, track the store's center/zoom imperatively (poke the OL view
  // directly) so motion updates every window without a React re-render.
  useEffect(() => {
    if (!follow) return;
    const applyView = (c: [number, number] | null, z: number | null) => {
      const view = mapRef.current?.getView();
      if (!view || !c) return;
      view.setCenter(fromLonLat([c[1], c[0]]));
      if (z !== null) view.setZoom(z);
    };
    // Snap to the current position immediately, then track future changes.
    const s = useMapStore.getState();
    applyView(s.currentMapCenter, s.currentMapZoom);
    return useMapStore.subscribe((state, prev) => {
      if (
        state.currentMapCenter !== prev.currentMapCenter ||
        state.currentMapZoom !== prev.currentMapZoom
      ) {
        applyView(state.currentMapCenter, state.currentMapZoom);
      }
    });
  }, [follow]);

  // Refresh the window's annotation tiles after an edit (bumped tileVersion).
  const tileVersion = useAnnotationStore((state) => state.tileVersion);
  useEffect(() => {
    annotationTileLayerRef.current?.getSource()?.refresh();
  }, [tileVersion]);

  // Re-render when the edited feature changes so the window hides the same id.
  const editingId = useAnnotationStore((state) => state.editingId);
  useEffect(() => {
    annotationTileLayerRef.current?.changed();
  }, [editingId]);

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
  }, [refocusTrigger, center, initialZoom]);

  // Sample extent polygon overlay
  useEffect(() => {
    const source = extentSourceRef.current;
    if (!source) return;
    source.clear();
    if (!sampleExtent) return;
    const features = geoJsonFormat.readFeatures(
      { type: 'Feature', geometry: sampleExtent },
      { featureProjection: 'EPSG:3857' }
    );
    source.addFeatures(features as OLFeature<Geometry>[]);
  }, [sampleExtent]);

  // Update crosshair overlay position and color
  useEffect(() => {
    const overlay = overlayRef.current;
    const el = overlayElRef.current;
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

  return (
    <div className="relative w-full h-full" onWheel={handleWheel}>
      <div ref={containerRef} className="w-full h-full bg-neutral-200" />
      <div
        data-zoom-hint
        className={`pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white transition-opacity duration-200 ${showZoomHint ? 'opacity-100' : 'opacity-0'}`}
      >
        {ZOOM_HINT}
      </div>
    </div>
  );
};

export default memo(WindowMap);
