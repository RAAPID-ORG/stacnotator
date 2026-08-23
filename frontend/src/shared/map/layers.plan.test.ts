import { describe, expect, it } from 'vitest';
import { planLayers, MAX_RETAINED_LAYERS } from './layers';
import type { LayerId, LayerSpec, RasterLayerSpec } from './types';

const raster = (id: string): RasterLayerSpec => ({
  kind: 'raster',
  id,
  url: `https://tiler/${id}/{z}/{x}/{y}.png`,
});

const vector = (id: string): LayerSpec => ({
  kind: 'vector-tiles',
  id,
  url: `https://tiler/${id}/{z}/{x}/{y}.pbf`,
  style: {},
});

const features = (id: string): LayerSpec => ({ kind: 'features', id, features: [], style: {} });

/** `mounted` is ordered least- to most-recently-shown, which is the order
 *  `syncLayers` maintains and eviction depends on. */
function mounted(...entries: Array<[LayerSpec, boolean]>) {
  return new Map<LayerId, { spec: LayerSpec; retained: boolean }>(
    entries.map(([spec, retained]) => [spec.id, { spec, retained }])
  );
}

describe('planLayers', () => {
  it('adds what is new and updates what is already there', () => {
    const plan = planLayers(mounted([raster('a'), false]), [raster('a'), raster('b')]);
    expect(plan).toMatchObject({ add: ['b'], update: ['a'], retain: [], remove: [] });
  });

  it('removes a layer whose kind changed before adding it back under the same id', () => {
    const plan = planLayers(mounted([features('draft'), false]), [vector('draft')]);
    expect(plan.remove).toEqual(['draft']);
    expect(plan.add).toEqual(['draft']);
  });

  it('drops a retiring vector layer outright but retains a raster for its tiles', () => {
    expect(planLayers(mounted([vector('annotations'), false]), []).remove).toEqual(['annotations']);
    const kept = planLayers(mounted([raster('imagery'), false]), []);
    expect(kept).toMatchObject({ retain: ['imagery'], remove: [] });
  });

  it('brings a retained layer back as an update rather than a rebuild', () => {
    const plan = planLayers(mounted([raster('imagery'), true]), [raster('imagery')]);
    expect(plan).toMatchObject({ add: [], update: ['imagery'], remove: [] });
  });

  it('evicts the least recently shown retained layers past the limit', () => {
    const stale = Array.from({ length: MAX_RETAINED_LAYERS + 2 }, (_, i) => raster(`old-${i}`));
    const plan = planLayers(
      mounted(...stale.map((spec) => [spec, true] as [LayerSpec, boolean]), [
        raster('live'),
        false,
      ]),
      [raster('live')]
    );
    // Two over the limit, and the oldest two go.
    expect(plan.remove).toEqual(['old-0', 'old-1']);
    expect(plan.retain).toEqual([]);
  });

  it('ranks a layer retiring in this pass above the already-retained ones', () => {
    const plan = planLayers(mounted([raster('stale'), true], [raster('leaving'), false]), [], 1);
    // One slot: the layer that was on screen until now keeps it.
    expect(plan.remove).toEqual(['stale']);
    expect(plan.retain).toEqual(['leaving']);
  });
});
