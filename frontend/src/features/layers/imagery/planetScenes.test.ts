import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanetSceneWindowOut } from '~/api/client';
import { sourceToBackend } from './draftSync';
import { sceneCollections } from './PlanetSceneBrowser';
import { createId, emptySource } from './types';

afterEach(() => vi.restoreAllMocks());

const window = (overrides: Partial<PlanetSceneWindowOut> = {}): PlanetSceneWindowOut => ({
  start_date: '2024-01-01',
  end_date: '2024-01-31',
  cover: null,
  slices: [
    { start_date: '2024-01-05', end_date: '2024-01-05' },
    { start_date: '2024-01-20', end_date: '2024-01-20' },
  ],
  ...overrides,
});

const collectionsOf = (windows: PlanetSceneWindowOut[]) =>
  sceneCollections(windows, 'series-1', 'months', 'days');

describe('sceneCollections', () => {
  it.each([undefined, '386'])(
    'saves new Planet imagery without database IDs when the UUID starts with digits (source %s)',
    (sourceId) => {
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('76447183-1234-4234-8234-123456789abc');
      const source = emptySource();
      if (sourceId) source.id = sourceId;
      const seriesId = createId();
      source.visualizations = [{ name: 'Visual' }];
      source.generationSeries = [
        {
          id: seriesId,
          config: {
            kind: 'planet_scenes',
            start_date: '2024-01-01',
            end_date: '2024-01-31',
            collection_period_interval: 1,
            collection_period_unit: 'months',
            slice_period_interval: 1,
            slice_period_unit: 'days',
            whole_window_cover: false,
          },
        },
      ];
      source.collections = sceneCollections([window()], seriesId, 'months', 'days');

      const payload = sourceToBackend(source);

      expect(payload.id).toBe(sourceId ? Number(sourceId) : undefined);
      expect(payload.generation_series?.[0].id).toBeUndefined();
      expect(payload.collections[0].id).toBeUndefined();
      expect(payload.collections[0].slices.every((slice) => slice.id === undefined)).toBe(true);
      expect(payload.collections[0].generation_series_key).toBe(payload.generation_series?.[0].key);
    }
  );

  it('makes one collection per window, with a slice per period', () => {
    const [collection] = collectionsOf([window()]);

    expect(collection.name).toBe('Jan 2024');
    expect(collection.slices.map((s) => s.name)).toEqual(['Jan 5', 'Jan 20']);
    expect(collection.generationSeriesId).toBe('series-1');
  });

  it('puts a window cover first and marks it dedicated', () => {
    const [collection] = collectionsOf([
      window({ cover: { start_date: '2024-01-01', end_date: '2024-01-31' } }),
    ]);

    expect(collection.hasDedicatedCover).toBe(true);
    expect(collection.coverSliceIndex).toBe(0);
    expect(collection.slices[0].startDate).toBe('2024-01-01');
    expect(collection.slices).toHaveLength(3);
  });

  it('leaves the cover to the first slice when the window has none', () => {
    const [collection] = collectionsOf([window()]);

    expect(collection.hasDedicatedCover).toBe(false);
    expect(collection.coverSliceIndex).toBe(0);
  });

  it('leaves every slice without a tile URL, since registration mints those', () => {
    const [collection] = collectionsOf([window()]);

    expect(collection.slices.every((slice) => slice.vizUrls?.length === 0)).toBe(true);
  });
});
