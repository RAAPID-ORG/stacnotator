import { describe, it, expect, vi } from 'vitest';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorSource from 'ol/source/Vector';
import type VectorTileSource from 'ol/source/VectorTile';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import type RenderFeature from 'ol/render/Feature';
import type Style from 'ol/style/Style';
import { get as getProjection, fromLonLat } from 'ol/proj';
import { applyBackground, applyStyle } from 'ol-mapbox-style';
import {
  LAYER_ID_PROP,
  createLayer,
  destroyLayer,
  featurePropsOf,
  layerFeatureId,
  updateLayer,
} from './layers';
import type {
  FeatureLayerSpec,
  GlStyleLayerSpec,
  RasterLayerSpec,
  VectorTileLayerSpec,
} from './types';
import { SELECTED_EXTRA_WIDTH } from './types';

// The real ones fetch the style JSON and its TileJSON; what this file can check
// is that we hand them the right layer and URL.
vi.mock('ol-mapbox-style', () => ({
  applyStyle: vi.fn(() => Promise.resolve()),
  applyBackground: vi.fn(() => Promise.resolve()),
}));

const mercator = getProjection('EPSG:3857')!;

const rasterSourceOf = (layer: unknown) => (layer as TileLayer<XYZ>).getSource()!;

const sourceOf = (layer: unknown) =>
  (layer as VectorTileLayer<VectorTileSource<RenderFeature>>).getSource();

// crossOrigin is typed protected on TileImage but is the only observable proof
// that a source will send the tiler cookie.
const crossOriginOf = (layer: unknown) =>
  (rasterSourceOf(layer) as unknown as { crossOrigin: string | null }).crossOrigin;

describe('raster layers', () => {
  const spec = (over: Partial<RasterLayerSpec> = {}): RasterLayerSpec => ({
    kind: 'raster',
    id: 'imagery',
    url: 'https://tiler/{z}/{x}/{y}.png',
    ...over,
  });

  it('tags the layer with its id and applies presentation fields', () => {
    const layer = createLayer(spec({ opacity: 0.5, zIndex: 4, visible: false }));
    expect(layer.get(LAYER_ID_PROP)).toBe('imagery');
    expect(layer.getOpacity()).toBe(0.5);
    expect(layer.getZIndex()).toBe(4);
    expect(layer.getVisible()).toBe(false);
  });

  it('expands {q} templates to Bing quadkeys', () => {
    const layer = createLayer(spec({ url: 'https://bing/{q}.jpeg' }));
    const url = rasterSourceOf(layer).getTileUrlFunction()([2, 1, 2], 1, mercator);
    expect(url).toBe('https://bing/21.jpeg');
  });

  it('sends credentials for cookie auth and for the app-registered proxy URLs', () => {
    expect(crossOriginOf(createLayer(spec({ auth: 'cookie' })))).toBe('use-credentials');

    const proxied = spec({ url: '/api/7/imagery/slices/9/tiles/NDVI/{z}/{x}/{y}' });
    expect(crossOriginOf(createLayer(proxied))).toBe('use-credentials');

    expect(crossOriginOf(createLayer(spec()))).toBe('anonymous');
  });

  it('rebuilds the source on a url change and keeps the layer instance', () => {
    const before = spec();
    const layer = createLayer(before);
    const source = rasterSourceOf(layer);

    const after = spec({ url: 'https://other/{z}/{x}/{y}.png' });
    updateLayer(layer, before, after);
    expect(rasterSourceOf(layer)).not.toBe(source);
    expect(rasterSourceOf(layer).getUrls()).toEqual(['https://other/{z}/{x}/{y}.png']);
  });

  it('shares the tile cache when the same raster is visible in two maps', () => {
    const main = createLayer(spec({ id: 'main-imagery' }));
    const window = createLayer(spec({ id: 'window-imagery' }));

    expect(rasterSourceOf(main)).toBe(rasterSourceOf(window));
    destroyLayer(main);
    expect(rasterSourceOf(window)).not.toBeNull();
    destroyLayer(window);
  });

  it('does not carry source state across task cache scopes', () => {
    const firstTask = createLayer(spec({ id: 'first', cacheScope: 'task-1' }));
    const secondTask = createLayer(spec({ id: 'second', cacheScope: 'task-2' }));

    expect(rasterSourceOf(firstTask)).not.toBe(rasterSourceOf(secondTask));
    destroyLayer(firstTask);
    destroyLayer(secondTask);
  });

  it('limits the tile grid and preload depth from the spec', () => {
    const layer = createLayer(spec({ minZoom: 4, maxZoom: 18, preload: 2 }));
    const grid = rasterSourceOf(layer).getTileGrid()!;
    expect(grid.getMinZoom()).toBe(4);
    expect(grid.getMaxZoom()).toBe(18);
    expect((layer as TileLayer<XYZ>).getPreload()).toBe(2);
    expect((createLayer(spec()) as TileLayer<XYZ>).getPreload()).toBe(0);
  });

  it('draws cached raster tiles without an alpha fade during a layer switch', () => {
    const source = rasterSourceOf(createLayer(spec())) as XYZ & {
      tileOptions: { transition: number };
    };
    expect(source.tileOptions.transition).toBe(0);
  });

  it('rebuilds the grid for a zoom-limit change and sets preload in place', () => {
    const first = spec({ minZoom: 4, preload: 0 });
    const layer = createLayer(first);
    const source = rasterSourceOf(layer);

    const second = spec({ minZoom: 4, preload: 4 });
    updateLayer(layer, first, second);
    expect((layer as TileLayer<XYZ>).getPreload()).toBe(4);
    expect(rasterSourceOf(layer)).toBe(source);

    updateLayer(layer, second, spec({ minZoom: 6, preload: 4 }));
    expect(rasterSourceOf(layer)).not.toBe(source);
    expect(rasterSourceOf(layer).getTileGrid()!.getMinZoom()).toBe(6);
  });

  it('drops the source on destroy so in-flight tile requests abort', () => {
    const layer = createLayer(spec());
    destroyLayer(layer);
    expect((layer as TileLayer<XYZ>).getSource()).toBeNull();
  });
});

describe('vector tile layers', () => {
  const spec = (over: Partial<VectorTileLayerSpec> = {}): VectorTileLayerSpec => ({
    kind: 'vector-tiles',
    id: 'annotations',
    url: 'https://api/tiles/{z}/{x}/{y}.pbf',
    style: { stroke: { color: '#f00', width: 2 } },
    ...over,
  });

  const tileFeature = (id: number) => {
    const feature = new Feature({ geometry: new Point([0, 0]), label_id: 3 });
    feature.setId(id);
    return feature;
  };

  const styleOf = (layer: unknown, id: number) =>
    (layer as VectorTileLayer<VectorTileSource<RenderFeature>>).getStyleFunction()!(
      tileFeature(id),
      1
    ) as Style | undefined;

  it('hides features owned by the editing interaction', () => {
    const layer = createLayer(spec({ hiddenFeatureIds: new Set([7]) }));
    expect(styleOf(layer, 7)).toBeUndefined();
    expect(styleOf(layer, 8)).toBeDefined();
  });

  it('thickens the stroke of highlighted features', () => {
    const layer = createLayer(spec({ highlightFeatureIds: new Set([7]) }));
    // Matches the delta layer's selected emphasis exactly - the same annotation
    // must not look fatter just because it arrived as a tile.
    expect(styleOf(layer, 7)?.getStroke()?.getWidth()).toBe(2 + SELECTED_EXTRA_WIDTH);
    expect(styleOf(layer, 8)?.getStroke()?.getWidth()).toBe(2);
  });

  it('re-reads hidden ids after an update without touching the source', () => {
    const before = spec({ hiddenFeatureIds: new Set([7]) });
    const layer = createLayer(before);
    const source = (layer as VectorTileLayer<VectorTileSource<RenderFeature>>).getSource();
    updateLayer(layer, before, spec({ hiddenFeatureIds: new Set([8]) }));
    expect((layer as VectorTileLayer<VectorTileSource<RenderFeature>>).getSource()).toBe(source);
    expect(styleOf(layer, 7)).toBeDefined();
    expect(styleOf(layer, 8)).toBeUndefined();
  });

  it('promotes idProperty to the feature id and filters source layers', () => {
    const layer = createLayer(
      spec({ idProperty: 'annotation_id', sourceLayers: ['annotations'] })
    ) as VectorTileLayer<VectorTileSource<RenderFeature>>;
    // MVT keeps both settings private; reading them is the only proof the format
    // will promote the id and drop other layers.
    const { format_: format } = layer.getSource() as unknown as {
      format_: { idProperty_?: string; layers_: string[] | null };
    };
    expect(format.idProperty_).toBe('annotation_id');
    expect(format.layers_).toEqual(['annotations']);
  });

  it('matches hidden ids through idProperty when the source carries no ol id', () => {
    const layer = createLayer(
      spec({ idProperty: 'annotation_id', hiddenFeatureIds: new Set([7]) })
    );
    const styleFn = (layer as VectorTileLayer<VectorTileSource<RenderFeature>>).getStyleFunction()!;
    const untagged = new Feature({ geometry: new Point([0, 0]), annotation_id: 7 });
    const other = new Feature({ geometry: new Point([0, 0]), annotation_id: 8 });
    expect(styleFn(untagged, 1)).toBeUndefined();
    expect(styleFn(other, 1)).toBeDefined();
    expect(layerFeatureId(layer, untagged)).toBe(7);
  });

  it('applies minZoom on the layer without touching the source', () => {
    const before = spec({ minZoom: 10 });
    const layer = createLayer(before) as VectorTileLayer<VectorTileSource<RenderFeature>>;
    expect(layer.getMinZoom()).toBe(10);
    const source = layer.getSource();
    updateLayer(layer, before, spec({ minZoom: 12 }));
    expect(layer.getMinZoom()).toBe(12);
    expect(layer.getSource()).toBe(source);
  });

  it('rebuilds the source when the format settings change', () => {
    const before = spec({ idProperty: 'a' });
    const layer = createLayer(before) as VectorTileLayer<VectorTileSource<RenderFeature>>;
    const source = layer.getSource();
    updateLayer(layer, before, spec({ idProperty: 'b' }));
    expect(layer.getSource()).not.toBe(source);
  });

  it('skips features whose style callback returns null', () => {
    const layer = createLayer(
      spec({ style: (props) => (props.label_id === 3 ? null : { fill: { color: '#000' } }) })
    );
    expect(styleOf(layer, 7)).toBeUndefined();
  });
});

describe('feature layers', () => {
  const point: FeatureLayerSpec = {
    kind: 'features',
    id: 'draft',
    features: [{ id: 7, geometry: { type: 'Point', coordinates: [10, 50] }, properties: { a: 1 } }],
    style: { circle: { radius: 4, fill: { color: '#f00' } } },
  };

  it('reprojects 4326 geometry into the view projection', () => {
    const layer = createLayer(point) as VectorLayer<VectorSource<Feature>>;
    const features = layer.getSource()!.getFeatures();
    expect(features).toHaveLength(1);
    expect(features[0].getId()).toBe(7);
    const coords = (features[0].getGeometry() as Point).getCoordinates();
    expect(coords[0]).toBeCloseTo(fromLonLat([10, 50])[0], 6);
    expect(coords[1]).toBeCloseTo(fromLonLat([10, 50])[1], 6);
  });

  it('replaces the feature set in place', () => {
    const layer = createLayer(point) as VectorLayer<VectorSource<Feature>>;
    const source = layer.getSource() as VectorSource<Feature>;
    updateLayer(layer, point, { ...point, features: [] });
    expect(layer.getSource()).toBe(source);
    expect(source.getFeatures()).toHaveLength(0);
  });

  it('styles features through the spec callback', () => {
    const style = vi.fn(() => ({ fill: { color: '#0f0' } }));
    const layer = createLayer({ ...point, style }) as VectorLayer<VectorSource<Feature>>;
    const feature = layer.getSource()!.getFeatures()[0];
    const styleFn = layer.getStyleFunction()!;
    expect(styleFn(feature, 1)).toBeDefined();
    expect(style).toHaveBeenCalledWith(point.features[0]);
  });

  it('reuses one Style for callbacks that allocate a fresh spec per feature', () => {
    const style = vi.fn(() => ({ fill: { color: '#0f0' } }));
    const layer = createLayer({
      ...point,
      features: [
        { id: 1, geometry: { type: 'Point', coordinates: [0, 0] } },
        { id: 2, geometry: { type: 'Point', coordinates: [1, 1] } },
      ],
      style,
    }) as VectorLayer<VectorSource<Feature>>;
    const styleFn = layer.getStyleFunction()!;
    const [a, b] = layer.getSource()!.getFeatures();
    expect(styleFn(a, 1)).toBe(styleFn(b, 1));
  });

  it('hands callers their own properties, not OL or bookkeeping keys', () => {
    const layer = createLayer(point) as VectorLayer<VectorSource<Feature>>;
    expect(featurePropsOf(layer.getSource()!.getFeatures()[0])).toEqual({ a: 1 });
  });
});

// A campaign can have a hundred imagery windows open, every one of them drawing
// the same annotations over its own date.
describe('sharing tiles between maps', () => {
  const annotations = (url: string): VectorTileLayerSpec => ({
    kind: 'vector-tiles',
    id: 'annotations',
    url,
    auth: 'bearer',
    idProperty: 'annotation_id',
    style: { stroke: { color: '#f00', width: 1 } },
  });

  it('gives two maps drawing the same tiles one source, and one tile cache', () => {
    const first = createLayer(annotations('https://api.test/a/{z}/{x}/{y}.pbf?v=1'));
    const second = createLayer(annotations('https://api.test/a/{z}/{x}/{y}.pbf?v=1'));

    expect(sourceOf(second)).toBe(sourceOf(first));
  });

  it('keeps different tiles apart', () => {
    const first = createLayer(annotations('https://api.test/a/{z}/{x}/{y}.pbf?v=1'));
    const second = createLayer(annotations('https://api.test/a/{z}/{x}/{y}.pbf?v=2'));

    expect(sourceOf(second)).not.toBe(sourceOf(first));
  });

  // Otherwise the last map to close would leave the source pooled forever, and
  // a later map would reuse a cache nobody refreshed.
  it('drops the shared source once the last map lets go of it', () => {
    const spec = annotations('https://api.test/b/{z}/{x}/{y}.pbf?v=1');
    const first = createLayer(spec);
    const shared = sourceOf(first);
    const second = createLayer(spec);

    destroyLayer(first);
    const third = createLayer(spec);
    expect(sourceOf(third)).toBe(shared);

    destroyLayer(second);
    destroyLayer(third);
    expect(sourceOf(createLayer(spec))).not.toBe(shared);
  });
});

describe('GL style layers', () => {
  const spec = (over: Partial<GlStyleLayerSpec> = {}): GlStyleLayerSpec => ({
    kind: 'gl-style',
    id: 'basemap',
    styleUrl: 'https://tiles.test/styles/positron',
    ...over,
  });

  it('paints the style and its background onto a decluttered vector tile layer', () => {
    const layer = createLayer(spec({ opacity: 0.6, zIndex: 0 }));

    expect(layer).toBeInstanceOf(VectorTileLayer);
    expect(layer.get(LAYER_ID_PROP)).toBe('basemap');
    expect(layer.getOpacity()).toBe(0.6);
    // Without declutter the style's own label collision rules never run.
    expect((layer as VectorTileLayer<VectorTileSource<RenderFeature>>).getDeclutter()).toBeTruthy();
    expect(applyStyle).toHaveBeenCalledWith(layer, 'https://tiles.test/styles/positron');
    expect(applyBackground).toHaveBeenCalledWith(layer, 'https://tiles.test/styles/positron');
  });

  it('re-applies only when the style URL changes', () => {
    const prev = spec();
    const layer = createLayer(prev);
    vi.mocked(applyStyle).mockClear();

    updateLayer(layer, prev, { ...prev, opacity: 0.5 });
    expect(applyStyle).not.toHaveBeenCalled();
    expect(layer.getOpacity()).toBe(0.5);

    const next = spec({ styleUrl: 'https://tiles.test/styles/dark' });
    updateLayer(layer, prev, next);
    expect(applyStyle).toHaveBeenCalledWith(layer, 'https://tiles.test/styles/dark');
  });

  // olms owns the source, so it must not be handed to the shared raster pool.
  it('holds no pooled source to release', () => {
    const layer = createLayer(spec());
    expect(() => destroyLayer(layer)).not.toThrow();
    expect(sourceOf(layer)).toBeNull();
  });
});
