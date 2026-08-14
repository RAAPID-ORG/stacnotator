import { describe, it, expect } from 'vitest';
import {
  makeCampaign,
  makeCollection,
  makeCustomMap,
  makeSlice,
  makeSource,
  makeTileUrl,
  makeVectorLayer,
  makeViz,
} from '../testing/fixtures';
import { buildImageryCatalog } from './imagery';

const source = makeSource({
  id: 1,
  name: 'S2',
  collections: [
    makeCollection({
      id: 10,
      name: 'Col A',
      has_dedicated_cover: false,
      slices: [
        makeSlice({
          id: 100,
          name: 'Slice A',
          tile_urls: [
            makeTileUrl({
              id: 1,
              visualization_name: 'True Color',
              tile_url: 'https://tiler/1/{z}/{x}/{y}.png',
            }),
            makeTileUrl({
              id: 2,
              visualization_name: 'Needs Key',
              tile_url: 'https://p/{z}/{x}/{y}.png?api_key={api_key}',
            }),
          ],
        }),
      ],
    }),
  ],
  visualizations: [
    makeViz({ id: 1000, name: 'True Color' }),
    makeViz({ id: 1001, name: 'Needs Key' }),
  ],
});

const campaign = makeCampaign({
  imagery_sources: [source],
  basemaps: [{ id: 5, name: 'Osm', url: 'https://osm/{z}/{x}/{y}.png' }],
  custom_maps: [
    makeCustomMap({
      id: 9,
      name: 'CM',
      tile_url: 'https://tiler/searches/s1/tiles/WebMercatorQuad/{z}/{x}/{y}.png',
    }),
  ],
  vector_layers: [
    makeVectorLayer({ id: 3, name: 'V', pmtiles_url: 'https://x/v.pmtiles', color: '#fff' }),
  ],
});

describe('buildImageryCatalog', () => {
  const cat = buildImageryCatalog(campaign);

  it('indexes sources, collections, slices, and visualizations by id', () => {
    expect(cat.sources.get(1)).toBe(source);
    expect(cat.collections.get(10)).toBe(source.collections[0]);
    expect(cat.slices.get(100)).toBe(source.collections[0].slices[0]);
    expect(cat.vizzes.get(1000)).toBe(source.visualizations[0]);
  });

  it('indexes basemaps, custom maps, and vector layers by id', () => {
    expect(cat.basemaps.get(5)?.name).toBe('Osm');
    expect(cat.customMaps.get(9)?.name).toBe('CM');
    expect(cat.vectorLayers.get(3)?.name).toBe('V');
  });

  it('maps a collection id back to its owning source id', () => {
    expect(cat.sourceOf.get(10)).toBe(1);
  });

  it('derives bbox from campaign settings', () => {
    expect(cat.bbox).toEqual([-10, -20, 10, 20]);
  });

  it('carries the campaign id for proxy url assembly', () => {
    expect(cat.campaignId).toBe(7);
  });
});
