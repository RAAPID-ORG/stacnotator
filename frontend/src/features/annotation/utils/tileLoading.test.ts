import { describe, it, expect } from 'vitest';
import { crossOriginFor, crossOriginForTile, isSelfHostedTiler } from './tileLoading';

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
  it('is credentialed for our backend key-proxy URLs', () => {
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
