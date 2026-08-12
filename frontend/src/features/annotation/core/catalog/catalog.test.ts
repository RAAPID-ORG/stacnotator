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
} from './testHelpers';
import {
  buildCatalog,
  layerSpecFor,
  needsKeyProxy,
  isProxiedTileUrl,
  basemapTileProxyUrl,
  sliceTileProxyUrl,
  resolveBasemapUrl,
} from './catalog';

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

describe('buildCatalog', () => {
  const cat = buildCatalog(campaign);

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
    expect(cat.sourceIdByCollectionId.get(10)).toBe(1);
  });

  it('derives bbox from campaign settings', () => {
    expect(cat.bbox).toEqual([-10, -20, 10, 20]);
  });

  it('carries the campaign id for proxy url assembly', () => {
    expect(cat.campaignId).toBe(7);
  });
});

describe('proxy tile url helpers', () => {
  it('needsKeyProxy is true only when an {api_key} placeholder remains', () => {
    expect(needsKeyProxy('https://p/{z}/{x}/{y}.png?api_key={api_key}')).toBe(true);
    expect(needsKeyProxy('https://osm/{z}/{x}/{y}.png')).toBe(false);
  });

  it('routes {api_key} basemaps through the proxy, preserving z/x/y', () => {
    const url = basemapTileProxyUrl(7, 3);
    expect(url).toBe('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}');
    expect(isProxiedTileUrl(url)).toBe(true);
  });

  it('routes {api_key} slice tiles through the proxy with an encoded viz name', () => {
    const url = sliceTileProxyUrl(7, 9, 'True Color');
    expect(url).toBe('/api/7/imagery/slices/9/tiles/True%20Color/{z}/{x}/{y}');
  });

  it('resolveBasemapUrl leaves keyless basemaps as a direct URL', () => {
    const direct = 'https://osm/{z}/{x}/{y}.png';
    expect(resolveBasemapUrl(7, { id: 3, url: direct })).toBe(direct);
  });

  it('resolveBasemapUrl routes {api_key} basemaps through the proxy', () => {
    const url = resolveBasemapUrl(7, { id: 3, url: 'https://p/{z}/{x}/{y}.png?api_key={api_key}' });
    expect(url).toBe('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}');
  });
});

describe('layerSpecFor', () => {
  const cat = buildCatalog(campaign);

  it('assembles a direct (unproxied) tile url for a keyless visualization', () => {
    const spec = layerSpecFor(cat, { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1000' });
    expect(spec).toMatchObject({
      kind: 'raster',
      url: 'https://tiler/1/{z}/{x}/{y}.png',
      auth: 'none',
    });
  });

  it('rewrites an {api_key} template to a proxy path', () => {
    const spec = layerSpecFor(cat, { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1001' });
    expect(spec.url).toBe('/api/7/imagery/slices/100/tiles/Needs%20Key/{z}/{x}/{y}');
    expect(spec.auth).toBe('cookie');
  });

  it('stamps legend overrides onto query params (continuous)', () => {
    const spec = layerSpecFor(
      cat,
      { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1000' },
      { colormap_name: 'magma', rescale: [0.2, 0.8] }
    );
    const params = new URLSearchParams(spec.url.slice(spec.url.indexOf('?') + 1));
    expect(params.get('colormap_name')).toBe('magma');
    expect(params.get('rescale')).toBe('0.2,0.8');
  });

  it('stamps legend overrides onto a proxied {api_key} url as well', () => {
    const spec = layerSpecFor(
      cat,
      { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1001' },
      { colormap_name: 'magma', rescale: [0, 1] }
    );
    expect(spec.url.startsWith('/api/7/imagery/slices/100/tiles/Needs%20Key/{z}/{x}/{y}?')).toBe(
      true
    );
    expect(spec.url).toContain('colormap_name=magma');
  });

  it('throws for an unknown source/collection/slice/visualization', () => {
    expect(() =>
      layerSpecFor(cat, { sourceId: 999, collectionId: 10, sliceIndex: 0, vizId: '1000' })
    ).toThrow();
    expect(() =>
      layerSpecFor(cat, { sourceId: 1, collectionId: 999, sliceIndex: 0, vizId: '1000' })
    ).toThrow();
    expect(() =>
      layerSpecFor(cat, { sourceId: 1, collectionId: 10, sliceIndex: 5, vizId: '1000' })
    ).toThrow();
    expect(() =>
      layerSpecFor(cat, { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '9999' })
    ).toThrow();
  });
});
