import { describe, it, expect } from 'vitest';
import { collectSeriesLabels } from './chartUtils';
import type { TimeSeriesData } from './timeSeriesCache';

const row = (time: string) => ({ time, values: 0.5, cloud: 0 });

// The cache fetches every campaign series for a point, so `data` here holds
// series from multiple windows. A chart must build its x-axis from only the
// series it renders, otherwise two windows covering different years (2022 vs
// 2018) end up sharing one axis.
const data: TimeSeriesData = {
  81: [row('2022-01-01'), row('2022-06-01')], // "Time series" window
  83: [row('2020-01-01'), row('2021-01-01')], // "2018" window
};

describe('collectSeriesLabels', () => {
  it('spans only the requested series, not every fetched series', () => {
    expect(collectSeriesLabels([81], data)).toEqual(['2022-01-01', '2022-06-01']);
    expect(collectSeriesLabels([83], data)).toEqual(['2020-01-01', '2021-01-01']);
  });

  it('unions and sorts across the requested series and probe data', () => {
    const probe: TimeSeriesData = { 81: [row('2022-03-01')] };
    expect(collectSeriesLabels([81], data, probe)).toEqual([
      '2022-01-01',
      '2022-03-01',
      '2022-06-01',
    ]);
  });

  it('handles missing series and empty sources', () => {
    expect(collectSeriesLabels([999], data)).toEqual([]);
    expect(collectSeriesLabels([81], null, undefined)).toEqual([]);
  });
});
