import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  elapsedTimeTicks,
  prepareObservations,
  seriesDataset,
  seriesPoints,
} from './chartSeries';
import { seriesAxes } from './chartData';

const axis = seriesAxes([
  {
    key: 'REP',
    label: 'REP',
    formula: '',
    domain_min: 680,
    domain_max: 760,
    reference_lines: [],
  },
])[0];
const row = (time: string, values: number, cloud = 0) => ({ time, values, cloud });

describe('chart observations', () => {
  it('preserves duplicate timestamps, within-day times, original precision and source row identity', () => {
    const rows = [
      row('2021-06-02T10:00:00Z', 730),
      row('2021-06-01T10:00:00Z', 720.123456789),
      row('2021-06-01T10:00:00Z', 740),
      row('2021-06-01T11:00:00Z', 735, 1),
    ];
    const prepared = prepareObservations(rows, true);
    expect(prepared.map((r) => r.sourceRow)).toEqual([2, 3, 4, 1]);
    expect(prepared[0].values).toBe(720.123456789);
    expect(prepared[2].time).toBe(rows[3].time);
    expect(seriesPoints(prepared).map((p) => p.observation.sourceRow)).toEqual([2, 3, 1]);
    expect(rows.map((r) => r.values)).toEqual([730, 720.123456789, 740, 735]);
  });

  it('smooths by retained observation order regardless of time gaps or duplicate timestamps', () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((day) => row(`2021-06-0${day}`, 700)),
      row('2021-06-12', 750, 1),
      row('2021-06-19', 750, 1),
      ...[1, 2, 3, 4, 5].map((day) => row(`2021-07-0${day}`, 740)),
      row('2021-07-05', 710),
    ];
    const prepared = prepareObservations(rows, true, { window: 5, order: 2 });
    const denseRows = rows.map((r, i) => ({
      ...r,
      time: new Date(Date.UTC(2021, 5, i + 1)).toISOString(),
    }));
    const dense = prepareObservations(denseRows, true, { window: 5, order: 2 });
    expect(prepared.map((r) => r.smoothed)).toEqual(dense.map((r) => r.smoothed));
    expect(prepared[4].smoothed).toBeGreaterThan(700);
    expect(prepared.slice(5, 7).map((r) => r.smoothed)).toEqual([null, null]);
  });

  it('retains unclamped values without special markers and respects smoothing', () => {
    const observations = prepareObservations([row('20210601', 1100), row('20210602', 500)], false);
    expect(seriesPoints(observations).map((p) => p.y)).toEqual([1100, 500]);
    observations[0].smoothed = 730;
    const dataset = seriesDataset(observations, axis, '#2563eb', 0);
    expect(dataset.data.map((p) => [p.y, p.observation.values])).toEqual([
      [730, 1100],
      [500, 500],
    ]);
    expect(dataset.pointStyle).toBe('circle');
    expect(dataset.pointRadius).toBe(0);
    expect(dataset.segment).toBeUndefined();
  });

  it('uses equal whole-day tick steps across irregular dates and adjusts after zooming', () => {
    const min = Date.parse('2021-06-01T10:00:00Z');
    const max = Date.parse('2021-07-31T10:00:00Z');
    const ticks = elapsedTimeTicks(min, max);
    expect(ticks.length).toBeGreaterThan(3);
    expect(ticks.every((value) => value >= min && value <= max && value % DAY_MS === 0)).toBe(true);
    expect(ticks.slice(1).map((value, i) => value - ticks[i])).toEqual(
      Array(ticks.length - 1).fill(14 * DAY_MS)
    );
    const zoomed = elapsedTimeTicks(min, min + DAY_MS);
    expect(zoomed.slice(1).map((value, i) => value - zoomed[i])).toEqual(
      Array(zoomed.length - 1).fill(DAY_MS / 4)
    );
  });

  it('rejects invalid observations rather than silently dropping them', () => {
    expect(() => prepareObservations([row('not-a-date', 720)], false)).toThrow('source row 1');
    expect(() => prepareObservations([row('20210601', NaN)], false)).toThrow('source row 1');
  });
});
