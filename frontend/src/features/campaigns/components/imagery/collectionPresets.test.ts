import { describe, expect, it } from 'vitest';

import { decodeChannels, encodeChannels } from './collectionPresets';
import type { AssetInfo, Channel } from './collectionPresets';

const asset = (...bands: string[]): AssetInfo => ({
  title: '',
  type: 'image/tiff',
  roles: ['data'],
  bands: bands.map((name) => ({ name })),
});

const roundTrip = (channels: Channel[], available: Record<string, AssetInfo>) => {
  const encoded = encodeChannels(channels, available);
  expect(decodeChannels(encoded.assets, encoded.bidx, available)).toEqual(channels);
  return encoded;
};

describe('channel encoding', () => {
  it('leaves bidx out when every channel is a whole single-band asset', () => {
    const available = { B04: asset(), B03: asset('green'), B02: asset() };
    const channels = ['B04', 'B03', 'B02'].map((a) => ({ asset: a, band: 1 }));
    expect(roundTrip(channels, available)).toEqual({ assets: ['B04', 'B03', 'B02'] });
  });

  it('skips the QA band each per-colour tif carries', () => {
    const available = { red: asset('r', 'qa'), green: asset('g', 'qa'), blue: asset('b', 'qa') };
    const channels = ['red', 'green', 'blue'].map((a) => ({ asset: a, band: 1 }));
    expect(roundTrip(channels, available)).toEqual({
      assets: ['red', 'green', 'blue'],
      bidx: [1, 3, 5],
    });
  });

  it('mixes bands of a multiband asset with a single-band asset', () => {
    const available = { reflectance: asset('B02', 'B03', 'B04', 'B08'), B01: asset() };
    const channels = [
      { asset: 'reflectance', band: 2 },
      { asset: 'reflectance', band: 1 },
      { asset: 'B01', band: 1 },
    ];
    expect(roundTrip(channels, available)).toEqual({
      assets: ['reflectance', 'B01'],
      bidx: [2, 1, 5],
    });
  });
});
