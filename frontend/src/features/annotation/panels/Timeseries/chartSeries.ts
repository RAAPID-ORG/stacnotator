import type { ChartDataset, ScaleOptions } from 'chart.js';
import i18n from '~/shared/i18n';
import type { TimeSeriesRow } from './cache';
import { parseSeriesDate, type ChartAxis } from './chartData';
import { savitzkyGolay } from './smoothing';

export const DAY_MS = 86_400_000;

export interface SeriesObservation extends TimeSeriesRow {
  x: number;
  sourceRow: number;
  filtered: boolean;
  smoothed: number | null;
}

export interface SeriesPoint {
  x: number;
  y: number;
  observation: SeriesObservation;
  overflow: number;
}

export function prepareObservations(
  rows: TimeSeriesRow[],
  removeCloudy: boolean,
  smoothing?: { window: number; order: number }
): SeriesObservation[] {
  const observations = rows
    .map((row, i) => {
      const x = parseSeriesDate(row.time);
      if (!Number.isFinite(x) || !Number.isFinite(row.values)) {
        throw new Error(`Invalid time-series observation at source row ${i + 1}`);
      }
      return {
        ...row,
        x,
        sourceRow: i + 1,
        filtered: removeCloudy && row.cloud === 1,
        smoothed: null as number | null,
      };
    })
    .sort((a, b) => a.x - b.x);
  if (!smoothing) return observations;

  const visible = observations.filter((row) => !row.filtered);
  const smoothed = savitzkyGolay(
    visible.map((row) => row.values),
    smoothing.window,
    smoothing.order
  );
  visible.forEach((row, i) => {
    row.smoothed = smoothed[i];
  });
  return observations;
}

export function seriesPoints(observations: SeriesObservation[], axis: ChartAxis): SeriesPoint[] {
  return observations
    .filter((row) => !row.filtered)
    .map((observation) => {
      const shown = observation.smoothed ?? observation.values;
      const rawOutside = observation.values < axis.min || observation.values > axis.max;
      const value = rawOutside ? observation.values : shown;
      const overflow = value < axis.min ? -1 : value > axis.max ? 1 : 0;
      return {
        x: observation.x,
        y: Math.max(axis.min, Math.min(axis.max, value)),
        observation,
        overflow,
      };
    });
}

export function seriesDataset(
  observations: SeriesObservation[],
  axis: ChartAxis,
  color: string,
  dotRadius: number
): ChartDataset<'line', SeriesPoint[]> {
  const data = seriesPoints(observations, axis);
  const colors = data.map(({ observation }) =>
    observation.cloud === 1 ? 'rgb(162, 159, 155)' : color
  );
  return {
    data,
    yAxisID: axis.id,
    borderColor: color,
    backgroundColor: color,
    pointBackgroundColor: colors,
    pointBorderColor: colors,
    pointRadius: data.map((point) => (point.overflow ? 4 : dotRadius)),
    pointStyle: data.map((point) => (point.overflow ? 'triangle' : 'circle')),
    pointRotation: data.map((point) => (point.overflow < 0 ? 180 : 0)),
    spanGaps: true,
    clip: 8,
    tension: 0,
    segment: {
      borderColor: ({ p0DataIndex, p1DataIndex }) => {
        const from = data[p0DataIndex];
        const to = data[p1DataIndex];
        return from.overflow || to.overflow ? 'transparent' : color;
      },
    },
  };
}

export function elapsedTimeScale(times: number[]): ScaleOptions<'linear'> {
  const min = times.length ? Math.min(...times) : undefined;
  const max = times.length ? Math.max(...times) : undefined;
  return {
    type: 'linear',
    min: min === max && min !== undefined ? min - DAY_MS / 2 : min,
    max: min === max && max !== undefined ? max + DAY_MS / 2 : max,
    grid: { display: false },
    ticks: {
      maxTicksLimit: 6,
      maxRotation: 45,
      minRotation: 45,
      font: { size: 8 },
      callback(value) {
        return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'en', {
          timeZone: 'UTC',
          day: 'numeric',
          month: 'short',
          year: '2-digit',
          ...(this.max - this.min < DAY_MS
            ? ({ hour: '2-digit', minute: '2-digit' } as const)
            : {}),
        }).format(Number(value));
      },
    },
  };
}
