import type OLMap from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';
import type BaseLayer from 'ol/layer/Base';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import Feature, { type FeatureLike } from 'ol/Feature';
import RenderFeature, { toGeometry } from 'ol/render/Feature';
import type Geometry from 'ol/geom/Geometry';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import DragBox from 'ol/interaction/DragBox';
import Extent from 'ol/interaction/Extent';
import Snap from 'ol/interaction/Snap';
import { altKeyOnly, always, noModifierKeys, shiftKeyOnly } from 'ol/events/condition';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { Coordinate } from 'ol/coordinate';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import { toLonLat, transformExtent } from 'ol/proj';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { LAYER_ID_PROP, featurePropsOf, layerFeatureId, toOlStyle } from './layers';
import type {
  Bbox,
  BoxHit,
  DrawShape,
  GeoFeature,
  InteractionSpec,
  LayerId,
  StyleSpec,
} from './types';

/**
 * Whether the sketch has enough corners to close, mirroring the threshold
 * OpenLayers itself uses to decide a double-click may finish it. `finishDrawing`
 * makes no such check and would happily emit a two-point polygon. The sketch
 * geometry always carries one extra coordinate for the pointer, and a polygon
 * ring repeats its first point - hence 5 for a triangle and 3 for a segment.
 */
export function sketchIsFinishable(shape: DrawShape, geometry: Geometry | undefined): boolean {
  if (shape === 'Polygon' && geometry instanceof Polygon) {
    return geometry.getCoordinates()[0].length >= 5;
  }
  if (shape === 'LineString' && geometry instanceof LineString) {
    return geometry.getCoordinates().length >= 3;
  }
  // A point is finished by the click that places it; there is nothing to close.
  return false;
}

export type SketchLayer = VectorLayer<VectorSource<Feature<Geometry>>>;

const GEOJSON = new GeoJSONFormat({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });

export function toGeo(geometry: Geometry): GeoJSON.Geometry {
  return GEOJSON.writeGeometryObject(geometry) as GeoJSON.Geometry;
}

export function fromGeo(geometry: GeoJSON.Geometry): Geometry {
  return GEOJSON.readGeometry(geometry) as Geometry;
}

/** A hit feature's own OL geometry. Vector tiles yield lightweight
 *  RenderFeatures whose coordinates are flat arrays, so they are rebuilt into
 *  a real geometry first. */
function olGeometryOf(feature: FeatureLike): Geometry | null {
  if (feature instanceof RenderFeature) return toGeometry(feature) as Geometry;
  return (feature.getGeometry() as Geometry | undefined) ?? null;
}

/** A hit feature's geometry in EPSG:4326, the projection every GeoFeature
 *  crossing this boundary is in. Null when the feature carries none. */
export function geoOfFeature(feature: FeatureLike): GeoJSON.Geometry | null {
  const geometry = olGeometryOf(feature);
  return geometry ? toGeo(geometry) : null;
}

/** Used when a draw spec supplies no sketchStyle of its own. */
const DEFAULT_SKETCH_STYLE: StyleSpec = {
  stroke: { color: 'rgba(0,0,0,0.85)', width: 2, dash: [6, 4] },
  fill: { color: 'rgba(0,0,0,0.1)' },
  circle: {
    radius: 5,
    stroke: { color: 'rgba(0,0,0,0.85)', width: 2 },
    fill: { color: 'rgba(0,0,0,0.85)' },
  },
};

/** How far from the first vertex a click still closes a polygon. */
const CLOSE_TOLERANCE_PX = 10;
/** OL's 6px default drops fast clicks whose pointer drifts between down and
 *  up, which reads as the sketch ignoring a click. */
const CLICK_TOLERANCE_PX = 12;

function withinPx(map: OLMap, pixel: number[], coordinate: Coordinate, px: number): boolean {
  const [x, y] = map.getPixelFromCoordinate(coordinate);
  return Math.hypot(pixel[0] - x, pixel[1] - y) <= px;
}

/** The sketch style plus a dot on a polygon's first vertex, the one place a
 *  click closes it. The dot grows while the pointer is close enough to close. */
function sketchStyleOf(spec: StyleSpec): StyleFunction {
  const base = toOlStyle(spec);
  const color = spec.circle?.stroke?.color ?? spec.stroke?.color ?? 'rgba(0,0,0,0.85)';
  const firstVertex = (feature: FeatureLike) => {
    const geometry = feature.getGeometry();
    return geometry instanceof Polygon ? new Point(geometry.getCoordinates()[0][0]) : undefined;
  };
  const dot = (radius: number) =>
    new Style({
      image: new CircleStyle({
        radius,
        fill: new Fill({ color }),
        stroke: new Stroke({ color: 'white', width: 2 }),
      }),
      geometry: firstVertex,
    });
  const idle = dot(5);
  const closing = dot(8);
  return (feature, resolution) => {
    const geometry = feature.getGeometry();
    if (!(geometry instanceof Polygon)) return base;
    // The ring is [...corners, pointer, first].
    const ring = geometry.getCoordinates()[0];
    const [first, pointer] = [ring[0], ring[ring.length - 2]];
    const pointerOnFirst =
      Math.hypot(pointer[0] - first[0], pointer[1] - first[1]) / resolution <= CLOSE_TOLERANCE_PX;
    return [base, sketchIsFinishable('Polygon', geometry) && pointerOnFirst ? closing : idle];
  };
}

function sameStyle(a: StyleSpec | undefined, b: StyleSpec | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameGeoFeature(a: GeoFeature, b: GeoFeature): boolean {
  return (
    a.id === b.id &&
    JSON.stringify(a.geometry) === JSON.stringify(b.geometry) &&
    JSON.stringify(a.properties ?? {}) === JSON.stringify(b.properties ?? {})
  );
}

// Callback identity is deliberately excluded from all of these: it is not
// config, and comparing it would tear down a live sketch on every render
// that passes an un-memoized inline callback.
function sameDraw(a: InteractionSpec['draw'], b: InteractionSpec['draw']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.shape === b.shape && sameStyle(a.sketchStyle, b.sketchStyle);
}

function sameEdit(a: InteractionSpec['edit'], b: InteractionSpec['edit']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    sameGeoFeature(a.feature, b.feature) && sameStyle(a.style, b.style) && a.revision === b.revision
  );
}

function sameBox(a: InteractionSpec['box'], b: InteractionSpec['box']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.bbox.join() === b.bbox.join() && sameStyle(a.style, b.style);
}

function sameBoxSelect(a: InteractionSpec['boxSelect'], b: InteractionSpec['boxSelect']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    (a.hitLayerIds ?? []).join() === (b.hitLayerIds ?? []).join() && a.condition === b.condition
  );
}

/**
 * Config-level equality, not full spec equality: callback identity is not
 * config. Callers that rebuild the spec object
 * every render still get a no-op attach when nothing meaningful changed. A real
 * config change tears down and rebuilds every interaction together rather than
 * diffing draw/edit/boxSelect independently.
 */
export function configsEqual(
  a: InteractionSpec | undefined,
  b: InteractionSpec | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    sameDraw(a.draw, b.draw) &&
    sameEdit(a.edit, b.edit) &&
    sameBoxSelect(a.boxSelect, b.boxSelect) &&
    sameBox(a.box, b.box) &&
    !!a.snap === !!b.snap
  );
}

interface Callbacks {
  onDrawEnd?: (g: GeoJSON.Geometry) => void;
  onGeometryChange?: (g: GeoJSON.Geometry) => void;
  onBox?: (bbox: Bbox, hits: BoxHit[]) => void;
  onBoxChange?: (bbox: Bbox) => void;
}

function callbacksOf(spec: InteractionSpec | undefined): Callbacks {
  return {
    onDrawEnd: spec?.draw?.onDrawEnd,
    onGeometryChange: spec?.edit?.onGeometryChange,
    onBox: spec?.boxSelect?.onBox,
    onBoxChange: spec?.box?.onChange,
  };
}

/** Reports the box once a gesture ends rather than on every pointer move, so
 *  the caller is not re-rendered, and the interaction rebuilt, mid-drag. */
class BoxExtent extends Extent {
  constructor(
    options: ConstructorParameters<typeof Extent>[0],
    private readonly onEnd: () => void
  ) {
    super(options);
  }

  override handleUpEvent(event: Parameters<Extent['handleUpEvent']>[0]): boolean {
    const result = super.handleUpEvent(event);
    this.onEnd();
    return result;
  }
}

interface Attached {
  spec: InteractionSpec | undefined;
  interactions: Interaction[];
  source: VectorSource<Feature<Geometry>>;
  sketchKeyHandler?: (e: KeyboardEvent) => void;
  drawing: boolean;
  /** Mutated in place on a config-equal re-attach; handlers read through this. */
  callbacks: Callbacks;
}

const registry = new WeakMap<OLMap, Attached>();

function bboxOfDragBox(dragBox: DragBox): Bbox {
  const extent = dragBox.getGeometry().getExtent();
  const [minLon, minLat] = toLonLat([extent[0], extent[1]]);
  const [maxLon, maxLat] = toLonLat([extent[2], extent[3]]);
  return [minLon, minLat, maxLon, maxLat];
}

/** Vector-tile layers answer this themselves (they hold no single source);
 *  a plain vector layer's source does. */
function featuresInExtent(layer: BaseLayer, extent: number[]): FeatureLike[] {
  const onLayer = layer as unknown as { getFeaturesInExtent?: (e: number[]) => FeatureLike[] };
  if (typeof onLayer.getFeaturesInExtent === 'function') return onLayer.getFeaturesInExtent(extent);
  const withSource = layer as unknown as {
    getSource?: () => { getFeaturesInExtent?: (e: number[]) => FeatureLike[] } | null;
  };
  return withSource.getSource?.()?.getFeaturesInExtent?.(extent) ?? [];
}

/** Every feature of `layerIds` that really intersects the box. The extent test
 *  is re-run per feature because a tile source answers by tile, not by
 *  shape. */
function boxHits(map: OLMap, layerIds: LayerId[] | undefined, extent: number[]): BoxHit[] {
  if (!layerIds?.length) return [];
  const wanted = new Set(layerIds);
  const hits: BoxHit[] = [];
  for (const layer of map.getLayers().getArray()) {
    const layerId = layer.get(LAYER_ID_PROP) as LayerId | undefined;
    if (layerId === undefined || !wanted.has(layerId)) continue;
    for (const feature of featuresInExtent(layer, extent)) {
      const geometry = olGeometryOf(feature);
      if (!geometry || !geometry.intersectsExtent(extent)) continue;
      hits.push({
        layerId,
        feature: {
          id: layerFeatureId(layer, feature),
          geometry: toGeo(geometry),
          properties: featurePropsOf(feature),
        },
      });
    }
  }
  return hits;
}

function setup(map: OLMap, spec: InteractionSpec, sketchLayer: SketchLayer): Attached {
  const source = sketchLayer.getSource()!;
  const interactions: Interaction[] = [];
  const attached: Attached = {
    spec,
    interactions,
    source,
    drawing: false,
    callbacks: callbacksOf(spec),
  };

  if (spec.draw) {
    const { shape, sketchStyle } = spec.draw;
    // Deliberately no `source`: OL inserts the finished sketch into it *after*
    // dispatching drawend, so removing it from the handler is a no-op and the
    // shape stays behind, drawn in the sketch layer's default style on top of
    // the annotation the caller renders. The sketch is scratch surface only -
    // the committed result is drawn from the caller's own layer spec.
    let sketch: Feature<Geometry> | null = null;
    // OL treats the first *and* the last vertex of a polygon as its finish
    // point: it closes on a click near either and pins the sketch cursor to
    // them, so after every click the cursor stuck on the vertex just placed.
    // Polygons get a 1px tolerance to keep that out of the way, and close here
    // instead, on a press near the first vertex only.
    const closesPolygonAt = (e: MapBrowserEvent) => {
      const geometry = sketch?.getGeometry();
      if (shape !== 'Polygon' || !(geometry instanceof Polygon)) return false;
      if (!sketchIsFinishable(shape, geometry)) return false;
      return withinPx(map, e.pixel, geometry.getCoordinates()[0][0], CLOSE_TOLERANCE_PX);
    };
    const draw = new Draw({
      type: shape,
      style: sketchStyleOf(sketchStyle ?? DEFAULT_SKETCH_STYLE),
      snapTolerance: shape === 'Polygon' ? 1 : CLOSE_TOLERANCE_PX,
      clickTolerance: CLICK_TOLERANCE_PX,
      condition: (e) => {
        if (!closesPolygonAt(e)) return noModifierKeys(e);
        draw.finishDrawing();
        return false;
      },
      // What still reaches OL's own finish check for a polygon is the second
      // click of a double-click on the last vertex, which should do nothing.
      finishCondition: () => shape !== 'Polygon',
    });
    draw.on('drawstart', (evt) => {
      attached.drawing = true;
      sketch = evt.feature;
    });
    draw.on('drawend', (evt) => {
      attached.drawing = false;
      sketch = null;
      const geometry = evt.feature.getGeometry();
      // Read indirectly so a config-equal re-attach mid-sketch (a fresh,
      // un-memoized callback prop) invokes the latest callback, not a stale
      // one captured when this handler was created.
      if (geometry) attached.callbacks.onDrawEnd?.(toGeo(geometry));
    });
    map.addInteraction(draw);
    interactions.push(draw);

    // Capture phase so these beat any other window handler while sketching;
    // once the shape is finished, Enter and Escape belong to whoever owns the
    // resulting draft, not this interaction.
    const sketchKeyHandler = (e: KeyboardEvent) => {
      if (!attached.drawing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        draw.abortDrawing();
        attached.drawing = false;
        sketch = null;
        return;
      }
      if (e.key !== 'Enter' || !sketchIsFinishable(shape, sketch?.getGeometry())) return;
      e.preventDefault();
      e.stopPropagation();
      draw.finishDrawing();
    };
    window.addEventListener('keydown', sketchKeyHandler, true);
    attached.sketchKeyHandler = sketchKeyHandler;
  }

  if (spec.edit) {
    const { feature: geoFeature, style } = spec.edit;
    const feature = new Feature({ geometry: fromGeo(geoFeature.geometry) });
    if (geoFeature.id !== undefined) feature.setId(geoFeature.id);
    if (style) feature.setStyle(toOlStyle(style));
    source.addFeature(feature);

    const report = () => {
      const geometry = feature.getGeometry();
      if (geometry) attached.callbacks.onGeometryChange?.(toGeo(geometry));
    };

    const modify = new Modify({ source });
    modify.on('modifyend', report);
    // Alt-drag translates the whole feature; plain drag is reserved for
    // vertex editing via Modify above. On a vertex handle Alt belongs to
    // Modify, whose Alt+click removes that vertex.
    const onHandle = () => (modify.getOverlay().getSource()?.getFeatures().length ?? 0) > 0;
    const translate = new Translate({
      layers: [sketchLayer],
      condition: (e) => altKeyOnly(e) && !onHandle(),
    });
    // A press that never moved is not a move: reporting it would save the
    // geometry back with nothing but projection drift in it.
    translate.on('translateend', (e) => {
      if (e.coordinate.join() !== e.startCoordinate.join()) report();
    });

    map.addInteraction(modify);
    map.addInteraction(translate);
    interactions.push(modify, translate);
  }

  if (spec.boxSelect) {
    const { hitLayerIds, condition } = spec.boxSelect;
    const dragBox = new DragBox({
      condition: condition === 'always' ? always : shiftKeyOnly,
    });
    dragBox.on('boxend', () => {
      const extent = dragBox.getGeometry().getExtent();
      attached.callbacks.onBox?.(bboxOfDragBox(dragBox), boxHits(map, hitLayerIds, extent));
    });
    map.addInteraction(dragBox);
    interactions.push(dragBox);
  }

  if (spec.box) {
    const style = toOlStyle(spec.box.style ?? DEFAULT_SKETCH_STYLE);
    const extent: Extent = new BoxExtent(
      {
        extent: transformExtent(spec.box.bbox, 'EPSG:4326', 'EPSG:3857'),
        drag: true,
        createCondition: shiftKeyOnly,
        boxStyle: style,
        pointerStyle: style,
      },
      () => {
        const drawn = extent.getExtent();
        if (drawn) {
          attached.callbacks.onBoxChange?.(
            transformExtent(drawn, 'EPSG:3857', 'EPSG:4326') as Bbox
          );
        }
      }
    );
    map.addInteraction(extent);
    interactions.push(extent);
  }

  if (spec.snap && (spec.draw || spec.edit)) {
    const snap = new Snap({ source });
    map.addInteraction(snap);
    interactions.push(snap);
  }

  return attached;
}

function teardown(map: OLMap, attached: Attached): void {
  for (const interaction of attached.interactions) map.removeInteraction(interaction);
  if (attached.sketchKeyHandler) {
    window.removeEventListener('keydown', attached.sketchKeyHandler, true);
  }
  attached.source.clear();
}

/**
 * Reconciles the map's draw/edit/box-select interactions with `spec`. Safe to
 * call on every render, including with a fresh spec object and un-memoized
 * callbacks: a spec whose *config* matches what is already attached swaps
 * the callbacks in place (no teardown, no interrupted sketch); a real config
 * change tears down and rebuilds; `undefined` fully detaches (used on
 * unmount).
 */
export function attachInteractions(
  map: OLMap,
  spec: InteractionSpec | undefined,
  sketchLayer: SketchLayer
): void {
  const prev = registry.get(map);
  if (prev && configsEqual(prev.spec, spec)) {
    prev.spec = spec;
    prev.callbacks = callbacksOf(spec);
    return;
  }
  if (prev) teardown(map, prev);
  if (!spec) {
    registry.delete(map);
    return;
  }
  registry.set(map, setup(map, spec, sketchLayer));
}
