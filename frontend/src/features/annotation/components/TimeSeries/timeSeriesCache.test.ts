import { describe, it, expect, beforeEach, vi } from 'vitest';

// The cache imports getTimeseriesData from the generated client; hoist a mock so
// we can count fetches and return per-id data without a backend.
const { getTimeseriesDataMock } = vi.hoisted(() => ({ getTimeseriesDataMock: vi.fn() }));
vi.mock('~/api/client', () => ({ getTimeseriesData: getTimeseriesDataMock }));

import { timeSeriesCache } from './timeSeriesCache';

const POINT = { lat: 1.234567, lon: 2.345678 };

beforeEach(() => {
  timeSeriesCache.clear();
  getTimeseriesDataMock.mockReset();
  // One row per series, keyed so we can tell which series' data came back.
  getTimeseriesDataMock.mockImplementation(({ path }) =>
    Promise.resolve({
      data: { data: [{ time: '2020-01-01', values: path.timeseries_id, cloud: 0 }] },
    })
  );
});

describe('timeSeriesCache', () => {
  // The regression: per-window charts used to each fetch only their own window's
  // ids, but the cache dedups by coordinate, so non-first windows got the first
  // window's data and rendered empty. The fix has every chart request the full
  // set - this locks in that both then receive every series with one fetch each.
  it('two charts at the same point requesting the full set both get every series, one fetch per series', async () => {
    const allIds = [1, 2, 3];

    const [a, b] = await Promise.all([
      timeSeriesCache.get(allIds, POINT),
      timeSeriesCache.get(allIds, POINT),
    ]);

    expect(Object.keys(a!).map(Number).sort()).toEqual([1, 2, 3]);
    expect(Object.keys(b!).map(Number).sort()).toEqual([1, 2, 3]);
    // Deduped across the two callers: three series -> three fetches, not six.
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(3);
    // Each series carries its own data (not another series' rows).
    expect(a![2][0].values).toBe(2);
  });

  it('serves a repeated point from cache without refetching', async () => {
    await timeSeriesCache.get([1, 2], POINT);
    await timeSeriesCache.get([1, 2], POINT);

    // 2 series fetched once each on the first call; the second call is a cache hit.
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });
});
