import { describe, it, expect, vi } from 'vitest';
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
import { isProxiedTileUrl, resolveBasemapUrl } from '~/shared/imagery/tileUrls';
import { sliceRaster } from './tileUrls';

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

describe('tile url resolution', () => {
  it('recognises our own proxy routes, which need the tiler cookie', () => {
    expect(isProxiedTileUrl('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}')).toBe(true);
    expect(isProxiedTileUrl('/api/7/imagery/slices/9/tiles/True%20Color/{z}/{x}/{y}')).toBe(true);
    expect(isProxiedTileUrl('https://osm/{z}/{x}/{y}.png')).toBe(false);
  });

  it('sends proxied tiles to the configured API origin, not the page origin', () => {
    // In the dev stack the app is served on :5173 and the API on :8000, where a
    // root-relative path reaches the dev server and returns index.html.
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000');
    try {
      expect(resolveBasemapUrl(7, { id: 3, url: 'https://p/{z}/{x}/{y}?key={api_key}' })).toBe(
        'http://localhost:8000/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}'
      );
      expect(isProxiedTileUrl('http://localhost:8000/api/7/imagery/slices/9/tiles/V/{z}/{x}/{y}')) //
        .toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('routes a basemap through the proxy only when its template needs a key', () => {
    expect(resolveBasemapUrl(7, { id: 3, url: 'https://osm/{z}/{x}/{y}.png' })).toBe(
      'https://osm/{z}/{x}/{y}.png'
    );
    expect(resolveBasemapUrl(7, { id: 3, url: 'https://p/{z}/{x}/{y}?key={api_key}' })).toBe(
      '/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}'
    );
  });
});

describe('sliceRaster', () => {
  const cat = buildImageryCatalog(campaign);

  it('assembles a direct (unproxied) tile url for a keyless visualization', () => {
    const spec = sliceRaster(cat, { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1000' });
    expect(spec).toMatchObject({ url: 'https://tiler/1/{z}/{x}/{y}.png', auth: 'none' });
  });

  it('carries the source zoom cap so the map stops where the provider does', () => {
    const capped = buildImageryCatalog(
      makeCampaign({ imagery_sources: [{ ...source, max_native_zoom: 15 }] })
    );
    const address = { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1000' };

    expect(sliceRaster(capped, address).maxZoom).toBe(15);
    expect(sliceRaster(cat, address).maxZoom).toBeUndefined();
  });

  it('rewrites an {api_key} template to a proxy path', () => {
    const spec = sliceRaster(cat, { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1001' });
    expect(spec.url).toBe('/api/7/imagery/slices/100/tiles/Needs%20Key/{z}/{x}/{y}');
    expect(spec.auth).toBe('cookie');
  });

  it('stamps legend overrides onto query params (continuous)', () => {
    const spec = sliceRaster(
      cat,
      { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '1000' },
      { colormap_name: 'magma', rescale: [0.2, 0.8] }
    );
    const params = new URLSearchParams(spec.url.slice(spec.url.indexOf('?') + 1));
    expect(params.get('colormap_name')).toBe('magma');
    expect(params.get('rescale')).toBe('0.2,0.8');
  });

  it('stamps legend overrides onto a proxied {api_key} url as well', () => {
    const spec = sliceRaster(
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
      sliceRaster(cat, { sourceId: 999, collectionId: 10, sliceIndex: 0, vizId: '1000' })
    ).toThrow();
    expect(() =>
      sliceRaster(cat, { sourceId: 1, collectionId: 999, sliceIndex: 0, vizId: '1000' })
    ).toThrow();
    expect(() =>
      sliceRaster(cat, { sourceId: 1, collectionId: 10, sliceIndex: 5, vizId: '1000' })
    ).toThrow();
    expect(() =>
      sliceRaster(cat, { sourceId: 1, collectionId: 10, sliceIndex: 0, vizId: '9999' })
    ).toThrow();
  });
});
