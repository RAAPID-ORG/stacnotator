import { describe, expect, it } from 'vitest';

import {
  COLLECTION_PRESETS,
  decodeChannels,
  encodeChannels,
  presetVizParams,
} from './collectionPresets';
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

describe('preset visualization parameters', () => {
  it('retains band indexes and uses the same configuration for multiband presets and editing', () => {
    const preset = COLLECTION_PRESETS.planet_ethiopia_biweekly[0];
    const params = presetVizParams(preset, 'planet_ethiopia_biweekly', {
      assets: ['old'],
      assetAsBand: true,
      expression: 'old-old',
      colormapName: 'viridis',
      rescale: '-1,1',
      compositing: 'median',
    });
    expect(params).toMatchObject({
      assets: ['data'],
      bidx: [6, 4, 2],
      assetAsBand: false,
      rescale: '0,3000',
      compositing: 'median',
    });
    expect(params.expression).toBeUndefined();
    expect(params.colormapName).toBeUndefined();
    expect(params.bidx).not.toBe(preset.bidx);
  });

  it('preserves a zero nodata value when initializing optical imagery', () => {
    const params = presetVizParams(COLLECTION_PRESETS['sentinel-2-l2a'][1], 'sentinel-2-l2a');
    expect(params.nodata).toBe(0);
    expect(params.assets).toEqual(['B08', 'B04', 'B03']);
    expect(params.colorFormula).toBeTruthy();
  });
});

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

  it('preserves a single-band asset reused across RGB channels', () => {
    expect(
      roundTrip(
        [
          { asset: 'red', band: 1 },
          { asset: 'red', band: 1 },
          { asset: 'blue', band: 1 },
        ],
        { red: asset(), blue: asset() }
      )
    ).toEqual({
      assets: ['red', 'blue'],
      bidx: [1, 1, 2],
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
