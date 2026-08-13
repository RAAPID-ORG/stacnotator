import { afterEach, describe, it, expect, vi } from 'vitest';
import type Tile from 'ol/Tile';
import {
  foregroundTileLoader,
  crossOriginFor,
  crossOriginForTile,
  ensureSessionFor,
  isProxiedTileUrl,
  isSelfHostedTiler,
  refreshTilerSession,
  setProxiedTileMatcher,
  setTilerTokenRefresher,
} from './loading';

/** The proxy route shape is the app's, so it is registered, not baked in. */
const PROXY_ROUTE = /\/imagery\/(?:basemaps|slices)\/[^/]+\/tiles\//;

afterEach(() => {
  setProxiedTileMatcher(() => false);
});

describe('isProxiedTileUrl', () => {
  it('recognises nothing until the app registers a matcher', () => {
    expect(isProxiedTileUrl('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}')).toBe(false);
  });

  it('uses the matcher the app registered', () => {
    setProxiedTileMatcher((url) => PROXY_ROUTE.test(url));
    expect(isProxiedTileUrl('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}')).toBe(true);
    expect(isProxiedTileUrl('https://osm/{z}/{x}/{y}.png')).toBe(false);
  });
});

describe('isSelfHostedTiler / crossOriginFor', () => {
  it('treats any provider that is not "mpc"/null as one of our tilers', () => {
    expect(isSelfHostedTiler('planet')).toBe(true);
    expect(isSelfHostedTiler('external')).toBe(true);
    expect(isSelfHostedTiler('mpc')).toBe(false);
    expect(isSelfHostedTiler(null)).toBe(false);
    expect(isSelfHostedTiler(undefined)).toBe(false);
  });

  it('uses credentialed crossOrigin only for our tilers', () => {
    expect(crossOriginFor('planet')).toBe('use-credentials');
    expect(crossOriginFor('mpc')).toBe('anonymous');
    expect(crossOriginFor(null)).toBe('anonymous');
    expect(crossOriginFor(undefined)).toBe('anonymous');
  });
});

describe('crossOriginForTile', () => {
  it('is credentialed for the backend key-proxy URLs the app registered', () => {
    setProxiedTileMatcher((url) => PROXY_ROUTE.test(url));
    const basemap = '/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}';
    const slice = '/api/7/imagery/slices/9/tiles/True%20Color/{z}/{x}/{y}';
    expect(crossOriginForTile(basemap, null)).toBe('use-credentials');
    expect(crossOriginForTile(slice, null)).toBe('use-credentials');
  });

  it('is credentialed for self-hosted tilers and anonymous for MPC/public', () => {
    expect(crossOriginForTile('https://tiler/searches/x/tiles/1/2/3.png', 'planet')).toBe(
      'use-credentials'
    );
    expect(crossOriginForTile('https://mpc/tiles/1/2/3', 'mpc')).toBe('anonymous');
    expect(crossOriginForTile('https://osm/1/2/3.png', null)).toBe('anonymous');
  });
});

describe('ensureSessionFor', () => {
  it('refreshes the tiler token only for credentialed sources', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    await ensureSessionFor('use-credentials', refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    await ensureSessionFor('anonymous', refresh);
    await ensureSessionFor(null, refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

function fakeTile(crossOrigin: string | null) {
  const image = { crossOrigin, src: '', fetchPriority: 'auto' };
  return { image, tile: { getImage: () => image } as unknown as Tile };
}

describe('foregroundTileLoader', () => {
  it('waits for a fresh token before loading a credentialed tile', async () => {
    let release = () => {};
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { image, tile } = fakeTile('use-credentials');

    foregroundTileLoader(refresh)(tile, 'https://tiler/1/2/3.png');
    expect(image.fetchPriority).toBe('high');
    expect(image.src).toBe('');

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(image.src).toBe('https://tiler/1/2/3.png');
  });

  it('loads anonymous tiles without refreshing the token', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { image, tile } = fakeTile('anonymous');

    foregroundTileLoader(refresh)(tile, 'https://osm/1/2/3.png');
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    expect(image.src).toBe('https://osm/1/2/3.png');
  });

  it('uses the refresher the app registered', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    setTilerTokenRefresher(refresh);
    const { image, tile } = fakeTile('use-credentials');

    foregroundTileLoader(refreshTilerSession)(tile, 'https://tiler/1/2/3.png');
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(image.src).toBe('https://tiler/1/2/3.png');
    setTilerTokenRefresher(() => Promise.resolve());
  });

  it('still loads the tile when the refresh fails', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('offline'));
    const { image, tile } = fakeTile('use-credentials');

    foregroundTileLoader(refresh)(tile, 'https://tiler/1/2/3.png');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(image.src).toBe('https://tiler/1/2/3.png');
  });
});
