import { useEffect, useRef, memo } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import Overlay from 'ol/Overlay';
import { fromLonLat } from 'ol/proj';
import { defaults as defaultInteractions } from 'ol/interaction';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style';
import { GeoJSON as OLGeoJSON } from 'ol/format';
import type OLFeature from 'ol/Feature';
import type { Geometry } from 'ol/geom';
import 'ol/ol.css';
import {
  createCrosshairElement,
  updateCrosshairColor,
  hexToRgba,
  EXTENT_LAYER_Z_INDEX,
} from './mapUtils';

import { useAnnotationStore } from '../../stores/annotation.store';
import { useCampaignStore } from '../../stores/campaign.store';
import { extendLabelsWithMetadata } from '../../utils/labelMetadata';
import { convertWKTToGeoJSON } from '~/shared/utils/utility';
import { tileLoadWithAuth, isSelfHostedUrl } from './authTileLoader';
import { EMPTY_TILE_THRESHOLD } from './tilePreloader';

interface WindowMapProps {
  // [lat, lon] - initial map position, set once on mount
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
   * Called once when the tile source appears empty/broken -
   * i.e. EMPTY_TILE_THRESHOLD errors occur with no successful loads.
   * Resets whenever tileUrl changes.
   */
  onEmptyTiles?: () => void;
  /** GeoJSON polygon representing sample extent to render on map */
  sampleExtent?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}

const geoJsonFormat = new OLGeoJSON();
const PROP_ANNOTATION_ID = 'annotationId';
const PROP_LABEL_ID = 'labelId';

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

  // Annotation vector layer
  const annotations = useAnnotationStore((state) => state.annotations);
  const campaign = useCampaignStore((state) => state.campaign);
  const annotationSourceRef = useRef<VectorSource<OLFeature<Geometry>> | null>(null);
  const extentSourceRef = useRef<VectorSource<OLFeature<Geometry>> | null>(null);

  // Create the map once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const source = new XYZ({
      url: tileUrl,
      crossOrigin: 'anonymous',
      cacheSize: 256,
      transition: 0,
      ...(isSelfHostedUrl(tileUrl)
        ? { tileLoadFunction: tileLoadWithAuth as unknown as (tile: unknown, src: string) => void }
        : {}),
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

    // Annotation vector layer - read-only, synced from store
    const annotationSource = new VectorSource<OLFeature<Geometry>>();
    annotationSourceRef.current = annotationSource;
    const annotationLayer = new VectorLayer({
      source: annotationSource,
      zIndex: 10,
    });

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
      layers: [tileLayer, annotationLayer, extentLayer],
      maxTilesLoading: 4, // small - windows only load what's visible, main map gets priority
      view: new View({
        center: fromLonLat([initialCenter[1], initialCenter[0]]),
        zoom: initialZoom,
      }),
      controls: [],
      interactions: defaultInteractions(),
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
      annotationSourceRef.current = null;
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
      crossOrigin: 'anonymous',
      cacheSize: 256,
      transition: 0,
      ...(isSelfHostedUrl(tileUrl)
        ? { tileLoadFunction: tileLoadWithAuth as unknown as (tile: unknown, src: string) => void }
        : {}),
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

  // Sync annotations into the vector source
  // Incremental update - same pattern as DrawingLayer - to avoid flicker.
  useEffect(() => {
    const source = annotationSourceRef.current;
    if (!source) return;

    const extendedLabels = campaign ? extendLabelsWithMetadata(campaign.settings.labels) : [];

    const existing = new Map<number, OLFeature<Geometry>>();
    for (const f of source.getFeatures()) {
      existing.set(f.get(PROP_ANNOTATION_ID) as number, f);
    }

    const incomingIds = new Set<number>();

    for (const ann of annotations) {
      const geoJSON = convertWKTToGeoJSON(ann.geometry.geometry);
      if (!geoJSON) continue;

      incomingIds.add(ann.id);
      const label = extendedLabels.find((l) => l.id === ann.label_id);
      const color = label?.color ?? '#3b82f6';
      const isLine = label?.geometry_type === 'line';
      const fillOpacity = 0.2;
      const style = new Style({
        fill: new Fill({ color: hexToRgba(color, fillOpacity) }),
        stroke: new Stroke({ color, width: isLine ? 3 : 2 }),
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: hexToRgba(color, 0.85) }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      });

      if (existing.has(ann.id)) {
        const feat = existing.get(ann.id)!;
        const existingGeom = geoJsonFormat.writeFeatureObject(feat, {
          featureProjection: 'EPSG:3857',
        });
        if (JSON.stringify(existingGeom.geometry) !== JSON.stringify(geoJSON)) {
          const newGeom = geoJsonFormat.readGeometry(geoJSON, {
            featureProjection: 'EPSG:3857',
          }) as Geometry;
          feat.setGeometry(newGeom);
        }
        feat.setStyle(style);
      } else {
        const feat = geoJsonFormat.readFeature(
          { type: 'Feature', geometry: geoJSON, properties: {} },
          { featureProjection: 'EPSG:3857' }
        ) as OLFeature<Geometry>;
        feat.set(PROP_ANNOTATION_ID, ann.id);
        feat.set(PROP_LABEL_ID, ann.label_id);
        feat.setStyle(style);
        source.addFeature(feat);
      }
    }

    for (const [id, feat] of existing) {
      if (!incomingIds.has(id)) source.removeFeature(feat);
    }
  }, [annotations, campaign]);

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

  return <div ref={containerRef} className="w-full h-full bg-neutral-200" />;
};

export default memo(WindowMap);
