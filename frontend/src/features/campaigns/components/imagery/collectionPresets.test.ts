import { describe, it, expect } from 'vitest';
import { sentinel2TrueColorOverride, SENTINEL2_TRUECOLOR_PRE_OFFSET } from './collectionPresets';

describe('sentinel2TrueColorOverride', () => {
  it('applies the pre-offset stretch to Sentinel-2 collections before Feb 2022', () => {
    expect(sentinel2TrueColorOverride('sentinel-2-l2a', '2022-01-01')).toEqual(
      SENTINEL2_TRUECOLOR_PRE_OFFSET
    );
    expect(sentinel2TrueColorOverride('sentinel-2-l2a', '2019-06-01')).toEqual(
      SENTINEL2_TRUECOLOR_PRE_OFFSET
    );
  });

  it('keeps the current default from Feb 2022 onward', () => {
    expect(sentinel2TrueColorOverride('sentinel-2-l2a', '2022-02-01')).toBeNull();
    expect(sentinel2TrueColorOverride('sentinel-2-l2a', '2023-05-01')).toBeNull();
  });

  it('never applies to other collections', () => {
    expect(sentinel2TrueColorOverride('naip', '2019-01-01')).toBeNull();
    expect(sentinel2TrueColorOverride('landsat-c2-l2', '2015-01-01')).toBeNull();
  });
});
