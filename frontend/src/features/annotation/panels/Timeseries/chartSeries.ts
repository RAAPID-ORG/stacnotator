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

export function seriesPoints(observations: SeriesObservation[]): SeriesPoint[] {
  return observations
    .filter((row) => !row.filtered)
    .map((observation) => ({
      x: observation.x,
      y: observation.smoothed ?? observation.values,
      observation,
    }));
}

export function seriesDataset(
  observations: SeriesObservation[],
  axis: ChartAxis,
  color: string,
  dotRadius: number
): ChartDataset<'line', SeriesPoint[]> {
  const data = seriesPoints(observations);
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
    pointRadius: dotRadius,
    pointStyle: 'circle',
    spanGaps: true,
    clip: { top: 0, bottom: 0, left: 8, right: 8 },
    tension: 0,
  };
}

export function elapsedTimeTicks(min: number, max: number): number[] {
  const steps = [
    ...[1, 5, 15, 30].map((minutes) => minutes * 60_000),
    ...[1, 3, 6, 12].map((hours) => hours * 3_600_000),
    ...[1, 2, 7, 14, 30, 60, 90, 180, 365].map((days) => days * DAY_MS),
  ];
  const target = (max - min) / 5;
  const step = steps.find((step) => step >= target) ?? Math.ceil(target / DAY_MS) * DAY_MS;
  const alignment = Math.min(step, DAY_MS);
  const first = Math.ceil(min / alignment) * alignment;
  const ticks = [];
  for (let value = first; value <= max; value += step) ticks.push(value);
  return ticks;
}

export function elapsedTimeScale(times: number[]): ScaleOptions<'linear'> {
  const min = times.length ? Math.min(...times) : undefined;
  const max = times.length ? Math.max(...times) : undefined;
  return {
    type: 'linear',
    min: min === max && min !== undefined ? min - DAY_MS / 2 : min,
    max: min === max && max !== undefined ? max + DAY_MS / 2 : max,
    grid: { display: false },
    afterBuildTicks(scale) {
      scale.ticks = elapsedTimeTicks(scale.min, scale.max).map((value) => ({ value }));
    },
    ticks: {
      autoSkip: false,
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
