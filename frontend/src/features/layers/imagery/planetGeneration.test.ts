import { describe, it, expect } from 'vitest';
import type { PlanetMosaicOut } from '~/api/client';
import {
  defaultMosaicRange,
  generatePlanetCollections,
  sharedRenderings,
  usableMosaics,
} from './planetGeneration';
import type { PlanetGenerationOptions } from './planetGeneration';
import type { CollectionItem } from './types';

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

const collectionsOf = (
  mosaics: PlanetMosaicOut[],
  over: PlanetGenerationOptions
): CollectionItem[] => generatePlanetCollections(mosaics, over).collections;

describe('generatePlanetCollections', () => {
  it('groups a series into one collection per calendar period', () => {
    const collections = collectionsOf(
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
      collectionsOf(mosaics, options({ collectionPeriod: 'quarter' })).map((c) => c.name)
    ).toEqual(['2024 Q1', '2024 Q2']);
    expect(
      collectionsOf(mosaics, options({ collectionPeriod: 'month' })).map((c) => c.name)
    ).toEqual(['2024-01', '2024-02', '2024-04']);
  });

  it('puts the whole series in one collection named after it', () => {
    const collections = collectionsOf(
      months('2023-12', '2024-01'),
      options({ collectionPeriod: 'all' })
    );

    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Global Monthly');
    expect(collections[0].slices).toHaveLength(2);
  });

  it('takes slice dates from the mosaics rather than computing a cadence', () => {
    const [collection] = collectionsOf(months('2024-02'), options());

    expect(collection.slices[0]).toMatchObject({
      name: '2024-02',
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
  });

  it('builds one tile url per chosen rendering', () => {
    const [collection] = collectionsOf(months('2024-01'), options({ renderings: ['NDVI'] }));

    expect(collection.slices[0].vizUrls).toEqual([
      { vizName: 'NDVI', url: expect.stringContaining('proc=ndvi') },
    ]);
  });

  it('places the cover at the nth slice of each collection', () => {
    const collections = collectionsOf(
      months('2024-01', '2024-02', '2024-03'),
      options({ collectionPeriod: 'year', coverNth: 2 })
    );

    expect(collections[0].coverSliceIndex).toBe(1);
    expect(collections[0].hasDedicatedCover).toBe(false);
  });

  it('never points the cover past the slices a short period has', () => {
    const collections = collectionsOf(
      months('2024-01'),
      options({ collectionPeriod: 'year', coverNth: 6 })
    );

    expect(collections[0].coverSliceIndex).toBe(0);
  });

  it('keeps only mosaics whose start date is inside the requested range', () => {
    const collections = collectionsOf(
      months('2023-06', '2024-01', '2024-06'),
      options({ startDate: '2024-01-01', endDate: '2024-03-31', collectionPeriod: 'all' })
    );

    expect(collections[0].slices.map((s) => s.name)).toEqual(['2024-01']);
  });

  it('skips mosaics Planet cannot serve tiles for', () => {
    const broken = monthly('2024-02', { tile_urls: {}, unavailable_reason: 'no tile link' });
    const collections = collectionsOf(
      [monthly('2024-01'), broken],
      options({ collectionPeriod: 'all' })
    );

    expect(collections[0].slices.map((s) => s.name)).toEqual(['2024-01']);
    expect(usableMosaics([broken])).toEqual([]);
  });

  it('produces manual collections, because Planet needs no tiler', () => {
    const [collection] = collectionsOf(months('2024-01'), options());

    expect(collection.data.type).toBe('manual');
  });
});

describe('defaultMosaicRange', () => {
  it('caps a long-running series at its newest year', () => {
    expect(defaultMosaicRange(months('2016-01', '2020-07', '2026-03'))).toEqual({
      startDate: '2025-03-01',
      endDate: '2026-03-01',
    });
  });

  it('keeps the whole span when the series is shorter than a year', () => {
    expect(defaultMosaicRange(months('2025-11', '2026-01'))).toEqual({
      startDate: '2025-11-01',
      endDate: '2026-01-01',
    });
  });

  it('reads the bounds off the mosaics rather than their listing order', () => {
    const unordered = [monthly('2026-03'), monthly('2016-01'), monthly('2020-07')];

    expect(defaultMosaicRange(unordered)).toEqual({
      startDate: '2025-03-01',
      endDate: '2026-03-01',
    });
  });

  it('ignores mosaics Planet cannot serve tiles for', () => {
    const broken = monthly('2026-08', { tile_urls: {}, unavailable_reason: 'no tile link' });

    expect(defaultMosaicRange([monthly('2026-01'), broken])).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-01-01',
    });
  });

  it('has no range to propose for a series with nothing usable', () => {
    expect(defaultMosaicRange([])).toEqual({ startDate: '', endDate: '' });
  });
});

// A coarser series standing in as the cover: each of its mosaics is one window,
// and the finer series' mosaics inside its span are that window's slices.
describe('generatePlanetCollections with a cover series', () => {
  const quarter = (start: string, end: string): PlanetMosaicOut => ({
    id: `q-${start}`,
    name: `global_quarterly_${start}_mosaic`,
    first_acquired: start,
    last_acquired: end,
    tile_urls: { Visual: `https://tiles.planet.com/q/${start}/{z}/{x}/{y}.png?proc=rgb` },
  });

  const withCover = (
    coverMosaics: PlanetMosaicOut[],
    over: Partial<PlanetGenerationOptions> = {}
  ) => options({ renderings: ['Visual'], coverMosaics, ...over });

  it('makes one window per cover mosaic, with the coarse product as its cover slice', () => {
    const { collections } = generatePlanetCollections(
      months('2024-01', '2024-02', '2024-03'),
      withCover([quarter('2024-01-01', '2024-03-31')])
    );

    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('2024-01 → 2024-03');
    expect(collections[0].hasDedicatedCover).toBe(true);
    expect(collections[0].coverSliceIndex).toBe(0);
    expect(collections[0].slices.map((s) => s.name)).toEqual([
      '2024-01 → 2024-03',
      '2024-01',
      '2024-02',
      '2024-03',
    ]);
  });

  it('puts each fine mosaic in the window whose span contains its start', () => {
    const { collections } = generatePlanetCollections(
      months('2024-02', '2024-05'),
      withCover([quarter('2024-01-01', '2024-03-31'), quarter('2024-04-01', '2024-06-30')])
    );

    expect(collections.map((c) => c.slices.slice(1).map((s) => s.name))).toEqual([
      ['2024-02'],
      ['2024-05'],
    ]);
  });

  it('names a window after the calendar unit it spans exactly', () => {
    const spans = [
      quarter('2024-01-01', '2024-01-31'),
      quarter('2024-01-01', '2024-12-31'),
      quarter('2024-01-15', '2024-01-28'),
    ];
    const { collections } = generatePlanetCollections([], withCover(spans));

    expect(collections.map((c) => c.name)).toEqual(['2024-01', '2024', '2024-01-15 → 2024-01-28']);
  });

  it('keeps a cover window that has no finer mosaic inside it', () => {
    const { collections } = generatePlanetCollections(
      months('2024-01'),
      withCover([quarter('2024-01-01', '2024-03-31'), quarter('2024-04-01', '2024-06-30')])
    );

    expect(collections).toHaveLength(2);
    expect(collections[1].slices.map((s) => s.name)).toEqual(['2024-04 → 2024-06']);
  });

  it('reports fine mosaics no cover window contains rather than dropping them', () => {
    const { collections, orphans } = generatePlanetCollections(
      months('2024-02', '2024-05'),
      withCover([quarter('2024-01-01', '2024-03-31')])
    );

    expect(collections[0].slices.map((s) => s.name)).toEqual(['2024-01 → 2024-03', '2024-02']);
    expect(orphans.map((m) => m.first_acquired)).toEqual(['2024-05-01']);
  });

  it('keeps a cover mosaic that only overlaps the requested range', () => {
    // The range starts mid-quarter: dropping the quarter would orphan the very
    // mosaics it covers.
    const { collections, orphans } = generatePlanetCollections(
      months('2024-02', '2024-03'),
      withCover([quarter('2024-01-01', '2024-03-31')], {
        startDate: '2024-02-01',
        endDate: '2024-03-31',
      })
    );

    expect(collections).toHaveLength(1);
    expect(orphans).toEqual([]);
  });

  it('skips cover mosaics Planet cannot serve tiles for', () => {
    const broken = { ...quarter('2024-01-01', '2024-03-31'), unavailable_reason: 'no tile link' };
    const { collections, orphans } = generatePlanetCollections(
      months('2024-02'),
      withCover([broken])
    );

    expect(collections).toEqual([]);
    expect(orphans).toHaveLength(1);
  });

  it('never leaves the cover without tiles: only shared renderings are offered', () => {
    expect(sharedRenderings(['Visual', 'NDVI'], ['Visual'])).toEqual(['Visual']);
    expect(sharedRenderings(['Visual'], ['Visual', 'NDVI'])).toEqual(['Visual']);
  });
});
