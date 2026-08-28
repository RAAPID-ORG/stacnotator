import Feature, { type FeatureLike } from 'ol/Feature';
import MVT from 'ol/format/MVT';
import GeoJSONFormat from 'ol/format/GeoJSON';
import BaseLayer from 'ol/layer/Base';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorTileLayer from 'ol/layer/VectorTile';
import type RenderFeature from 'ol/render/Feature';
import VectorSource from 'ol/source/Vector';
import VectorTileSource from 'ol/source/VectorTile';
import XYZ from 'ol/source/XYZ';
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import { createXYZ } from 'ol/tilegrid';
import { PMTilesVectorSource } from 'ol-pmtiles';
import { applyBackground, applyStyle } from 'ol-mapbox-style';
import type {
  FeatureLayerSpec,
  GeoFeature,
  GlStyleLayerSpec,
  LayerId,
  LayerSpec,
  RasterLayerSpec,
  StyleSpec,
  VectorTileLayerSpec,
} from './types';
import { POINT_RADIUS, SELECTED_EXTRA_WIDTH } from './types';
import {
  acquireRasterSource,
  acquireVectorTileSource,
  attachTileErrorRecovery,
  bearerVectorTileLoader,
  crossOriginForTile,
  detachTileErrorRecovery,
  foregroundTileLoader,
  releaseSource,
  retryErroredTiles,
  type CrossOrigin,
} from './tileLoading';

/** Layer property keys, prefixed so they cannot collide with OL's own. */
export const LAYER_ID_PROP = 'stacn:layerId';
const SPEC_PROP = 'stacn:spec';
const GEO_FEATURE_PROP = 'stacn:feature';
const SOURCE_KEY_PROP = 'stacn:sourceKey';

const PMTILES_SCHEME = 'pmtiles://';
const MAX_TILE_ZOOM = 22;

const geoJson = new GeoJSONFormat({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

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

/** A selected feature keeps its label colour and gains a thicker stroke. */
function emphasize(spec: StyleSpec): StyleSpec {
  const stroke = spec.stroke ?? { color: 'rgba(255,255,255,0.9)', width: 0 };
  return {
    ...spec,
    stroke: { ...stroke, width: stroke.width + SELECTED_EXTRA_WIDTH },
    circle: spec.circle ? { ...spec.circle, radius: POINT_RADIUS.selected } : undefined,
  };
}

/**
 * OL asks for a style per feature per frame and callers are free to allocate a
 * fresh spec each call, so this is keyed on content rather than identity. Keys
 * stay few because callers return few distinct specs - typically one per label.
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

// ---------------------------------------------------------------------------
// Feature identity
// ---------------------------------------------------------------------------

/**
 * MVT features carry an id only when the tiler emits one. `idProperty` is
 * promoted by the MVT format, but PMTiles sources build their own format, so
 * the property is also read directly. Styling and hit-testing must agree here
 * or a feature ends up hideable but not clickable.
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
export function layerFeatureId(layer: BaseLayer, feature: FeatureLike) {
  const spec = layer.get(SPEC_PROP) as LayerSpec | undefined;
  return featureIdOf(feature, spec?.kind === 'vector-tiles' ? spec.idProperty : undefined);
}

/** Properties as the caller declared them: no OL or bookkeeping keys. */
export function featurePropsOf(feature: FeatureLike): Record<string, unknown> {
  const props = { ...feature.getProperties() };
  delete props.geometry;
  delete props[GEO_FEATURE_PROP];
  return props;
}

export function geoFeatureOf(feature: FeatureLike): GeoFeature | undefined {
  return feature.get(GEO_FEATURE_PROP) as GeoFeature | undefined;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Bing-style quadkey: interleave x/y bits per zoom level into base 4. */
function quadkey(x: number, y: number, z: number): string {
  let q = '';
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    q += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return q;
}

function rasterSourceKey(spec: RasterLayerSpec, crossOrigin: CrossOrigin): string {
  return JSON.stringify([
    spec.url,
    crossOrigin,
    spec.attribution ?? null,
    spec.minZoom ?? null,
    spec.maxZoom ?? null,
    spec.cacheScope ?? null,
  ]);
}

function createRasterSource(spec: RasterLayerSpec): { key: string; source: XYZ } {
  const crossOrigin: CrossOrigin =
    spec.auth === 'cookie' ? 'use-credentials' : crossOriginForTile(spec.url);
  const key = rasterSourceKey(spec, crossOrigin);
  const options = {
    attributions: spec.attribution,
    crossOrigin,
    minZoom: spec.minZoom,
    maxZoom: spec.maxZoom,
    cacheSize: 512,
    // Date changes often hit tiles already warm in the HTTP cache. Any non-zero
    // transition fades that cached layer in after the outgoing one is hidden,
    // producing a pale flash for no network benefit.
    transition: 0,
    tileLoadFunction: foregroundTileLoader,
  };
  const source = acquireRasterSource(key, () =>
    spec.url.includes('{q}')
      ? new XYZ({
          ...options,
          tileUrlFunction: ([z, x, y]) => spec.url.replace('{q}', quadkey(x, y, z)),
        })
      : new XYZ({ ...options, url: spec.url })
  );
  return { key, source };
}

/** Shared by key, so the same annotations drawn on the main map and in every
 *  imagery window cost one tile cache and one request per tile, not one per
 *  map. Everything that changes what the source fetches or how it decodes is
 *  in the key. */
function createVectorTileSource(spec: VectorTileLayerSpec): {
  key: string;
  source: VectorTileSource<RenderFeature>;
} {
  const key = [
    'vector',
    spec.url,
    spec.auth ?? 'none',
    spec.idProperty ?? '',
    (spec.sourceLayers ?? []).join(','),
  ].join('|');

  // ol-pmtiles builds its own MVT format, so idProperty/sourceLayers only reach
  // the format on the XYZ path; the style function falls back to reading the
  // id property directly.
  const source = acquireVectorTileSource(key, () => {
    if (spec.url.startsWith(PMTILES_SCHEME)) {
      return new PMTilesVectorSource({ url: spec.url.slice(PMTILES_SCHEME.length) });
    }
    const format = new MVT({ idProperty: spec.idProperty, layers: spec.sourceLayers });
    const built = new VectorTileSource({
      format,
      url: spec.url,
      tileGrid: createXYZ({ maxZoom: MAX_TILE_ZOOM }),
    });
    if (spec.auth === 'bearer') built.setTileLoadFunction(bearerVectorTileLoader(format));
    return built;
  });
  return { key, source };
}

/** Paints a GL style onto a layer: the style JSON and its TileJSON are fetched
 *  first, so the layer mounts empty and fills in. A failure leaves the map
 *  without its backdrop rather than rejecting into the render loop. */
function applyGlStyle(
  layer: VectorTileLayer<VectorTileSource<RenderFeature>>,
  spec: GlStyleLayerSpec
) {
  Promise.all([applyStyle(layer, spec.styleUrl), applyBackground(layer, spec.styleUrl)]).catch(
    () => {}
  );
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

// ---------------------------------------------------------------------------
// Building and updating one layer
// ---------------------------------------------------------------------------

function vectorTileStyle(layer: VectorTileLayer<VectorTileSource<RenderFeature>>) {
  return (feature: FeatureLike): Style | undefined => {
    const spec = layer.get(SPEC_PROP) as VectorTileLayerSpec;
    const id = featureIdOf(feature, spec.idProperty);
    // The edited feature is drawn by the interaction layer, so it is hidden here.
    if (id !== undefined && spec.hiddenFeatureIds?.has(id)) return undefined;
    const style =
      typeof spec.style === 'function' ? spec.style(feature.getProperties()) : spec.style;
    if (!style) return undefined;
    return cachedStyle(style, id !== undefined && !!spec.highlightFeatureIds?.has(id));
  };
}

function featureStyle(layer: VectorLayer<VectorSource<Feature>>) {
  return (feature: FeatureLike): Style | undefined => {
    const spec = layer.get(SPEC_PROP) as FeatureLayerSpec;
    if (typeof spec.style !== 'function') return cachedStyle(spec.style, false);
    const source = geoFeatureOf(feature);
    return source ? cachedStyle(spec.style(source), false) : undefined;
  };
}

/** Layers that carry no opacity of their own are drawn fully opaque. */
const opacityOf = (spec: LayerSpec): number =>
  (spec.kind === 'features' ? undefined : spec.opacity) ?? 1;

export function createLayer(spec: LayerSpec): BaseLayer {
  const layer = buildLayer(spec);
  layer.setOpacity(opacityOf(spec));
  layer.set(LAYER_ID_PROP, spec.id);
  layer.set(SPEC_PROP, spec);
  layer.setVisible(spec.visible ?? true);
  if (spec.zIndex !== undefined) layer.setZIndex(spec.zIndex);
  return layer;
}

function buildLayer(spec: LayerSpec): BaseLayer {
  if (spec.kind === 'raster') {
    const { key, source } = createRasterSource(spec);
    const layer = new TileLayer({ source, preload: spec.preload ?? 0, opacity: spec.opacity ?? 1 });
    layer.set(SOURCE_KEY_PROP, key);
    attachTileErrorRecovery(layer);
    return layer;
  }
  if (spec.kind === 'gl-style') {
    // Declutter so the style's own label collision rules apply; without it
    // place names stack on top of each other at every zoom.
    const layer = new VectorTileLayer<VectorTileSource<RenderFeature>>({ declutter: true });
    applyGlStyle(layer, spec);
    return layer;
  }
  if (spec.kind === 'vector-tiles') {
    const { key, source } = createVectorTileSource(spec);
    const layer = new VectorTileLayer({
      source,
      // OL's minZoom is exclusive; callers pass the value they want applied.
      minZoom: spec.minZoom,
      // Low-resolution tiles fetched ahead, so zooming out lands on something
      // already drawn instead of on an empty map.
      preload: spec.preload ?? 0,
      // Re-render during zoom/pan so strokes stay crisp instead of the previous
      // level's tiles being scaled up, which makes polygons pulse.
      updateWhileAnimating: true,
      updateWhileInteracting: true,
    });
    layer.set(SOURCE_KEY_PROP, key);
    layer.setStyle(vectorTileStyle(layer));
    return layer;
  }
  const layer = new VectorLayer({
    source: new VectorSource({ features: toOlFeatures(spec.features) }),
    minZoom: spec.minZoom,
    updateWhileAnimating: true,
    updateWhileInteracting: true,
  });
  layer.setStyle(featureStyle(layer));
  return layer;
}

/** Style callbacks are compared by identity - callers memoize them, and their
 *  output is not knowable from here. */
const sameStyle = (a: unknown, b: unknown) =>
  typeof a === 'function' || typeof b === 'function'
    ? a === b
    : JSON.stringify(a) === JSON.stringify(b);

const sameList = (a: readonly unknown[] = [], b: readonly unknown[] = []) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** By content: these are rebuilt per compose, and a redraw of every feature is
 *  not worth saving the comparison. */
const sameSet = (a?: ReadonlySet<unknown>, b?: ReadonlySet<unknown>) =>
  (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((v) => !!b?.has(v));

/** Whether the layer's source has to be rebuilt, as opposed to properties that
 *  can be set on the existing one. Rebuilding drops the loaded tiles, so this
 *  stays as narrow as the source options themselves. */
function needsNewSource(prev: LayerSpec, next: LayerSpec): boolean {
  if (prev.kind !== next.kind) return true;
  if (next.kind === 'raster' && prev.kind === 'raster') {
    return (
      prev.url !== next.url ||
      prev.auth !== next.auth ||
      prev.attribution !== next.attribution ||
      prev.minZoom !== next.minZoom ||
      prev.maxZoom !== next.maxZoom ||
      prev.cacheScope !== next.cacheScope
    );
  }
  if (next.kind === 'gl-style' && prev.kind === 'gl-style') {
    return prev.styleUrl !== next.styleUrl;
  }
  if (next.kind === 'vector-tiles' && prev.kind === 'vector-tiles') {
    return (
      prev.url !== next.url ||
      prev.auth !== next.auth ||
      prev.idProperty !== next.idProperty ||
      !sameList(prev.sourceLayers, next.sourceLayers)
    );
  }
  return false;
}

function replaceSource(layer: BaseLayer, spec: LayerSpec): void {
  if (spec.kind === 'raster') {
    const raster = layer as TileLayer<XYZ>;
    const { key, source } = createRasterSource(spec);
    const previous = raster.get(SOURCE_KEY_PROP) as string | undefined;
    raster.setSource(source);
    raster.set(SOURCE_KEY_PROP, key);
    if (previous) releaseSource(previous);
    attachTileErrorRecovery(raster);
    return;
  }
  if (spec.kind === 'gl-style') {
    // applyStyle rewrites the existing source's tile URLs in place.
    applyGlStyle(layer as VectorTileLayer<VectorTileSource<RenderFeature>>, spec);
    return;
  }
  if (spec.kind === 'vector-tiles') {
    const vector = layer as VectorTileLayer<VectorTileSource<RenderFeature>>;
    const { key, source } = createVectorTileSource(spec);
    const previous = vector.get(SOURCE_KEY_PROP) as string | undefined;
    vector.setSource(source);
    vector.set(SOURCE_KEY_PROP, key);
    if (previous) releaseSource(previous);
  }
}

/** Applies `next` onto a layer built from `prev`. */
export function updateLayer(layer: BaseLayer, prev: LayerSpec, next: LayerSpec): void {
  // Style callbacks read the spec off the layer, so this also refreshes them.
  layer.set(SPEC_PROP, next);

  if (prev.visible !== next.visible) layer.setVisible(next.visible ?? true);
  if (prev.zIndex !== next.zIndex) layer.setZIndex(next.zIndex ?? 0);
  if (opacityOf(prev) !== opacityOf(next)) layer.setOpacity(opacityOf(next));

  if (needsNewSource(prev, next)) replaceSource(layer, next);

  if (next.kind === 'raster' && prev.kind === 'raster') {
    if (prev.preload !== next.preload) (layer as TileLayer<XYZ>).setPreload(next.preload ?? 0);
    return;
  }

  if (next.kind === 'vector-tiles' && prev.kind === 'vector-tiles') {
    // A raster's zoom limits live on its tile grid, a vector tile layer's on
    // the layer, mirroring where each stops requesting tiles.
    if (prev.minZoom !== next.minZoom) layer.setMinZoom(next.minZoom ?? -Infinity);
    if (prev.preload !== next.preload) {
      (layer as VectorTileLayer<VectorTileSource<RenderFeature>>).setPreload(next.preload ?? 0);
    }
    if (
      !sameStyle(prev.style, next.style) ||
      !sameSet(prev.hiddenFeatureIds, next.hiddenFeatureIds) ||
      !sameSet(prev.highlightFeatureIds, next.highlightFeatureIds)
    ) {
      layer.changed();
    }
    return;
  }

  if (next.kind === 'features' && prev.kind === 'features') {
    if (prev.minZoom !== next.minZoom) layer.setMinZoom(next.minZoom ?? -Infinity);
    // Compared by element identity: deep-comparing every geometry each render
    // would cost more than the re-render it saves, so callers keep feature
    // objects stable and replace only what changed.
    if (!sameList(prev.features, next.features)) {
      const source = (layer as VectorLayer<VectorSource<Feature>>).getSource();
      source?.clear();
      source?.addFeatures(toOlFeatures(next.features));
    }
    if (!sameStyle(prev.style, next.style)) layer.changed();
  }
}

/** Dropping the source aborts in-flight requests for a layer being removed -
 *  unless another map is still drawing the same tiles, which is what the
 *  refcount on the shared source decides. */
export function destroyLayer(layer: BaseLayer): void {
  if (layer instanceof TileLayer) detachTileErrorRecovery(layer as TileLayer<XYZ>);
  const key = layer.get(SOURCE_KEY_PROP) as string | undefined;
  if (key) {
    releaseSource(key);
    layer.unset(SOURCE_KEY_PROP, true);
  }
  const withSource = layer as unknown as { setSource?: (source: null) => void };
  if (typeof withSource.setSource === 'function') withSource.setSource(null);
}

// ---------------------------------------------------------------------------
// Keeping a map's layers in step with a spec list
// ---------------------------------------------------------------------------

/**
 * How many raster layers stay mounted but hidden. A retained layer holds its
 * loaded tiles, so this is really a bound on resident tile memory; past it the
 * least recently shown one is destroyed.
 */
export const MAX_RETAINED_LAYERS = 16;

export interface MountedLayer {
  spec: LayerSpec;
  layer: BaseLayer;
  /** Hidden but kept for its tiles, and the only eviction candidate. */
  retained: boolean;
}

/** Where reconciled layers live. `ol/Map` satisfies this. */
export interface LayerHost {
  addLayer(layer: BaseLayer): void;
  removeLayer(layer: BaseLayer): unknown;
}

/** What to do with each id. Only rasters are worth retaining: their cost is
 *  the tiles, not the layer. */
export interface LayerPlan {
  add: LayerId[];
  update: LayerId[];
  /** Hide but keep mounted for the tiles. */
  retain: LayerId[];
  remove: LayerId[];
}

/**
 * Decide the fate of every mounted and requested layer. `mounted` must be in
 * least-to-most-recently-shown order, which `applyPlan` maintains.
 *
 * Layers retiring in this pass were on screen until now, so they rank last for
 * eviction. A kind change is the one case where an id must be removed before
 * it is added again.
 */
export function planLayers(
  mounted: ReadonlyMap<LayerId, { spec: LayerSpec; retained: boolean }>,
  next: readonly LayerSpec[],
  retainLimit: number = MAX_RETAINED_LAYERS
): LayerPlan {
  const wanted = new Map(next.map((spec) => [spec.id, spec]));
  const plan: LayerPlan = { add: [], update: [], retain: [], remove: [] };
  const retiring: LayerId[] = [];
  const stale: LayerId[] = [];

  for (const [id, entry] of mounted) {
    const spec = wanted.get(id);
    if (spec) {
      // A kind change reuses the id, so the old layer must go first.
      if (spec.kind !== entry.spec.kind) plan.remove.push(id);
      continue;
    }
    if (entry.retained) stale.push(id);
    else if (entry.spec.kind === 'raster') retiring.push(id);
    else plan.remove.push(id);
  }

  for (const spec of next) {
    const entry = mounted.get(spec.id);
    if (!entry || entry.spec.kind !== spec.kind) plan.add.push(spec.id);
    else plan.update.push(spec.id);
  }

  const candidates = [...stale, ...retiring];
  const evictCount = Math.max(0, candidates.length - retainLimit);
  const evicted = new Set(candidates.slice(0, evictCount));

  plan.retain = retiring.filter((id) => !evicted.has(id));
  plan.remove.push(...evicted);
  return plan;
}

/** Re-inserting moves an entry to the recently-shown end of the map. */
function touch(mounted: Map<LayerId, MountedLayer>, id: LayerId, entry: MountedLayer): void {
  mounted.delete(id);
  mounted.set(id, entry);
}

/**
 * Bring `host` in line with `specs`. Removals for a kind change run before the
 * additions that reclaim the id; retired rasters are hidden in the same pass,
 * so stale imagery never stands in for a newly selected date while it loads.
 */
export function syncLayers(
  host: LayerHost,
  mounted: Map<LayerId, MountedLayer>,
  specs: readonly LayerSpec[],
  retainLimit: number = MAX_RETAINED_LAYERS
): void {
  const plan = planLayers(mounted, specs, retainLimit);
  const wanted = new Map(specs.map((spec) => [spec.id, spec]));

  const drop = (id: LayerId) => {
    const entry = mounted.get(id);
    if (!entry) return;
    host.removeLayer(entry.layer);
    destroyLayer(entry.layer);
    mounted.delete(id);
  };

  for (const id of plan.remove) drop(id);

  for (const id of plan.add) {
    const spec = wanted.get(id)!;
    const layer = createLayer(spec);
    host.addLayer(layer);
    mounted.set(id, { spec, layer, retained: false });
  }

  for (const id of plan.update) {
    const entry = mounted.get(id);
    const spec = wanted.get(id);
    if (!entry || !spec) continue;
    const wasRetained = entry.retained;
    updateLayer(entry.layer, entry.spec, spec);
    entry.spec = spec;
    if (wasRetained) {
      entry.retained = false;
      entry.layer.setVisible(spec.visible ?? true);
      if (entry.layer instanceof TileLayer) retryErroredTiles(entry.layer as TileLayer<XYZ>);
    }
  }

  for (const id of plan.retain) {
    const entry = mounted.get(id);
    if (!entry) continue;
    entry.retained = true;
    entry.layer.setVisible(false);
    touch(mounted, id, entry);
  }
}
