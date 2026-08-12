import { useEffect, useRef, type WheelEvent } from 'react';
import 'ol/ol.css';
import OLMap from 'ol/Map';
import View from 'ol/View';
import Attribution from 'ol/control/Attribution';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultInteractions, DragPan, MouseWheelZoom } from 'ol/interaction';
import Kinetic from 'ol/Kinetic';
import { platformModifierKeyOnly } from 'ol/events/condition';
import { toLonLat } from 'ol/proj';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type BaseLayer from 'ol/layer/Base';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { CameraController } from './camera';
import { reconcile, type MountedLayer } from './reconcile';
import {
  LAYER_ID_PROP,
  createLayer,
  destroyLayer,
  featurePropsOf,
  layerFeatureId,
  updateLayer,
} from './olLayerFactory';
import { attachInteractions, geoOfFeature, type SketchLayer } from './interactions/attach';
import type { InteractionSpec } from './interactions/types';
import type { LayerId, LayerSpec, LonLat, TileStats } from './types';

/** Sketch layer sits above every declarative layer so drawing/editing is never hidden. */
const SKETCH_LAYER_Z_INDEX = 1000;

export interface MapClickEvent {
  lonLat: LonLat;
  layerId?: LayerId;
  featureId?: string | number;
  featureProps?: Record<string, unknown>;
  /** The hit feature's own geometry, EPSG:4326. Labelling a vector feature
   *  turns exactly this into an annotation, and nothing outside the map can
   *  read a rendered vector tile. */
  featureGeometry?: GeoJSON.Geometry;
  shiftKey: boolean;
}

export interface MapViewProps {
  camera: CameraController;
  layers: LayerSpec[];
  /** Draw/edit/box-select wiring, applied to a sketch layer this component owns. */
  interactions?: InteractionSpec;
  onClick?: (e: MapClickEvent) => void;
  onHoverFeature?: (hit: { layerId: LayerId; featureId: string | number } | null) => void;
  onTileStats?: (layerId: LayerId, stats: TileStats) => void;
  wheelZoom?: 'plain' | 'modifier';
  onModifierHint?: () => void;
  minZoom?: number;
  maxZoom?: number;
  attributionCollapsed?: boolean;
  className?: string;
}

interface FeatureHit {
  layerId: LayerId;
  featureId: string | number;
}

const HIT_TOLERANCE_PX = 4;

function hitAt(
  map: OLMap,
  pixel: number[]
): { hit: FeatureHit | null; feature: FeatureLike | null } {
  let hit: FeatureHit | null = null;
  let found: FeatureLike | null = null;
  map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) => {
      const layerId = layer?.get(LAYER_ID_PROP) as LayerId | undefined;
      // Ids resolve exactly as the styling path resolves them, so anything the
      // caller can hide or highlight is also clickable.
      const featureId = layer ? layerFeatureId(layer, feature) : undefined;
      if (layerId === undefined || featureId === undefined) return false;
      hit = { layerId, featureId };
      found = feature;
      return true;
    },
    { hitTolerance: HIT_TOLERANCE_PX }
  );
  return { hit, feature: found };
}

export function MapView({
  camera,
  layers,
  interactions,
  onClick,
  onHoverFeature,
  onTileStats,
  wheelZoom = 'plain',
  onModifierHint,
  minZoom,
  maxZoom,
  attributionCollapsed = true,
  className = 'w-full h-full',
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OLMap | null>(null);
  const sketchLayerRef = useRef<SketchLayer | null>(null);
  const mountedRef = useRef<Map<LayerId, MountedLayer & { layer: BaseLayer }>>(undefined);
  const mounted = (mountedRef.current ??= new Map());
  const hoverRef = useRef<FeatureHit | null>(null);

  // Handlers change on most renders; the map is built once, so it reads them
  // through a ref instead of being rebuilt.
  const handlers = useRef({ onClick, onHoverFeature, onTileStats, wheelZoom });
  useEffect(() => {
    handlers.current = { onClick, onHoverFeature, onTileStats, wheelZoom };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new OLMap({
      target: container,
      layers: [],
      maxTilesLoading: 64,
      view: camera.getView(),
      controls: [
        new ScaleLine({ units: 'metric', minWidth: 48 }),
        new Attribution({ collapsible: true, collapsed: attributionCollapsed }),
      ],
      interactions: defaultInteractions({ mouseWheelZoom: false, dragPan: false }).extend([
        new MouseWheelZoom({
          // Snappier than OL's 250ms default, which feels sluggish.
          duration: 150,
          timeout: 50,
          condition: (e) =>
            handlers.current.wheelZoom === 'modifier' ? platformModifierKeyOnly(e) : true,
        }),
        // Softer kinetic decay than the OL default gives a longer, smoother glide.
        new DragPan({ kinetic: new Kinetic(-0.003, 0.05, 100) }),
      ]),
    });
    mapRef.current = map;

    const sketchLayer: SketchLayer = new VectorLayer({
      source: new VectorSource(),
      zIndex: SKETCH_LAYER_Z_INDEX,
    });
    sketchLayerRef.current = sketchLayer;
    map.addLayer(sketchLayer);

    map.on('singleclick', (event: MapBrowserEvent) => {
      const { hit, feature } = hitAt(map, event.pixel);
      handlers.current.onClick?.({
        lonLat: toLonLat(event.coordinate) as LonLat,
        layerId: hit?.layerId,
        featureId: hit?.featureId,
        featureProps: feature ? featurePropsOf(feature) : undefined,
        featureGeometry: feature ? (geoOfFeature(feature) ?? undefined) : undefined,
        shiftKey: (event.originalEvent as MouseEvent).shiftKey,
      });
    });

    map.on('pointermove', (event: MapBrowserEvent) => {
      if (event.dragging || !handlers.current.onHoverFeature) return;
      const { hit } = hitAt(map, event.pixel);
      const previous = hoverRef.current;
      const same =
        hit === previous ||
        (hit !== null &&
          previous !== null &&
          hit.layerId === previous.layerId &&
          hit.featureId === previous.featureId);
      if (same) return;
      hoverRef.current = hit;
      handlers.current.onHoverFeature(hit);
    });

    // OL does not re-evaluate tile coverage on a container resize by itself.
    const observer = new ResizeObserver(() => map.updateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      // Tears down draw/edit/box-select before the map itself is discarded, so
      // the ESC window listener draw registers does not outlive this component.
      attachInteractions(map, undefined, sketchLayer);
      map.removeLayer(sketchLayer);
      sketchLayerRef.current = null;
      for (const { layer } of mounted.values()) destroyLayer(layer);
      mounted.clear();
      // Hand the map a throwaway view before discarding it. The camera's view
      // outlives this component (that is what lets maps follow each other), and
      // a map left holding it keeps re-rendering off every camera move for the
      // rest of the session - once per map ever unmounted.
      map.setView(new View());
      map.setTarget(undefined);
      mapRef.current = null;
    };
    // Built once: the camera owns the view, and every prop above is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const sketchLayer = sketchLayerRef.current;
    if (!map || !sketchLayer) return;
    attachInteractions(map, interactions, sketchLayer);
  }, [interactions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const ctx = {
      onTileStats: (layerId: LayerId, stats: TileStats) =>
        handlers.current.onTileStats?.(layerId, stats),
    };

    for (const op of reconcile(mounted, layers)) {
      if (op.type === 'remove') {
        const entry = mounted.get(op.id);
        if (!entry) continue;
        map.removeLayer(entry.layer);
        destroyLayer(entry.layer);
        mounted.delete(op.id);
      } else if (op.type === 'add') {
        const layer = createLayer(op.spec, ctx);
        map.addLayer(layer);
        mounted.set(op.spec.id, { spec: op.spec, layer });
      } else {
        const entry = mounted.get(op.id);
        if (!entry) continue;
        updateLayer(entry.layer, op.spec, op.changed, ctx);
        entry.spec = op.spec;
      }
    }
  }, [layers]);

  useEffect(() => {
    const view = camera.getView();
    const map = mapRef.current;
    if (map && map.getView() !== view) map.setView(view);
    view.setMinZoom(minZoom ?? 0);
    // Past the basemap's tile limit the tiles just stretch, which beats a hard stop.
    view.setMaxZoom(maxZoom ?? 24);
  }, [camera, minZoom, maxZoom]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (wheelZoom !== 'modifier' || event.ctrlKey || event.metaKey) return;
    onModifierHint?.();
  };

  return <div ref={containerRef} className={className} onWheel={handleWheel} />;
}
