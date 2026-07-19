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
  // The key includes the requested ids, so two windows fetching different series
  // at the same point each get their OWN series - they don't share (and clobber)
  // one coordinate entry, which used to leave non-first windows empty.
  it('two windows at one point each get their own series without colliding', async () => {
    const [a, b] = await Promise.all([
      timeSeriesCache.get([1, 2], POINT), // window A
      timeSeriesCache.get([3], POINT), // window B
    ]);

    expect(Object.keys(a!).map(Number).sort()).toEqual([1, 2]);
    expect(Object.keys(b!).map(Number)).toEqual([3]);
    expect(b![3][0].values).toBe(3); // B got series 3, not A's data
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(3); // 1, 2, 3 each once
  });

  it('dedupes concurrent identical requests into one fetch per series', async () => {
    await Promise.all([timeSeriesCache.get([1, 2], POINT), timeSeriesCache.get([1, 2], POINT)]);
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });

  it('serves a repeated point+series from cache without refetching', async () => {
    await timeSeriesCache.get([1, 2], POINT);
    await timeSeriesCache.get([1, 2], POINT);
    expect(getTimeseriesDataMock).toHaveBeenCalledTimes(2);
  });
});
