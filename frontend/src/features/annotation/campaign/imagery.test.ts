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
import type { CustomMapOut } from '~/api/client';
import {
  buildImageryCatalog,
  readyCustomMaps,
  sliceHasImagery,
  withSceneLayers,
  withSceneSearch,
} from './imagery';

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

describe('readyCustomMaps', () => {
  const map = (id: number, over: Partial<CustomMapOut> = {}): CustomMapOut =>
    makeCustomMap({
      id,
      name: `Map ${id}`,
      tile_url: `https://tiles.example.com/${id}/{z}/{x}/{y}.png`,
      ...over,
    });

  it('keeps only ready maps with a tile_url', () => {
    const ready = map(1);
    expect(
      readyCustomMaps([
        ready,
        map(4, { status: 'registering', tile_url: null }),
        map(5, { tile_url: null }),
      ])
    ).toEqual([ready]);
  });
});

describe('a scene source over one viewport', () => {
  const catalogWithScenes = () =>
    buildImageryCatalog(
      makeCampaign({
        imagery_sources: [
          makeSource({
            id: 1,
            visualizations: [makeViz({ id: 1000, name: 'Visual' })],
            collections: [
              makeCollection({
                id: 10,
                slices: [
                  makeSlice({ id: 100, tile_urls: [] }),
                  makeSlice({ id: 101, tile_urls: [] }),
                ],
              }),
            ],
          }),
        ],
      })
    );

  it('mints nothing but what came back with a layer, and keeps the rest steppable', () => {
    const cat = withSceneSearch(catalogWithScenes(), 1, 'Visual', [
      { slice_id: 100, scene_count: 3, layer_id: 'abc' },
      { slice_id: 101, scene_count: 2, layer_id: null },
    ]);

    const [cover, date] = cat.collections.get(10)!.slices;
    expect(cover.tile_urls[0].tile_url).toContain('abc');
    expect(cover.tile_urls[0].visualization_name).toBe('Visual');
    // Found here, so it is worth stepping to - its layer is minted when it is opened.
    expect(date.tile_urls).toEqual([]);
    expect(sliceHasImagery(cat, date)).toBe(true);
    // The slice index has to agree with the collection, or the map draws one thing
    // and navigation reasons about another.
    expect(cat.slices.get(100)!.tile_urls).toHaveLength(1);
  });

  it('draws a minted layer in without disturbing what the search left', () => {
    const searched = withSceneSearch(catalogWithScenes(), 1, 'Visual', [
      { slice_id: 100, scene_count: 3, layer_id: 'abc' },
      { slice_id: 101, scene_count: 2, layer_id: null },
    ]);

    const opened = withSceneLayers(searched, 1, 'Visual', [
      { slice_id: 101, scene_count: 2, layer_id: 'def' },
    ]);

    expect(opened.slices.get(100)!.tile_urls[0].tile_url).toContain('abc');
    expect(opened.slices.get(101)!.tile_urls[0].tile_url).toContain('def');
  });

  it('replaces what a previous search left, because it was over somewhere else', () => {
    const first = withSceneSearch(catalogWithScenes(), 1, 'Visual', [
      { slice_id: 100, scene_count: 1, layer_id: 'abc' },
    ]);
    const second = withSceneSearch(first, 1, 'Visual', [
      { slice_id: 101, scene_count: 1, layer_id: 'def' },
    ]);

    expect(second.slices.get(100)!.tile_urls).toEqual([]);
    expect(sliceHasImagery(second, second.slices.get(100)!)).toBe(false);
    expect(second.slices.get(101)!.tile_urls[0].tile_url).toContain('def');
  });
});
