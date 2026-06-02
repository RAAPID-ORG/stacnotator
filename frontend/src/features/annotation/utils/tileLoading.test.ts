import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { substituteApiKeys } from './tileLoading';

// ─── substituteApiKeys ───────────────────────────────────────────────────────

describe('substituteApiKeys', () => {
  it('substitutes {api_key} with the stored value', () => {
    const url =
      'https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key={api_key}';
    expect(substituteApiKeys(url, { api_key: 'PLtest123' })).toBe(
      'https://tiles.planet.com/basemaps/v1/planet-tiles/global_monthly_2024_01_mosaic/gmap/{z}/{x}/{y}.png?api_key=PLtest123'
    );
  });

  it('leaves OL tile coord placeholders untouched', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}';
    const result = substituteApiKeys(url, { api_key: 'abc' });
    expect(result).toContain('{z}');
    expect(result).toContain('{x}');
    expect(result).toContain('{y}');
    expect(result).toBe('https://tiles.example.com/{z}/{x}/{y}.png?api_key=abc');
  });

  it('leaves subdomain placeholder {a-c} untouched', () => {
    const url = 'https://{a-c}.tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}';
    const result = substituteApiKeys(url, { api_key: 'abc' });
    expect(result).toContain('{a-c}');
    expect(result).toBe('https://{a-c}.tiles.example.com/{z}/{x}/{y}.png?api_key=abc');
  });

  it('leaves Bing quadkey placeholder {q} untouched', () => {
    const url = 'https://tiles.example.com/a{q}.jpeg?g=1&key={api_key}';
    const result = substituteApiKeys(url, { api_key: 'abc' });
    expect(result).toContain('{q}');
    expect(result).toBe('https://tiles.example.com/a{q}.jpeg?g=1&key=abc');
  });

  it('leaves {api_key} in place when the key store is empty', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?api_key={api_key}';
    expect(substituteApiKeys(url, {})).toBe(url);
  });

  it('returns a URL with no placeholders unchanged regardless of key store', () => {
    const url = 'https://tiles.openstreetmap.org/{z}/{x}/{y}.png';
    expect(substituteApiKeys(url, { api_key: 'abc' })).toBe(url);
  });

  it('substitutes {api_key} when it appears multiple times', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?a={api_key}&b={api_key}';
    expect(substituteApiKeys(url, { api_key: 'VAL' })).toBe(
      'https://tiles.example.com/{z}/{x}/{y}.png?a=VAL&b=VAL'
    );
  });

  it('leaves an unrecognised placeholder in place when no matching key is stored', () => {
    const url = 'https://tiles.example.com/{z}/{x}/{y}.png?token={unknown}';
    expect(substituteApiKeys(url, {})).toBe(url);
  });
});

// ─── buildTileUrl + isSelfHostedUrl (require a non-empty TILER_BASE) ─────────
//
// TILER_BASE is a module-level constant evaluated at import time, so we must
// stub the env var, reset the module registry, and re-import dynamically to
// get a fresh evaluation.

describe('buildTileUrl', () => {
  let mod: typeof import('./tileLoading');

  beforeAll(async () => {
    vi.stubEnv('VITE_TILER_BASE_URL', 'https://tiler.example.com');
    vi.resetModules();
    mod = await import('./tileLoading');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('prepends the tiler base for self-hosted tiles', () => {
    expect(
      mod.buildTileUrl({
        tile_url: '/mosaic/abc123/tiles/15/1/1.png',
        tile_provider: 'self_hosted',
      })
    ).toBe('https://tiler.example.com/mosaic/abc123/tiles/15/1/1.png');
  });

  it('returns the tile URL unchanged for the mpc provider', () => {
    const url =
      'https://planetarycomputer.microsoft.com/api/data/v1/mosaic/abc/tiles/WebMercatorQuad/15/1/1';
    expect(mod.buildTileUrl({ tile_url: url, tile_provider: 'mpc' })).toBe(url);
  });

  it('returns the tile URL unchanged when provider is null', () => {
    const url = 'https://tiles.example.com/custom/15/1/1.png';
    expect(mod.buildTileUrl({ tile_url: url, tile_provider: null })).toBe(url);
  });

  it('returns the tile URL unchanged when provider is undefined', () => {
    const url = 'https://tiles.example.com/custom/15/1/1.png';
    expect(mod.buildTileUrl({ tile_url: url })).toBe(url);
  });
});

describe('isSelfHostedUrl', () => {
  let mod: typeof import('./tileLoading');

  beforeAll(async () => {
    vi.stubEnv('VITE_TILER_BASE_URL', 'https://tiler.example.com');
    vi.resetModules();
    mod = await import('./tileLoading');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('returns true for a URL that starts with the tiler base', () => {
    expect(mod.isSelfHostedUrl('https://tiler.example.com/mosaic/abc/tiles/15/1/1')).toBe(true);
  });

  it('returns false for a third-party URL', () => {
    expect(
      mod.isSelfHostedUrl('https://planetarycomputer.microsoft.com/api/data/v1/mosaic/abc')
    ).toBe(false);
  });

  it('returns false for a URL that contains but does not start with the tiler base', () => {
    expect(
      mod.isSelfHostedUrl('https://proxy.example.com?url=https://tiler.example.com/path')
    ).toBe(false);
  });

  it('returns false when TILER_BASE is empty', async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    const emptyMod = await import('./tileLoading');
    expect(emptyMod.isSelfHostedUrl('https://anywhere.example.com/tiles')).toBe(false);
  });
});
