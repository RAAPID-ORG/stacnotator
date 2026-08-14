import { describe, it, expect } from 'vitest';
import {
  collectSeriesLabels,
  formatDateForTooltip,
  parseSeriesDate,
  getOptimalMonthLabels,
  seriesAxis,
  setSliceMarker,
  sliceMarkerFor,
} from './chartData';
import type { TimeSeriesData } from './cache';

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

describe('formatDateForTooltip', () => {
  it('formats YYYYMMDD dates', () => {
    expect(formatDateForTooltip('20250115')).toBe('15 Jan 2025');
  });

  it('formats ISO dates', () => {
    expect(formatDateForTooltip('2025-01-15')).toBe('15 Jan 2025');
  });
});

describe('parseSeriesDate', () => {
  it('parses YYYYMMDD as UTC midnight', () => {
    expect(parseSeriesDate('20250115')).toBe(Date.UTC(2025, 0, 15));
  });

  it('parses ISO dates', () => {
    expect(parseSeriesDate('2025-01-15')).toBe(new Date('2025-01-15').getTime());
  });
});

describe('sliceMarkerFor', () => {
  const labels = ['20240101', '20240201', '20240301', '20240401'];

  it('spans every label inside the slice', () => {
    expect(sliceMarkerFor(labels, '2024-02-01', '2024-03-31')).toEqual({
      startIdx: 1,
      endIdx: 2,
    });
  });

  it('snaps to the nearest label when the slice covers none', () => {
    expect(sliceMarkerFor(labels, '2024-03-10', '2024-03-20')).toEqual({
      startIdx: 2,
      endIdx: 2,
    });
  });

  it('tracks the slice as it moves along the axis', () => {
    expect(sliceMarkerFor(labels, '2024-01-01', '2024-01-31')?.startIdx).toBe(0);
    expect(sliceMarkerFor(labels, '2024-04-01', '2024-04-30')?.startIdx).toBe(3);
  });

  it('returns nothing without a date range or labels', () => {
    expect(sliceMarkerFor(labels, null, '2024-01-31')).toBeNull();
    expect(sliceMarkerFor([], '2024-01-01', '2024-01-31')).toBeNull();
  });
});

describe('setSliceMarker', () => {
  it('repaints when the marker moves and stays quiet when it does not', () => {
    let renders = 0;
    const chart = {
      render: () => {
        renders += 1;
      },
    };

    setSliceMarker(chart, { startIdx: 1, endIdx: 2 });
    expect(renders).toBe(1);

    setSliceMarker(chart, { startIdx: 1, endIdx: 2 });
    expect(renders).toBe(1);

    setSliceMarker(chart, { startIdx: 3, endIdx: 3 });
    expect(renders).toBe(2);

    setSliceMarker(chart, null);
    expect(renders).toBe(3);
  });
});

describe('getOptimalMonthLabels', () => {
  it('returns nothing for no dates', () => {
    expect(getOptimalMonthLabels([])).toEqual([]);
  });

  it('labels every month for a short range', () => {
    const dates = ['20240101', '20240201', '20240301'];
    expect(getOptimalMonthLabels(dates).map((m) => m.label)).toEqual([
      "Jan '24",
      "Feb '24",
      "Mar '24",
    ]);
  });

  it('thins labels out and includes the last month for a long range', () => {
    // 12 monthly points spans 12 months -> interval 2 (see calculateLabelInterval)
    const dates = Array.from({ length: 12 }, (_, i) => {
      const month = String(i + 1).padStart(2, '0');
      return `2024${month}01`;
    });
    const labels = getOptimalMonthLabels(dates);
    expect(labels[0].label).toBe("Jan '24");
    // Every other month, starting from the first.
    expect(labels.every((m, i) => i === labels.length - 1 || m.index % 2 === 0)).toBe(true);
  });
});

describe('seriesAxis', () => {
  const index = (key: string, min: number, max: number, lines: number[] = []) => ({
    key,
    label: key,
    summary: '',
    good_for: '',
    caution: '',
    citation: '',
    domain_min: min,
    domain_max: max,
    reference_lines: lines,
  });

  it('uses the index domain rather than a fixed 0-1 axis', () => {
    expect(seriesAxis([index('GCVI', 0, 10, [2, 6])])).toEqual({
      min: 0,
      max: 10,
      referenceLines: [2, 6],
    });
  });

  it('spans every domain when one window mixes indices', () => {
    const axis = seriesAxis([index('NDVI', -0.2, 1), index('GCVI', 0, 10)]);
    expect([axis.min, axis.max]).toEqual([-0.2, 10]);
  });

  it('drops reference lines when the series do not share an index', () => {
    // A threshold that means "water" for MNDWI means nothing plotted against NDVI.
    expect(
      seriesAxis([index('MNDWI', -1, 1, [0]), index('NDVI', -0.2, 1, [0.25])]).referenceLines
    ).toEqual([]);
  });

  it('keeps the reference lines when several series plot the same index', () => {
    expect(
      seriesAxis([index('NDVI', -0.2, 1, [0.25]), index('NDVI', -0.2, 1, [0.25])]).referenceLines
    ).toEqual([0.25]);
  });

  it('falls back to the fixed axis when no index is recognised', () => {
    expect(seriesAxis([null, undefined])).toEqual({ min: 0, max: 1, referenceLines: [] });
  });
});
