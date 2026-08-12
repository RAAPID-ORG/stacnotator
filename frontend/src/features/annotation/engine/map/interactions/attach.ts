import type OLMap from 'ol/Map';
import type Interaction from 'ol/interaction/Interaction';
import type BaseLayer from 'ol/layer/Base';
import type VectorLayer from 'ol/layer/Vector';
import type VectorSource from 'ol/source/Vector';
import Feature, { type FeatureLike } from 'ol/Feature';
import RenderFeature, { toGeometry } from 'ol/render/Feature';
import type Geometry from 'ol/geom/Geometry';
import Draw from 'ol/interaction/Draw';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import DragBox from 'ol/interaction/DragBox';
import Snap from 'ol/interaction/Snap';
import { altKeyOnly, shiftKeyOnly } from 'ol/events/condition';
import { toLonLat } from 'ol/proj';
import GeoJSONFormat from 'ol/format/GeoJSON';
import { LAYER_ID_PROP, featurePropsOf, layerFeatureId, toOlStyle } from '../olLayerFactory';
import type { Bbox, GeoFeature, LayerId, StyleSpec } from '../types';
import type { BoxHit, InteractionSpec } from './types';

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
  return sameGeoFeature(a.feature, b.feature) && sameStyle(a.style, b.style);
}

function sameBoxSelect(a: InteractionSpec['boxSelect'], b: InteractionSpec['boxSelect']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (a.hitLayerIds ?? []).join() === (b.hitLayerIds ?? []).join();
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
    !!a.snap === !!b.snap
  );
}

interface Callbacks {
  onDrawEnd?: (g: GeoJSON.Geometry) => void;
  onGeometryChange?: (g: GeoJSON.Geometry) => void;
  onBox?: (bbox: Bbox, hits: BoxHit[]) => void;
}

function callbacksOf(spec: InteractionSpec | undefined): Callbacks {
  return {
    onDrawEnd: spec?.draw?.onDrawEnd,
    onGeometryChange: spec?.edit?.onGeometryChange,
    onBox: spec?.boxSelect?.onBox,
  };
}

interface Attached {
  spec: InteractionSpec | undefined;
  interactions: Interaction[];
  source: VectorSource<Feature<Geometry>>;
  escHandler?: (e: KeyboardEvent) => void;
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
    const draw = new Draw({
      source,
      type: shape,
      style: toOlStyle(sketchStyle ?? DEFAULT_SKETCH_STYLE),
    });
    draw.on('drawstart', () => {
      attached.drawing = true;
    });
    draw.on('drawend', (evt) => {
      attached.drawing = false;
      const geometry = evt.feature.getGeometry();
      // The caller renders the committed result through its own layer spec;
      // the sketch feature is only a scratch surface while drawing.
      source.removeFeature(evt.feature);
      // Read indirectly so a config-equal re-attach mid-sketch (a fresh,
      // un-memoized callback prop) invokes the latest callback, not a stale
      // one captured when this handler was created.
      if (geometry) attached.callbacks.onDrawEnd?.(toGeo(geometry));
    });
    map.addInteraction(draw);
    interactions.push(draw);

    // Capture phase so this beats any other window ESC handler while
    // sketching; once the shape is finished ESC belongs to whoever owns the
    // resulting draft, not this interaction.
    const escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !attached.drawing) return;
      e.preventDefault();
      e.stopPropagation();
      draw.abortDrawing();
      attached.drawing = false;
    };
    window.addEventListener('keydown', escHandler, true);
    attached.escHandler = escHandler;
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
    // vertex editing via Modify above.
    const translate = new Translate({ layers: [sketchLayer], condition: altKeyOnly });
    translate.on('translateend', report);

    map.addInteraction(modify);
    map.addInteraction(translate);
    interactions.push(modify, translate);
  }

  if (spec.boxSelect) {
    const { hitLayerIds } = spec.boxSelect;
    const dragBox = new DragBox({ condition: shiftKeyOnly });
    dragBox.on('boxend', () => {
      const extent = dragBox.getGeometry().getExtent();
      attached.callbacks.onBox?.(bboxOfDragBox(dragBox), boxHits(map, hitLayerIds, extent));
    });
    map.addInteraction(dragBox);
    interactions.push(dragBox);
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
  if (attached.escHandler) window.removeEventListener('keydown', attached.escHandler, true);
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
