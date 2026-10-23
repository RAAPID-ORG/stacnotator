import { describe, it, expect } from 'vitest';
import { groupTimeseriesIntoWindows } from './timeseries';
import { makeTimeSeries } from '../testing/fixtures';

const ts = (id: number, windowId: number, windowName: string) =>
  makeTimeSeries({ id, name: `ts-${id}`, window_id: windowId, window_name: windowName });

describe('groupTimeseriesIntoWindows', () => {
  it('groups series by their window and keys the window by its id', () => {
    const windows = groupTimeseriesIntoWindows([
      ts(1, 4, 'Vegetation'),
      ts(2, 5, 'Water'),
      ts(3, 4, 'Vegetation'),
    ]);
    expect(windows.map((w) => w.key)).toEqual(['timeseries:4', 'timeseries:5']);
    expect(windows[0].series.map((s) => s.id)).toEqual([1, 3]);
    expect(windows[0].title).toBe('Vegetation');
  });

  it('returns nothing for no series', () => {
    expect(groupTimeseriesIntoWindows([])).toEqual([]);
  });
});
