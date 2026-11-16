import { useEffect, useLayoutEffect, useRef, type ReactNode, type WheelEvent } from 'react';
import 'ol/ol.css';
import OLMap from 'ol/Map';
import View from 'ol/View';
import Attribution from 'ol/control/Attribution';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultInteractions, DragPan, MouseWheelZoom } from 'ol/interaction';
import Kinetic from 'ol/Kinetic';
import { platformModifierKeyOnly } from 'ol/events/condition';
import { fromLonLat, toLonLat, transformExtent } from 'ol/proj';
import { intersects } from 'ol/extent';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { FeatureLike } from 'ol/Feature';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Camera } from './Camera';
import {
  LAYER_ID_PROP,
  destroyLayer,
  featurePropsOf,
  isHitTestable,
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
  /** What the anchor belongs to, as [west, south, east, north]. While any of it is
   *  in view the content is kept on screen; without it, the anchor point is. */
  bounds?: [number, number, number, number];
  /** Shown only above this zoom, like a layer's `minZoom`: controls for a shape
   *  the map no longer draws would float over nothing. */
  minZoom?: number;
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
    { hitTolerance: HIT_TOLERANCE_PX, layerFilter: isHitTestable }
  );
  return { hit, feature: found };
}

const ANCHOR_MARGIN_PX = 6;
const HIDDEN = { visibility: 'hidden' } as const;

/**
 * Keeps an on-map anchor inside the map it belongs to. A selected annotation
 * can sit at the very edge of the viewport, or be panned off it entirely, and
 * its controls would otherwise render outside the panel and over whatever sits
 * next to it. Falls back to the raw position while the size is still unknown.
 */
export function clampAnchorPosition(
  px: readonly [number, number],
  offset: readonly [number, number] | undefined,
  size: readonly [number, number],
  viewport: readonly [number, number] | null
): { left: number; top: number } {
  const left = px[0] + (offset?.[0] ?? 0);
  const top = px[1] + (offset?.[1] ?? 0);
  if (!viewport || viewport[0] === 0 || viewport[1] === 0) return { left, top };
  const fit = (value: number, span: number, extent: number) =>
    Math.max(ANCHOR_MARGIN_PX, Math.min(value, extent - span - ANCHOR_MARGIN_PX));
  return { left: fit(left, size[0], viewport[0]), top: fit(top, size[1], viewport[1]) };
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
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const showAnchor = anchor != null;
  const [anchorLon, anchorLat] = anchor?.at ?? [];
  const [offsetX, offsetY] = anchor?.offset ?? [0, 0];
  const boundsKey = anchor?.bounds?.join(',');
  const anchorMinZoom = anchor?.minZoom;

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

  // Positioned straight from postrender, in the frame the map was drawn in. Going
  // through React state put the controls a frame behind, so they trailed the map
  // through every pan and zoom.
  useLayoutEffect(() => {
    const map = mapRef.current;
    const element = anchorRef.current;
    if (!map || !element || anchorLon === undefined || anchorLat === undefined) return;
    const coordinate = fromLonLat([anchorLon, anchorLat]);
    const bounds = boundsKey
      ? transformExtent(boundsKey.split(',').map(Number), 'EPSG:4326', 'EPSG:3857')
      : null;
    const update = () => {
      const pixel = map.getPixelFromCoordinate(coordinate);
      const size = map.getSize();
      const zoom = map.getView().getZoom();
      const inView =
        !!pixel &&
        !!size &&
        !(anchorMinZoom !== undefined && zoom !== undefined && zoom <= anchorMinZoom) &&
        (bounds
          ? intersects(map.getView().calculateExtent(size), bounds)
          : pixel[0] >= 0 && pixel[0] <= size[0] && pixel[1] >= 0 && pixel[1] <= size[1]);
      // Pinned to the edge, controls for something out of view act on nothing visible.
      if (!inView) {
        element.style.visibility = 'hidden';
        return;
      }
      const { left, top } = clampAnchorPosition(
        [pixel[0], pixel[1]],
        [offsetX, offsetY],
        [element.offsetWidth, element.offsetHeight],
        [size[0], size[1]]
      );
      element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      element.style.visibility = 'visible';
    };
    update();
    map.on('postrender', update);
    // The content resizes in place (one button or three), and its size decides the clamp.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      map.un('postrender', update);
      observer?.disconnect();
    };
  }, [showAnchor, anchorLon, anchorLat, offsetX, offsetY, boundsKey, anchorMinZoom]);

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
      {showAnchor && (
        <div
          ref={anchorRef}
          className="pointer-events-none absolute left-0 top-0 z-[1000] will-change-transform"
          style={HIDDEN}
        >
          {anchor.content}
        </div>
      )}
    </div>
  );
}
