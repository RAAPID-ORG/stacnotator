import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react';
import 'ol/ol.css';
import OLMap from 'ol/Map';
import View from 'ol/View';
import Attribution from 'ol/control/Attribution';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultInteractions, DragPan, MouseWheelZoom } from 'ol/interaction';
import Kinetic from 'ol/Kinetic';
import { platformModifierKeyOnly } from 'ol/events/condition';
import { fromLonLat, toLonLat } from 'ol/proj';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Camera } from './camera';
import {
  LAYER_ID_PROP,
  destroyLayer,
  featurePropsOf,
  layerFeatureId,
  syncLayers,
  type MountedLayer,
} from './layers';
import { attachInteractions, geoOfFeature, type SketchLayer } from './interactions';
import type { InteractionSpec, LayerId, LayerSpec, LonLat, MapClickEvent } from './types';

/** Above every declarative layer, so drawing is never hidden. */
const SKETCH_LAYER_Z_INDEX = 1000;
const HIT_TOLERANCE_PX = 4;

/** DOM pinned to a map coordinate, so controls can sit on the geometry they
 *  act on instead of in a corner of the page. */
export interface MapAnchor {
  at: LonLat;
  content: ReactNode;
  /** Pixel nudge off the anchor point, to clear the geometry underneath. */
  offset?: [number, number];
}

export interface MapViewProps {
  camera: Camera;
  layers: LayerSpec[];
  anchor?: MapAnchor | null;
  /** Draw/edit/box-select wiring, applied to a sketch layer this owns. */
  interactions?: InteractionSpec;
  onClick?: (e: MapClickEvent) => void;
  /** Takes double-click over from OL's zoom, which is why passing it also
   *  removes that interaction. Decided at mount, like the map itself. */
  onDoubleClick?: () => void;
  onHoverFeature?: (hit: { layerId: LayerId; featureId: string | number } | null) => void;
  onLoadStateChange?: (loading: boolean) => void;
  wheelZoom?: 'plain' | 'modifier';
  onModifierHint?: () => void;
  minZoom?: number;
  maxZoom?: number;
  /** Cap on concurrent tile loads. Pages with many small maps must keep this
   *  low so one panel cannot occupy the queue ahead of every panel after it. */
  maxTilesLoading?: number;
  attributionCollapsed?: boolean;
  className?: string;
}

interface FeatureHit {
  layerId: LayerId;
  featureId: string | number;
}

/** A camera can only carry out a fit once its map has a real viewport, so this
 *  is tied to the first size the container reports rather than to mount. */
function attachIfSized(map: OLMap, camera: Camera): void {
  const size = map.getSize();
  if (size && size[0] > 0 && size[1] > 0) camera.attach();
}

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
  anchor,
  interactions,
  onClick,
  onDoubleClick,
  onHoverFeature,
  onLoadStateChange,
  wheelZoom = 'plain',
  onModifierHint,
  minZoom,
  maxZoom,
  maxTilesLoading = 64,
  attributionCollapsed = true,
  className = 'w-full h-full',
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<OLMap | null>(null);
  const sketchLayerRef = useRef<SketchLayer | null>(null);
  const mounted = useRef(new Map<LayerId, MountedLayer>()).current;
  const hoverRef = useRef<FeatureHit | null>(null);
  const [anchorPx, setAnchorPx] = useState<[number, number] | null>(null);
  const [anchorLon, anchorLat] = anchor?.at ?? [];

  // The map is built once; handlers change on most renders, so they are read
  // through a ref rather than rebuilding it.
  const handlers = useRef({
    onClick,
    onDoubleClick,
    onHoverFeature,
    onLoadStateChange,
    wheelZoom,
    camera,
  });
  useEffect(() => {
    handlers.current = {
      onClick,
      onDoubleClick,
      onHoverFeature,
      onLoadStateChange,
      wheelZoom,
      camera,
    };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new OLMap({
      target: container,
      layers: [],
      maxTilesLoading,
      view: camera.getView(),
      controls: [
        new ScaleLine({ units: 'metric', minWidth: 48 }),
        new Attribution({ collapsible: true, collapsed: attributionCollapsed }),
      ],
      interactions: defaultInteractions({
        mouseWheelZoom: false,
        dragPan: false,
        doubleClickZoom: !onDoubleClick,
      }).extend([
        new MouseWheelZoom({
          // Snappier than OL's 250ms default, which feels sluggish.
          duration: 150,
          timeout: 50,
          condition: (e) =>
            handlers.current.wheelZoom === 'modifier' ? platformModifierKeyOnly(e) : true,
        }),
        // Softer kinetic decay than the default gives a longer, smoother glide.
        new DragPan({ kinetic: new Kinetic(-0.003, 0.05, 100) }),
      ]),
    });
    mapRef.current = map;
    map.on('loadstart', () => handlers.current.onLoadStateChange?.(true));
    map.on('loadend', () => handlers.current.onLoadStateChange?.(false));

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

    map.on('dblclick', () => handlers.current.onDoubleClick?.());

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
    const observer = new ResizeObserver(() => {
      map.updateSize();
      attachIfSized(map, handlers.current.camera);
    });
    observer.observe(container);
    attachIfSized(map, camera);

    return () => {
      observer.disconnect();
      // Tears down draw/edit/box-select before the map goes, so the ESC window
      // listener draw registers does not outlive this component.
      attachInteractions(map, undefined, sketchLayer);
      map.removeLayer(sketchLayer);
      sketchLayerRef.current = null;
      for (const { layer } of mounted.values()) destroyLayer(layer);
      mounted.clear();
      // Hand the map a throwaway view before discarding it. The camera's view
      // outlives this component - that is what lets maps follow each other -
      // and a map left holding it keeps re-rendering off every camera move for
      // the rest of the session, once per map ever unmounted.
      map.setView(new View());
      map.setTarget(undefined);
      handlers.current.onLoadStateChange?.(false);
      mapRef.current = null;
    };
    // Built once: the camera owns the view and every prop above is read
    // through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const sketchLayer = sketchLayerRef.current;
    if (map && sketchLayer) attachInteractions(map, interactions, sketchLayer);
  }, [interactions]);

  // postrender is the one event that covers pans, zooms, animations and
  // resizes alike; the equality guard is what keeps it from re-rendering the
  // anchor on every frame of a glide.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || anchorLon === undefined || anchorLat === undefined) {
      setAnchorPx(null);
      return;
    }
    const coordinate = fromLonLat([anchorLon, anchorLat]);
    const update = () => {
      const pixel = map.getPixelFromCoordinate(coordinate);
      setAnchorPx((prev) => {
        if (!pixel) return null;
        const next: [number, number] = [Math.round(pixel[0]), Math.round(pixel[1])];
        return prev && prev[0] === next[0] && prev[1] === next[1] ? prev : next;
      });
    };
    update();
    map.on('postrender', update);
    return () => map.un('postrender', update);
  }, [anchorLon, anchorLat]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) syncLayers(map, mounted, layers);
  }, [layers, mounted]);

  useEffect(() => {
    const view = camera.getView();
    const map = mapRef.current;
    if (map && map.getView() !== view) {
      map.setView(view);
      attachIfSized(map, camera);
    }
    view.setMinZoom(minZoom ?? 0);
    // Past the basemap's tile limit the tiles just stretch, which beats a hard stop.
    view.setMaxZoom(maxZoom ?? 24);
  }, [camera, minZoom, maxZoom]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (wheelZoom !== 'modifier' || event.ctrlKey || event.metaKey) return;
    onModifierHint?.();
  };

  return (
    <div className={`relative ${className}`}>
      <div ref={containerRef} className="h-full w-full" onWheel={handleWheel} />
      {anchor && anchorPx && (
        <div
          className="pointer-events-none absolute z-[1000]"
          style={{
            left: anchorPx[0] + (anchor.offset?.[0] ?? 0),
            top: anchorPx[1] + (anchor.offset?.[1] ?? 0),
          }}
        >
          {anchor.content}
        </div>
      )}
    </div>
  );
}
