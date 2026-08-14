import { describe, it, expect } from 'vitest';
import { DEFAULT_TIMESERIES_WINDOW_NAME, groupTimeseriesIntoWindows } from './timeseries';
import { makeTimeSeries } from '../testing/fixtures';

const DEFAULT_KEY = `timeseries:${DEFAULT_TIMESERIES_WINDOW_NAME}`;

const ts = (id: number, window_name?: string) =>
  makeTimeSeries({ id, name: `ts-${id}`, window_name });

describe('groupTimeseriesIntoWindows', () => {
  it('collapses unnamed series into a single default window', () => {
    const windows = groupTimeseriesIntoWindows([ts(1), ts(2, ''), ts(3, '   ')]);
    expect(windows).toHaveLength(1);
    expect(windows[0].key).toBe(DEFAULT_KEY);
    expect(windows[0].title).toBe(DEFAULT_TIMESERIES_WINDOW_NAME);
    expect(windows[0].series.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('groups named series and keys named windows with the prefix', () => {
    const windows = groupTimeseriesIntoWindows([
      ts(1, 'Vegetation'),
      ts(2, 'Water'),
      ts(3, 'Vegetation'),
    ]);
    expect(windows.map((w) => w.key)).toEqual(['timeseries:Vegetation', 'timeseries:Water']);
    expect(windows[0].series.map((s) => s.id)).toEqual([1, 3]);
    expect(windows[0].title).toBe('Vegetation');
  });

  it('preserves first-appearance order across a mix of windows', () => {
    const windows = groupTimeseriesIntoWindows([ts(1, 'Water'), ts(2), ts(3, 'Water'), ts(4)]);
    expect(windows.map((w) => w.key)).toEqual(['timeseries:Water', DEFAULT_KEY]);
  });

  it('returns nothing for no series', () => {
    expect(groupTimeseriesIntoWindows([])).toEqual([]);
  });
});
