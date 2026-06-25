import { describe, it, expect } from 'vitest';
import {
  isProxiedTileUrl,
  needsKeyProxy,
  resolveBasemapUrl,
  resolveSliceTileUrl,
} from './proxyTile';

describe('needsKeyProxy', () => {
  it('is true only when an {api_key} placeholder remains', () => {
    expect(needsKeyProxy('https://p/{z}/{x}/{y}.png?api_key={api_key}')).toBe(true);
    expect(needsKeyProxy('https://osm/{z}/{x}/{y}.png')).toBe(false);
  });
});

describe('resolveBasemapUrl', () => {
  it('routes {api_key} basemaps through the proxy, preserving z/x/y', () => {
    const url = resolveBasemapUrl(7, { id: 3, url: 'https://p/{z}/{x}/{y}.png?api_key={api_key}' });
    expect(url).toBe('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}');
    expect(isProxiedTileUrl(url)).toBe(true);
  });

  it('leaves keyless basemaps as a direct URL', () => {
    const direct = 'https://osm/{z}/{x}/{y}.png';
    expect(resolveBasemapUrl(7, { id: 3, url: direct })).toBe(direct);
  });
});

describe('resolveSliceTileUrl', () => {
  it('routes {api_key} slice tiles through the proxy with an encoded viz name', () => {
    const url = resolveSliceTileUrl(7, 9, {
      tile_url: 'https://p/{z}/{x}/{y}.png?api_key={api_key}',
      visualization_name: 'True Color',
    });
    expect(url).toBe('/api/7/imagery/slices/9/tiles/True%20Color/{z}/{x}/{y}');
  });

  it('leaves keyless (tiler/MPC) slice tiles untouched', () => {
    const direct = 'https://tiler/searches/abc/tiles/WebMercatorQuad/{z}/{x}/{y}.png';
    expect(resolveSliceTileUrl(7, 9, { tile_url: direct, visualization_name: 'NDVI' })).toBe(
      direct
    );
  });
});
