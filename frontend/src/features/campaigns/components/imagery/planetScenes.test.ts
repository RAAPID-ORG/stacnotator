import { describe, expect, it } from 'vitest';
import type { PlanetSceneWindowOut } from '~/api/client';
import { sceneCollections } from './PlanetSceneBrowser';

const window = (overrides: Partial<PlanetSceneWindowOut> = {}): PlanetSceneWindowOut => ({
  name: '2024-01',
  start_date: '2024-01-01',
  end_date: '2024-01-31',
  cover: null,
  slices: [
    { name: '2024-01-05', start_date: '2024-01-05', end_date: '2024-01-05', scene_count: 2 },
    { name: '2024-01-20', start_date: '2024-01-20', end_date: '2024-01-20', scene_count: 1 },
  ],
  ...overrides,
});

describe('sceneCollections', () => {
  it('makes one collection per window, with a slice per period', () => {
    const [collection] = sceneCollections([window()], 'series-1');

    expect(collection.name).toBe('2024-01');
    expect(collection.slices.map((s) => s.name)).toEqual(['2024-01-05', '2024-01-20']);
    expect(collection.generationSeriesId).toBe('series-1');
  });

  it('puts a window cover first and marks it dedicated', () => {
    const [collection] = sceneCollections(
      [
        window({
          cover: {
            name: '2024-01',
            start_date: '2024-01-01',
            end_date: '2024-01-31',
            scene_count: 3,
          },
        }),
      ],
      'series-1'
    );

    expect(collection.hasDedicatedCover).toBe(true);
    expect(collection.coverSliceIndex).toBe(0);
    expect(collection.slices[0].startDate).toBe('2024-01-01');
    expect(collection.slices).toHaveLength(3);
  });

  it('leaves the cover to the first slice when the window has none', () => {
    const [collection] = sceneCollections([window()], 'series-1');

    expect(collection.hasDedicatedCover).toBe(false);
    expect(collection.coverSliceIndex).toBe(0);
  });

  it('leaves every slice without a tile URL, since registration mints those', () => {
    const [collection] = sceneCollections([window()], 'series-1');

    expect(collection.slices.every((slice) => slice.vizUrls?.length === 0)).toBe(true);
  });
});
