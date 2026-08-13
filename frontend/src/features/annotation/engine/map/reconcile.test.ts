import { describe, it, expect, vi } from 'vitest';
import type BaseLayer from 'ol/layer/Base';
import ImageTile from 'ol/ImageTile';
import TileLayer from 'ol/layer/Tile';
import TileState from 'ol/TileState';
import { applyLayerOps, reconcile, type LayerHost, type MountedLayer } from './reconcile';
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

const mounted = (...specs: LayerSpec[]) =>
  new Map(specs.map((spec) => [spec.id, { spec, retained: false }]));

const retained = (...specs: LayerSpec[]) =>
  new Map(specs.map((spec) => [spec.id, { spec, retained: true }]));

describe('reconcile', () => {
  it('adds layers that are not mounted yet', () => {
    const spec = raster();
    expect(reconcile(mounted(), [spec])).toEqual([{ type: 'add', spec }]);
  });

  it('removes layers whose tiles are not worth keeping', () => {
    expect(reconcile(mounted(features()), [])).toEqual([{ type: 'remove', id: 'draft' }]);
    expect(reconcile(mounted(vectorTiles()), [])).toEqual([{ type: 'remove', id: 'annotations' }]);
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

  it('replaces raster cache state at a task boundary', () => {
    const before = raster({ cacheScope: 'task-1' });
    const after = raster({ cacheScope: 'task-2' });
    expect(reconcile(mounted(before), [after])).toEqual([
      { type: 'update', id: 'imagery', spec: after, changed: ['cacheScope'] },
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

  it('handles several layers at once, incoming before outgoing', () => {
    const keep = vectorTiles();
    const added = features();
    const ops = reconcile(mounted(raster(), keep), [keep, added]);
    expect(ops).toEqual([
      { type: 'add', spec: added },
      { type: 'retain', id: 'imagery' },
    ]);
  });
});

describe('reconcile retention', () => {
  it('retains a raster that leaves the visible set', () => {
    expect(reconcile(mounted(raster()), [])).toEqual([{ type: 'retain', id: 'imagery' }]);
  });

  it('hides an outgoing date immediately while retaining its tile cache', () => {
    const oldDate = raster({ id: 'old' });
    const newDate = raster({ id: 'new' });
    expect(reconcile(mounted(oldDate), [newDate])).toEqual([
      { type: 'add', spec: newDate },
      { type: 'retain', id: 'old' },
    ]);
  });

  it('leaves an already retained raster alone', () => {
    expect(reconcile(retained(raster()), [])).toEqual([]);
  });

  it('restores a retained raster instead of adding a second one', () => {
    const spec = raster();
    expect(reconcile(retained(spec), [spec])).toEqual([
      { type: 'restore', id: 'imagery', spec, changed: [] },
    ]);
  });

  it('carries spec changes into the restore', () => {
    const before = raster({ opacity: 1 });
    const after = raster({ opacity: 0.5 });
    expect(reconcile(retained(before), [after])).toEqual([
      { type: 'restore', id: 'imagery', spec: after, changed: ['opacity'] },
    ]);
  });

  it('rebuilds a retained id that comes back as another kind', () => {
    const after = features({ id: 'imagery' });
    expect(reconcile(retained(raster()), [after])).toEqual([
      { type: 'remove', id: 'imagery' },
      { type: 'add', spec: after },
    ]);
  });

  it('evicts the least recently shown layers past the bound', () => {
    const current = new Map([
      ['a', { spec: raster({ id: 'a' }), retained: true }],
      ['b', { spec: raster({ id: 'b' }), retained: true }],
      ['c', { spec: raster({ id: 'c' }), retained: false }],
    ]);
    expect(reconcile(current, [], 2)).toEqual([
      { type: 'retain', id: 'c' },
      { type: 'remove', id: 'a' },
    ]);
  });
});

const testHost = () => {
  const layers: BaseLayer[] = [];
  return {
    layers,
    addLayer(layer: BaseLayer) {
      layers.push(layer);
    },
    removeLayer(layer: BaseLayer) {
      layers.splice(layers.indexOf(layer), 1);
    },
  };
};

const sync = (
  host: LayerHost,
  registry: Map<LayerId, MountedLayer>,
  specs: LayerSpec[],
  retainLimit?: number
) => applyLayerOps(host, registry, reconcile(registry, specs, retainLimit));

const sourceOf = (layer: BaseLayer | undefined) =>
  layer instanceof TileLayer ? layer.getSource() : null;

describe('applyLayerOps', () => {
  it('keeps a retiring raster on the host, hidden and loaded', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster()]);
    const layer = registry.get('imagery')?.layer;

    sync(host, registry, []);

    expect(host.layers).toEqual([layer]);
    expect(registry.get('imagery')?.retained).toBe(true);
    expect(layer?.getVisible()).toBe(false);
    expect(sourceOf(layer)).not.toBeNull();
  });

  it('hides the outgoing raster in the same pass that adds its replacement', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster({ id: 'old' })]);
    const layer = registry.get('old')!.layer;
    const replacement = raster({ id: 'new' });

    applyLayerOps(host, registry, reconcile(registry, [replacement]));

    expect(registry.get('old')?.retained).toBe(true);
    expect(layer.getVisible()).toBe(false);
    expect(registry.get('new')?.layer.getVisible()).toBe(true);
  });

  it('reuses the same layer and source when a spec comes back', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster({ id: 'a' })]);
    const layer = registry.get('a')?.layer;
    const source = sourceOf(layer);

    sync(host, registry, [raster({ id: 'b' })]);
    sync(host, registry, [raster({ id: 'a' })]);

    expect(registry.get('a')?.layer).toBe(layer);
    expect(sourceOf(registry.get('a')?.layer)).toBe(source);
    expect(layer?.getVisible()).toBe(true);
    expect(registry.get('b')?.retained).toBe(true);
    expect(host.layers).toHaveLength(2);
  });

  it('retries only failed renderer tiles when a retained date comes back', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster({ id: 'a' })]);
    const layer = registry.get('a')!.layer as TileLayer;
    const load = vi.fn();
    const failed = new ImageTile(
      [15, 1, 2],
      TileState.ERROR,
      'https://tiler/15/1/2.png',
      { crossOrigin: null },
      load
    );
    const renderer = layer.getRenderer() as unknown as {
      getTileCache(): { set(key: string, tile: ImageTile): void };
    };
    renderer.getTileCache().set('failed', failed);

    sync(host, registry, [raster({ id: 'b' })]);
    sync(host, registry, [raster({ id: 'a' })]);

    expect(load).toHaveBeenCalledOnce();
    expect(failed.getState()).toBe(TileState.LOADING);
  });

  it('rebuilds the source only when the spec asks for other tiles', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster({ opacity: 1 })]);
    const source = sourceOf(registry.get('imagery')?.layer);

    sync(host, registry, []);
    sync(host, registry, [raster({ opacity: 0.5 })]);
    expect(sourceOf(registry.get('imagery')?.layer)).toBe(source);

    sync(host, registry, []);
    sync(host, registry, [raster({ url: 'https://other/{z}/{x}/{y}.png' })]);
    expect(sourceOf(registry.get('imagery')?.layer)).not.toBe(source);
  });

  it('destroys the least recently shown layer past the bound', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster({ id: 'a' })], 2);
    const first = registry.get('a')?.layer;
    for (const id of ['b', 'c', 'd']) sync(host, registry, [raster({ id })], 2);

    expect([...registry.keys()].sort()).toEqual(['b', 'c', 'd']);
    expect(host.layers).toHaveLength(3);
    expect(sourceOf(first)).toBeNull();
  });

  it('bounds a 120-date history and leaves only the selected date visible', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    for (let index = 0; index < 120; index++) {
      sync(host, registry, [raster({ id: `date-${index}` })], 16);
    }

    expect(registry.size).toBe(17);
    expect(host.layers).toHaveLength(17);
    expect(
      [...registry.entries()].filter(([, mounted]) => mounted.layer.getVisible()).map(([id]) => id)
    ).toEqual(['date-119']);
  });

  it('never evicts a layer that is coming back into view', () => {
    const host = testHost();
    const registry = new Map<LayerId, MountedLayer>();
    sync(host, registry, [raster({ id: 'a' })], 1);
    const layer = registry.get('a')?.layer;

    sync(host, registry, [raster({ id: 'b' })], 1);
    sync(host, registry, [raster({ id: 'a' })], 1);

    expect(registry.get('a')?.layer).toBe(layer);
    expect(registry.has('b')).toBe(true);
  });
});
