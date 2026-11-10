import { describe, it, expect, beforeEach, vi } from 'vitest';

// The cache imports getTimeseriesData from the api client; hoist a mock
// so we can count fetches and return per-id data without a backend.
const { getTimeseriesDataMock, getZonalTimeseriesDataMock } = vi.hoisted(() => ({
  getTimeseriesDataMock: vi.fn(),
  getZonalTimeseriesDataMock: vi.fn(),
}));
vi.mock('~/api/client', () => ({
  getTimeseriesData: getTimeseriesDataMock,
  getZonalTimeseriesData: getZonalTimeseriesDataMock,
}));

import { TimeSeriesCache } from './cache';

const POINT = { lat: 1.234567, lon: 2.345678 };

beforeEach(() => {
  getTimeseriesDataMock.mockReset();
  getZonalTimeseriesDataMock.mockReset().mockResolvedValue({
    data: { data: [{ time: '2020-01-01', values: 0.4, cloud: 0 }] },
  });
  // One row per series, keyed so we can tell which series' data came back.
  getTimeseriesDataMock.mockImplementation(({ path }) =>
    Promise.resolve({
      data: { data: [{ time: '2020-01-01', values: path.timeseries_id, cloud: 0 }] },
    })
  );
});

// A fixed clock (never advances) - cache expiry/eviction never see a real
// wall clock, keeping these deterministic regardless of how long the suite
// takes to run.
const newCache = () => new TimeSeriesCache(() => 0);

describe('TimeSeriesCache', () => {
  const polygon: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  };

  it('sends full polygon geometry and distinguishes shapes, points, and campaigns', async () => {
    const cache = newCache();
    const withHole: GeoJSON.Polygon = {
      ...polygon,
      coordinates: [
        ...polygon.coordinates,
        [
          [0.5, 0.5],
          [0.5, 1.5],
          [1.5, 1.5],
          [1.5, 0.5],
          [0.5, 0.5],
        ],
      ],
    };
    await Promise.all([
      cache.get(7, [1], polygon),
      cache.get(7, [1], structuredClone(polygon)),
      cache.get(7, [1], withHole),
      cache.get(7, [1], { lat: 1, lon: 1 }),
      cache.get(8, [1], polygon),
    ]);
    expect(getZonalTimeseriesDataMock).toHaveBeenCalledTimes(3);
    expect(getZonalTimeseriesDataMock).toHaveBeenCalledWith({
      path: { campaign_id: 7, timeseries_id: 1 },
      body: { geometry: withHole },
      throwOnError: true,
    });
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(1);
  });

  it('prefetches a multipolygon without substituting its centroid and retries failed requests', async () => {
    const cache = newCache();
    const geometry: GeoJSON.MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [polygon.coordinates],
    };
    getZonalTimeseriesDataMock.mockRejectedValueOnce(new Error('quota'));
    await expect(cache.get(7, [1], geometry)).rejects.toThrow('quota');
    cache.prefetch(7, [1], [geometry]);
    await cache.get(7, [1], geometry);
    expect(getZonalTimeseriesDataMock).toHaveBeenCalledTimes(2);
    expect(getTimeseriesDataMock).not.toHaveBeenCalled();
  });

  // The key includes the requested ids, so two windows fetching different series
  // at the same point each get their OWN series - they don't share (and clobber)
  // one coordinate entry, which used to leave non-first windows empty.
  it('two windows at one point each get their own series without colliding', async () => {
    const cache = newCache();
    const [a, b] = await Promise.all([
      cache.get(7, [1, 2], POINT), // window A
      cache.get(7, [3], POINT), // window B
    ]);

    expect(Object.keys(a!).map(Number).sort()).toEqual([1, 2]);
    expect(Object.keys(b!).map(Number)).toEqual([3]);
    expect(b![3][0].values).toBe(3); // B got series 3, not A's data
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(3); // 1, 2, 3 each once
  });

  it('dedupes concurrent identical requests into one fetch per series', async () => {
    const cache = newCache();
    await Promise.all([cache.get(7, [1, 2], POINT), cache.get(7, [1, 2], POINT)]);
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });

  it('serves a repeated point+series from cache without refetching', async () => {
    const cache = newCache();
    await cache.get(7, [1, 2], POINT);
    await cache.get(7, [1, 2], POINT);
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });

  it('returns null for no coordinate or no requested series', async () => {
    const cache = newCache();
    expect(await cache.get(7, [1, 2], null)).toBeNull();
    expect(await cache.get(7, [], POINT)).toBeNull();
    expect(getTimeseriesDataMock).not.toHaveBeenCalled();
  });

  it('refetches once a cached entry expires', async () => {
    let now = 0;
    const cache = new TimeSeriesCache(() => now);
    await cache.get(7, [1], POINT);
    now += 5 * 60 * 1000 + 1; // just past the 5-minute expiry window
    await cache.get(7, [1], POINT);
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });

  it('prefetch fetches uncached coordinates and skips already-cached ones', async () => {
    const cache = newCache();
    const other = { lat: 9, lon: 9 };
    await cache.get(7, [1], POINT);
    getTimeseriesDataMock.mockClear();

    cache.prefetch(7, [1], [POINT, other]);
    // Fire-and-forget: give the microtask queue a turn to run the fetches.
    await Promise.resolve();
    await Promise.resolve();

    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(1); // only `other`, POINT was cached
  });

  it('clear() empties the cache so the next get refetches', async () => {
    const cache = newCache();
    await cache.get(7, [1], POINT);
    cache.clear();
    await cache.get(7, [1], POINT);
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });
});
