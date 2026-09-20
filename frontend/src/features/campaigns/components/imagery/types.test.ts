import { describe, expect, it } from 'vitest';
import { DEFAULT_BASEMAPS } from './types';

describe('DEFAULT_BASEMAPS', () => {
  it('excludes the Carto layer that requires an API key', () => {
    expect(DEFAULT_BASEMAPS.map((basemap) => basemap.id)).toEqual([
      'esri-world-imagery',
      'opentopomap',
      'bing-aerial',
    ]);
  });
});
