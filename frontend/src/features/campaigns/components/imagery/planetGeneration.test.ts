import { describe, it, expect } from 'vitest';
import type { PlanetMosaicOut } from '~/api/client';
import { generatePlanetCollections, usableMosaics } from './planetGeneration';
import type { PlanetGenerationOptions } from './planetGeneration';

const monthly = (month: string, overrides: Partial<PlanetMosaicOut> = {}): PlanetMosaicOut => {
  const [year, mm] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return {
    id: `id-${month}`,
    name: `global_monthly_${month}_mosaic`,
    first_acquired: `${month}-01`,
    last_acquired: `${month}-${String(lastDay).padStart(2, '0')}`,
    tile_urls: {
      Visual: `https://tiles.planet.com/${month}/{z}/{x}/{y}.png?api_key={api_key}&proc=rgb`,
      NDVI: `https://tiles.planet.com/${month}/{z}/{x}/{y}.png?api_key={api_key}&proc=ndvi`,
    },
    ...overrides,
  };
};

const options = (over: Partial<PlanetGenerationOptions> = {}): PlanetGenerationOptions => ({
  seriesName: 'Global Monthly',
  startDate: '2000-01-01',
  endDate: '2100-01-01',
  collectionPeriod: 'year',
  coverNth: 1,
  renderings: ['Visual', 'NDVI'],
  ...over,
});

const months = (...names: string[]) => names.map((m) => monthly(m));

describe('generatePlanetCollections', () => {
  it('groups a series into one collection per calendar period', () => {
    const collections = generatePlanetCollections(
      months('2023-11', '2023-12', '2024-01'),
      options({ collectionPeriod: 'year' })
    );

    expect(collections.map((c) => c.name)).toEqual(['2023', '2024']);
    expect(collections[0].slices).toHaveLength(2);
    expect(collections[1].slices).toHaveLength(1);
  });

  it('groups by quarter and by month too', () => {
    const mosaics = months('2024-01', '2024-02', '2024-04');

    expect(
      generatePlanetCollections(mosaics, options({ collectionPeriod: 'quarter' })).map(
        (c) => c.name
      )
    ).toEqual(['2024 Q1', '2024 Q2']);
    expect(
      generatePlanetCollections(mosaics, options({ collectionPeriod: 'month' })).map((c) => c.name)
    ).toEqual(['2024-01', '2024-02', '2024-04']);
  });

  it('puts the whole series in one collection named after it', () => {
    const collections = generatePlanetCollections(
      months('2023-12', '2024-01'),
      options({ collectionPeriod: 'all' })
    );

    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Global Monthly');
    expect(collections[0].slices).toHaveLength(2);
  });

  it('takes slice dates from the mosaics rather than computing a cadence', () => {
    const [collection] = generatePlanetCollections(months('2024-02'), options());

    expect(collection.slices[0]).toMatchObject({
      name: '2024-02',
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });

  it('builds one tile url per chosen rendering', () => {
    const [collection] = generatePlanetCollections(
      months('2024-01'),
      options({ renderings: ['NDVI'] })
    );

    expect(collection.slices[0].vizUrls).toEqual([
      { vizName: 'NDVI', url: expect.stringContaining('proc=ndvi') },
    ]);
  });

  it('places the cover at the nth slice of each collection', () => {
    const collections = generatePlanetCollections(
      months('2024-01', '2024-02', '2024-03'),
      options({ collectionPeriod: 'year', coverNth: 2 })
    );

    expect(collections[0].coverSliceIndex).toBe(1);
    expect(collections[0].hasDedicatedCover).toBe(false);
  });

  it('never points the cover past the slices a short period has', () => {
    const collections = generatePlanetCollections(
      months('2024-01'),
      options({ collectionPeriod: 'year', coverNth: 6 })
    );

    expect(collections[0].coverSliceIndex).toBe(0);
  });

  it('keeps only mosaics whose start date is inside the requested range', () => {
    const collections = generatePlanetCollections(
      months('2023-06', '2024-01', '2024-06'),
      options({ startDate: '2024-01-01', endDate: '2024-03-31', collectionPeriod: 'all' })
    );

    expect(collections[0].slices.map((s) => s.name)).toEqual(['2024-01']);
  });

  it('skips mosaics Planet cannot serve tiles for', () => {
    const broken = monthly('2024-02', { tile_urls: {}, unavailable_reason: 'no tile link' });
    const collections = generatePlanetCollections(
      [monthly('2024-01'), broken],
      options({ collectionPeriod: 'all' })
    );

    expect(collections[0].slices.map((s) => s.name)).toEqual(['2024-01']);
    expect(usableMosaics([broken])).toEqual([]);
  });

  it('produces manual collections, because Planet needs no tiler', () => {
    const [collection] = generatePlanetCollections(months('2024-01'), options());

    expect(collection.data.type).toBe('manual');
  });
});
