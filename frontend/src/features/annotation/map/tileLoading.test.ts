import { describe, it, expect, vi } from 'vitest';
import type Tile from 'ol/Tile';

vi.mock('~/api/tilerToken', () => ({ ensureTilerSession: vi.fn() }));

import { ensureTilerSession } from '~/api/tilerToken';
import {
  crossOriginForTile,
  ensureSessionFor,
  foregroundTileLoader,
  isSelfHostedTiler,
} from './tileLoading';

describe('isSelfHostedTiler', () => {
  it('treats any provider that is not "mpc"/null as one of our tilers', () => {
    expect(isSelfHostedTiler('planet')).toBe(true);
    expect(isSelfHostedTiler('external')).toBe(true);
    expect(isSelfHostedTiler('mpc')).toBe(false);
    expect(isSelfHostedTiler(null)).toBe(false);
    expect(isSelfHostedTiler(undefined)).toBe(false);
  });
});

describe('crossOriginForTile', () => {
  it('is credentialed for the backend key-proxy routes', () => {
    expect(crossOriginForTile('/api/7/imagery/basemaps/3/tiles/{z}/{x}/{y}', null)).toBe(
      'use-credentials'
    );
    expect(crossOriginForTile('/api/7/imagery/slices/9/tiles/True%20Color/{z}/{x}/{y}', null)).toBe(
      'use-credentials'
    );
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
  it('refreshes the tiler cookie only for credentialed sources', async () => {
    vi.mocked(ensureTilerSession).mockClear().mockResolvedValue(undefined);

    await ensureSessionFor('use-credentials');
    expect(ensureTilerSession).toHaveBeenCalledTimes(1);

    await ensureSessionFor('anonymous');
    await ensureSessionFor(null);
    expect(ensureTilerSession).toHaveBeenCalledTimes(1);
  });
});

function fakeTile(crossOrigin: string | null) {
  const image = { crossOrigin, src: '', fetchPriority: 'auto' };
  return { image, tile: { getImage: () => image } as unknown as Tile };
}

describe('foregroundTileLoader', () => {
  it('waits for a fresh cookie before loading a credentialed tile', async () => {
    let release = () => {};
    vi.mocked(ensureTilerSession)
      .mockClear()
      .mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const { image, tile } = fakeTile('use-credentials');

    foregroundTileLoader(tile, 'https://tiler/1/2/3.png');
    expect(image.fetchPriority).toBe('high');
    expect(image.src).toBe('');

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(image.src).toBe('https://tiler/1/2/3.png');
  });

  it('loads anonymous tiles without touching the cookie', async () => {
    vi.mocked(ensureTilerSession).mockClear().mockResolvedValue(undefined);
    const { image, tile } = fakeTile('anonymous');

    foregroundTileLoader(tile, 'https://osm/1/2/3.png');
    await Promise.resolve();
    await Promise.resolve();

    expect(ensureTilerSession).not.toHaveBeenCalled();
    expect(image.src).toBe('https://osm/1/2/3.png');
  });

  it('still loads the tile when the refresh fails', async () => {
    vi.mocked(ensureTilerSession).mockClear().mockRejectedValue(new Error('offline'));
    const { image, tile } = fakeTile('use-credentials');

    foregroundTileLoader(tile, 'https://tiler/1/2/3.png');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(image.src).toBe('https://tiler/1/2/3.png');
  });
});
