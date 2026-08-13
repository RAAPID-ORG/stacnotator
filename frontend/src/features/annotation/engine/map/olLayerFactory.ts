import BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorTileLayer from 'ol/layer/VectorTile';
import type RenderFeature from 'ol/render/Feature';
import VectorSource from 'ol/source/Vector';
import VectorTileSource from 'ol/source/VectorTile';
import XYZ from 'ol/source/XYZ';
import MVT from 'ol/format/MVT';
import GeoJSONFormat from 'ol/format/GeoJSON';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import { createXYZ } from 'ol/tilegrid';
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import { PMTilesVectorSource } from 'ol-pmtiles';
import type {
  FeatureLayerSpec,
  GeoFeature,
  LayerSpec,
  RasterLayerSpec,
  StyleSpec,
  VectorTileLayerSpec,
} from './types';
import type { LayerField } from './reconcile';
import {
  credentialedTileLoader,
  crossOriginForTile,
  refreshTilerSession,
  type CrossOrigin,
} from './tileQos/loading';

/** Layer property keys. Prefixed so they cannot collide with OL's own. */
export const LAYER_ID_PROP = 'mapview:layerId';
const SPEC_PROP = 'mapview:spec';
const GEO_FEATURE_PROP = 'mapview:feature';

const PMTILES_SCHEME = 'pmtiles://';
const MAX_TILE_ZOOM = 22;
const HIGHLIGHT_EXTRA_WIDTH = 3;

const geoJson = new GeoJSONFormat({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });

/** Bing-style quadkey: interleave x/y bits per zoom level into a base-4 string. */
function tileXYZToQuadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    q += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return q;
}

export function toOlStyle(spec: StyleSpec): Style {
  return new Style({
    stroke: spec.stroke
      ? new Stroke({
          color: spec.stroke.color,
          width: spec.stroke.width,
          lineDash: spec.stroke.dash,
        })
      : undefined,
    fill: spec.fill ? new Fill({ color: spec.fill.color }) : undefined,
    image: spec.cross
      ? new RegularShape({
          points: 4,
          radius: spec.cross.size / 2,
          radius2: 0,
          angle: 0,
          stroke: new Stroke(spec.cross.stroke),
        })
      : spec.circle
        ? new CircleStyle({
            radius: spec.circle.radius,
            stroke: spec.circle.stroke ? new Stroke(spec.circle.stroke) : undefined,
            fill: spec.circle.fill ? new Fill({ color: spec.circle.fill.color }) : undefined,
          })
        : undefined,
    text: spec.text
      ? new Text({
          text: spec.text.label,
          fill: new Fill({ color: spec.text.color }),
          stroke: spec.text.haloColor
            ? new Stroke({ color: spec.text.haloColor, width: 3 })
            : undefined,
        })
      : undefined,
  });
}

/** Selection keeps its label colour and is emphasised with a thicker stroke. */
function emphasize(spec: StyleSpec): StyleSpec {
  const stroke = spec.stroke ?? { color: 'rgba(255,255,255,0.9)', width: 0 };
  return { ...spec, stroke: { ...stroke, width: stroke.width + HIGHLIGHT_EXTRA_WIDTH } };
}

/**
 * OL asks for a style per feature per frame, and style callbacks are free to
 * allocate a fresh StyleSpec each call, so the cache is keyed on content rather
 * than identity. Keys stay small because callers return few distinct specs (one
 * per label, typically).
 */
const styleCache = new Map<string, Style>();
const MAX_STYLE_CACHE = 500;

function cachedStyle(spec: StyleSpec, highlighted: boolean): Style {
  const key = `${highlighted ? 'h' : 'n'}:${JSON.stringify(spec)}`;
  const hit = styleCache.get(key);
  if (hit) return hit;
  const style = toOlStyle(highlighted ? emphasize(spec) : spec);
  if (styleCache.size >= MAX_STYLE_CACHE) styleCache.clear();
  styleCache.set(key, style);
  return style;
}

/**
 * MVT features carry an id only when the tiler emits one. `idProperty` is promoted
 * to the id by the MVT format, but PMTiles sources build their own format, so the
 * property is also read directly. Styling and hit-testing must agree here, or a
 * feature can be hideable but not clickable.
 */
export function featureIdOf(
  feature: FeatureLike,
  idProperty?: string
): string | number | undefined {
  const id = feature.getId();
  if (id !== undefined) return id;
  const prop = feature.get(idProperty ?? 'id');
  return typeof prop === 'string' || typeof prop === 'number' ? prop : undefined;
}

/** The id a layer's own spec says this feature has. */
export function layerFeatureId(
  layer: BaseLayer,
  feature: FeatureLike
): string | number | undefined {
  const spec = layer.get(SPEC_PROP) as LayerSpec | undefined;
  return featureIdOf(feature, spec?.kind === 'vector-tiles' ? spec.idProperty : undefined);
}

/** Feature properties as the caller declared them: no OL or bookkeeping keys. */
export function featurePropsOf(feature: FeatureLike): Record<string, unknown> {
  const props = { ...feature.getProperties() };
  delete props.geometry;
  delete props[GEO_FEATURE_PROP];
  return props;
}

function createRasterSource(spec: RasterLayerSpec): XYZ {
  const crossOrigin: CrossOrigin =
    spec.auth === 'cookie' ? 'use-credentials' : crossOriginForTile(spec.url);
  const credentialed = crossOrigin === 'use-credentials';
  const options = {
    attributions: spec.attribution,
    crossOrigin,
    minZoom: spec.minZoom,
    maxZoom: spec.maxZoom,
    cacheSize: 512,
    // Date changes often hit tiles already warmed in the HTTP cache. Any
    // non-zero source transition fades that cached layer in after the outgoing
    // one is hidden, producing a pale/blank flash for no network benefit.
    transition: 0,
    ...(credentialed ? { tileLoadFunction: credentialedTileLoader(refreshTilerSession) } : {}),
  };
  return spec.url.includes('{q}')
    ? new XYZ({
        ...options,
        tileUrlFunction: ([z, x, y]) => spec.url.replace('{q}', tileXYZToQuadkey(x, y, z)),
      })
    : new XYZ({ ...options, url: spec.url });
}

function createVectorTileSource(spec: VectorTileLayerSpec): VectorTileSource {
  // ol-pmtiles builds its own MVT format, so idProperty/sourceLayers only reach
  // the format on the XYZ path; the style function falls back to reading the id
  // property directly.
  if (spec.url.startsWith(PMTILES_SCHEME)) {
    return new PMTilesVectorSource({ url: spec.url.slice(PMTILES_SCHEME.length) });
  }
  return new VectorTileSource({
    format: new MVT({ idProperty: spec.idProperty, layers: spec.sourceLayers }),
    url: spec.url,
    tileGrid: createXYZ({ maxZoom: MAX_TILE_ZOOM }),
  });
}

function vectorTileStyle(layer: VectorTileLayer<VectorTileSource<RenderFeature>>) {
  return (feature: FeatureLike): Style | undefined => {
    const spec = layer.get(SPEC_PROP) as VectorTileLayerSpec;
    const id = featureIdOf(feature, spec.idProperty);
    // The edited feature is drawn by the interaction layer, so it is hidden here.
    if (id !== undefined && spec.hiddenFeatureIds?.includes(id)) return undefined;
    const style =
      typeof spec.style === 'function' ? spec.style(feature.getProperties()) : spec.style;
    if (!style) return undefined;
    return cachedStyle(style, id !== undefined && !!spec.highlightFeatureIds?.includes(id));
  };
}

function toOlFeatures(specs: GeoFeature[]): Feature[] {
  return specs.map((spec) => {
    const feature = geoJson.readFeature({
      type: 'Feature',
      geometry: spec.geometry,
      properties: spec.properties ?? {},
    }) as Feature;
    if (spec.id !== undefined) feature.setId(spec.id);
    feature.set(GEO_FEATURE_PROP, spec);
    return feature;
  });
}

function featureStyle(layer: VectorLayer<VectorSource<Feature>>) {
  return (feature: FeatureLike): Style | undefined => {
    const spec = layer.get(SPEC_PROP) as FeatureLayerSpec;
    if (typeof spec.style !== 'function') return cachedStyle(spec.style, false);
    const source = feature.get(GEO_FEATURE_PROP) as GeoFeature | undefined;
    return source ? cachedStyle(spec.style(source), false) : undefined;
  };
}

export function createLayer(spec: LayerSpec): BaseLayer {
  const layer = buildLayer(spec);
  layer.set(LAYER_ID_PROP, spec.id);
  layer.set(SPEC_PROP, spec);
  layer.setVisible(spec.visible ?? true);
  if (spec.zIndex !== undefined) layer.setZIndex(spec.zIndex);
  return layer;
}

function buildLayer(spec: LayerSpec): BaseLayer {
  if (spec.kind === 'raster') {
    const source = createRasterSource(spec);
    return new TileLayer({ source, preload: spec.preload ?? 0, opacity: spec.opacity ?? 1 });
  }
  if (spec.kind === 'vector-tiles') {
    const layer = new VectorTileLayer({
      source: createVectorTileSource(spec),
      // OL's minZoom is exclusive; the caller passes the value it wants applied.
      minZoom: spec.minZoom,
      // Re-render during zoom/pan so strokes stay crisp instead of the previous
      // zoom level's tiles being scaled up (which makes polygons pulse).
      updateWhileAnimating: true,
      updateWhileInteracting: true,
    });
    layer.setStyle(vectorTileStyle(layer));
    return layer;
  }
  const layer = new VectorLayer({
    source: new VectorSource({ features: toOlFeatures(spec.features) }),
    updateWhileAnimating: true,
    updateWhileInteracting: true,
  });
  layer.setStyle(featureStyle(layer));
  return layer;
}

export function updateLayer(
  layer: BaseLayer,
  spec: LayerSpec,
  changed: readonly LayerField[]
): void {
  // Style functions read the spec off the layer, so this also refreshes them.
  layer.set(SPEC_PROP, spec);

  for (const field of changed) {
    switch (field) {
      case 'visible':
        layer.setVisible(spec.visible ?? true);
        break;
      case 'zIndex':
        layer.setZIndex(spec.zIndex ?? 0);
        break;
      case 'opacity':
        layer.setOpacity(spec.kind === 'raster' ? (spec.opacity ?? 1) : 1);
        break;
      case 'preload':
        if (spec.kind === 'raster') (layer as TileLayer<XYZ>).setPreload(spec.preload ?? 0);
        break;
      case 'minZoom':
        // A raster's zoom limits live on the tile grid, a vector tile layer's on
        // the layer itself, mirroring where each one stops requesting tiles.
        if (spec.kind === 'vector-tiles') layer.setMinZoom(spec.minZoom ?? -Infinity);
        else replaceSource(layer, spec);
        break;
      case 'url':
      case 'auth':
      case 'attribution':
      case 'maxZoom':
      case 'idProperty':
      case 'sourceLayers':
        replaceSource(layer, spec);
        break;
      case 'features':
        if (spec.kind === 'features') {
          (layer as VectorLayer<VectorSource<Feature>>).getSource()?.clear();
          (layer as VectorLayer<VectorSource<Feature>>)
            .getSource()
            ?.addFeatures(toOlFeatures(spec.features));
        }
        break;
      case 'style':
      case 'hiddenFeatureIds':
      case 'highlightFeatureIds':
        layer.changed();
        break;
    }
  }
}

function replaceSource(layer: BaseLayer, spec: LayerSpec): void {
  if (spec.kind === 'raster') {
    const source = createRasterSource(spec);
    (layer as TileLayer<XYZ>).setSource(source);
    return;
  }
  if (spec.kind === 'vector-tiles') {
    (layer as VectorTileLayer<VectorTileSource<RenderFeature>>).setSource(
      createVectorTileSource(spec)
    );
  }
}

/** Dropping the source aborts in-flight tile requests for a layer being removed. */
export function destroyLayer(layer: BaseLayer): void {
  const withSource = layer as unknown as { setSource?: (source: null) => void };
  if (typeof withSource.setSource === 'function') withSource.setSource(null);
}
