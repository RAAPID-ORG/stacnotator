import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import type {
  FeatureLayerSpec,
  LayerId,
  LayerSpec,
  RasterLayerSpec,
  VectorTileLayerSpec,
} from './types';

const raster = (over: Partial<RasterLayerSpec> = {}): RasterLayerSpec => ({
  kind: 'raster',
  id: 'imagery',
  url: 'https://tiler/{z}/{x}/{y}.png',
  ...over,
});

const vectorTiles = (over: Partial<VectorTileLayerSpec> = {}): VectorTileLayerSpec => ({
  kind: 'vector-tiles',
  id: 'annotations',
  url: 'https://api/tiles/{z}/{x}/{y}.pbf',
  style: { stroke: { color: '#f00', width: 2 } },
  ...over,
});

const features = (over: Partial<FeatureLayerSpec> = {}): FeatureLayerSpec => ({
  kind: 'features',
  id: 'draft',
  features: [],
  style: { fill: { color: '#fff' } },
  ...over,
});

const mounted = (...specs: LayerSpec[]): ReadonlyMap<LayerId, { spec: LayerSpec }> =>
  new Map(specs.map((spec) => [spec.id, { spec }]));

describe('reconcile', () => {
  it('adds layers that are not mounted yet', () => {
    const spec = raster();
    expect(reconcile(mounted(), [spec])).toEqual([{ type: 'add', spec }]);
  });

  it('removes layers that are gone from the next specs', () => {
    expect(reconcile(mounted(raster()), [])).toEqual([{ type: 'remove', id: 'imagery' }]);
  });

  it('emits nothing for stable specs', () => {
    const spec = raster({ opacity: 0.5, zIndex: 3, visible: true });
    expect(reconcile(mounted(spec), [{ ...spec }])).toEqual([]);
  });

  it('emits an update per changed field', () => {
    const before = raster({ opacity: 1, visible: true });
    const after = raster({ opacity: 0.4, visible: false, url: 'https://other/{z}/{x}/{y}.png' });
    expect(reconcile(mounted(before), [after])).toEqual([
      { type: 'update', id: 'imagery', spec: after, changed: ['url', 'opacity', 'visible'] },
    ]);
  });

  it('reports raster tile-grid and preload changes', () => {
    const before = raster({ minZoom: 4, maxZoom: 18, preload: 0 });
    const after = raster({ minZoom: 5, maxZoom: 20, preload: 2 });
    expect(reconcile(mounted(before), [after])).toEqual([
      {
        type: 'update',
        id: 'imagery',
        spec: after,
        changed: ['minZoom', 'maxZoom', 'preload'],
      },
    ]);
  });

  it('reports vector-tile format and zoom changes', () => {
    const before = vectorTiles({ idProperty: 'annotation_id', sourceLayers: ['a'], minZoom: 10 });
    const after = vectorTiles({ idProperty: 'feature_id', sourceLayers: ['a', 'b'], minZoom: 11 });
    expect(reconcile(mounted(before), [after])).toEqual([
      {
        type: 'update',
        id: 'annotations',
        spec: after,
        changed: ['idProperty', 'sourceLayers', 'minZoom'],
      },
    ]);
  });

  it('ignores a source-layer list rebuilt with the same contents', () => {
    const before = vectorTiles({ sourceLayers: ['a', 'b'] });
    expect(reconcile(mounted(before), [vectorTiles({ sourceLayers: ['a', 'b'] })])).toEqual([]);
  });

  it('treats a kind change as remove plus add', () => {
    const after = features({ id: 'imagery' });
    expect(reconcile(mounted(raster()), [after])).toEqual([
      { type: 'remove', id: 'imagery' },
      { type: 'add', spec: after },
    ]);
  });

  it('reports vector-tile filter and style changes', () => {
    const before = vectorTiles({ hiddenFeatureIds: [1], highlightFeatureIds: [] });
    const after = vectorTiles({ hiddenFeatureIds: [2], highlightFeatureIds: [] });
    expect(reconcile(mounted(before), [after])).toEqual([
      { type: 'update', id: 'annotations', spec: after, changed: ['hiddenFeatureIds'] },
    ]);
  });

  it('ignores id arrays that were rebuilt with the same contents', () => {
    const before = vectorTiles({ hiddenFeatureIds: [1, 2] });
    const after = vectorTiles({ hiddenFeatureIds: [1, 2] });
    expect(reconcile(mounted(before), [after])).toEqual([]);
  });

  it('compares inline style objects structurally but style functions by identity', () => {
    const styleFn = () => ({ fill: { color: '#000' } });
    const sameShape = reconcile(mounted(vectorTiles()), [
      vectorTiles({ style: { stroke: { color: '#f00', width: 2 } } }),
    ]);
    expect(sameShape).toEqual([]);

    const toFn = vectorTiles({ style: styleFn });
    expect(reconcile(mounted(vectorTiles()), [toFn])).toEqual([
      { type: 'update', id: 'annotations', spec: toFn, changed: ['style'] },
    ]);
    expect(reconcile(mounted(toFn), [vectorTiles({ style: styleFn })])).toEqual([]);
  });

  it('reports feature-collection changes by element identity', () => {
    const a = { id: 1, geometry: { type: 'Point', coordinates: [0, 0] } as GeoJSON.Point };
    const before = features({ features: [a] });
    expect(reconcile(mounted(before), [features({ features: [a] })])).toEqual([]);

    const after = features({ features: [a, { ...a, id: 2 }] });
    expect(reconcile(mounted(before), [after])).toEqual([
      { type: 'update', id: 'draft', spec: after, changed: ['features'] },
    ]);
  });

  it('handles several layers at once, removes before adds', () => {
    const keep = vectorTiles();
    const added = features();
    const ops = reconcile(mounted(raster(), keep), [keep, added]);
    expect(ops).toEqual([
      { type: 'remove', id: 'imagery' },
      { type: 'add', spec: added },
    ]);
  });
});
