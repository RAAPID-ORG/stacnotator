import type { ChartType, Plugin } from 'chart.js';
import type { SpectralIndexOut } from '~/api/client';
import type { TimeSeriesData } from './cache';

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required to match chart.js' own signature
  interface PluginOptionsByType<TType extends ChartType> {
    referenceLines?: { values: number[]; axisId: string };
  }
}

// ---------------------------------------------------------------------------
// Label / date formatting
// ---------------------------------------------------------------------------

/** Sorted, de-duplicated timestamps across the given series (by id), taken
 *  from one or more data sources (main + probe reads). Scoped to `seriesIds`
 *  so a chart's x-axis spans only its own series' dates - a 2022 window and
 *  a 2018 window each show just the years they cover instead of a shared
 *  axis. */
export function collectSeriesLabels(
  seriesIds: number[],
  ...sources: (TimeSeriesData | null | undefined)[]
): string[] {
  const times = new Set<string>();
  for (const id of seriesIds) {
    for (const source of sources) {
      for (const row of source?.[id] ?? []) times.add(row.time);
    }
  }
  return Array.from(times).sort((a, b) => parseSeriesDate(a) - parseSeriesDate(b));
}

export function parseSeriesDate(dateStr: string): number {
  if (/^\d{8}$/.test(dateStr)) {
    return Date.UTC(
      Number(dateStr.slice(0, 4)),
      Number(dateStr.slice(4, 6)) - 1,
      Number(dateStr.slice(6, 8))
    );
  }
  return new Date(dateStr).getTime();
}

// ---------------------------------------------------------------------------
// Chart.js plugins
// ---------------------------------------------------------------------------

export interface SliceMarker {
  startTime: number;
  endTime: number;
}

export function sliceMarkerFor(
  labels: string[],
  startDate: string | null | undefined,
  endDate: string | null | undefined
): SliceMarker | null {
  if (!startDate || !endDate || labels.length === 0) return null;
  const startTime = parseSeriesDate(startDate);
  const endTime = parseSeriesDate(endDate);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return null;
  return { startTime, endTime };
}

const markerByChart = new WeakMap<object, SliceMarker>();

/** All of chart.js a marker move needs: repaint the elements already there. */
interface Repaintable {
  render: () => void;
}

/** Moves the marker on a live chart. The marker is plugin state rather than
 *  chart data, so a move repaints the existing elements instead of running an
 *  update pass over every dataset. */
export function setSliceMarker(chart: Repaintable, marker: SliceMarker | null): void {
  const current = markerByChart.get(chart) ?? null;
  if (current?.startTime === marker?.startTime && current?.endTime === marker?.endTime) return;
  if (marker) markerByChart.set(chart, marker);
  else markerByChart.delete(chart);
  chart.render();
}

/** Subtle band + edge lines behind the chart data, showing which x-axis
 *  range corresponds to the slice currently shown on the map. */
export const sliceMarkerPlugin: Plugin<'line'> = {
  id: 'sliceMarker',
  afterDatasetsDraw(chart) {
    const marker = markerByChart.get(chart);
    if (!marker) return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    const halfStep = marker.endTime === marker.startTime ? 4 : 0;
    const xLeft = xScale.getPixelForValue(marker.startTime) - halfStep;
    const xRight = xScale.getPixelForValue(marker.endTime) + halfStep;
    const left = Math.max(chartArea.left, Math.min(xLeft, xRight));
    const right = Math.min(chartArea.right, Math.max(xLeft, xRight));
    if (right <= chartArea.left || left >= chartArea.right) return;

    ctx.save();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.10)'; // amber tint
    ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(Math.round(left) + 0.5, chartArea.top);
    ctx.lineTo(Math.round(left) + 0.5, chartArea.bottom);
    if (right - left > 1) {
      ctx.moveTo(Math.round(right) + 0.5, chartArea.top);
      ctx.lineTo(Math.round(right) + 0.5, chartArea.bottom);
    }
    ctx.stroke();
    ctx.restore();
  },
};

export interface ChartAxis {
  /** chart.js scale id; datasets point at it through `yAxisID`. */
  id: 'y' | 'y2';
  position: 'left' | 'right';
  min: number;
  max: number;
  /** The indices this axis carries, for its title. */
  indexKeys: string[];
  referenceLines: number[];
}

const FALLBACK_AXIS: ChartAxis = {
  id: 'y',
  position: 'left',
  min: 0,
  max: 1,
  indexKeys: [],
  referenceLines: [],
};

function axisOver(
  id: ChartAxis['id'],
  position: ChartAxis['position'],
  members: SpectralIndexOut[]
): ChartAxis {
  const indexKeys = Array.from(new Set(members.map((index) => index.key)));
  return {
    id,
    position,
    min: Math.min(...members.map((index) => index.domain_min)),
    max: Math.max(...members.map((index) => index.domain_max)),
    indexKeys,
    // A threshold that means "water" for MNDWI means nothing against NDVI, so
    // the lines only survive while the axis carries a single index.
    referenceLines: indexKeys.length === 1 ? members[0].reference_lines : [],
  };
}

/** How far apart two ranges must be before a second axis is worth its clutter.
 *  NDVI and MNDWI differ but read fine together; GCVI against either does not. */
const SEPARATE_AXIS_RATIO = 3;

/** The y-axes a chart of these series needs, at most two.
 *
 *  One window can hold indices that do not share a range - NDVI tops out at 1
 *  while GCVI runs to 10 - and squeezing those onto one axis flattens the
 *  smaller one into a flat line. A second axis is only worth the clutter when
 *  the ranges really are of different size, so indices within
 *  `SEPARATE_AXIS_RATIO` of each other stay together.
 *
 *  There is nowhere to put a third scale, which is the common case once a
 *  window holds several indices. Rather than pick two arbitrarily, the ranges
 *  are sorted by size and split at their largest jump: indices of similar scale
 *  stay grouped and only the genuine outlier moves across, with each axis
 *  spanning everything assigned to it. The chart's first series keeps the
 *  left-hand axis. Series whose index the client does not recognise fall back
 *  to a single fixed 0-1 axis. */
export function seriesAxes(indices: (SpectralIndexOut | null | undefined)[]): ChartAxis[] {
  const known = indices.filter((index): index is SpectralIndexOut => !!index);
  if (known.length === 0) return [FALLBACK_AXIS];

  const byDomain = new Map<string, SpectralIndexOut[]>();
  for (const index of known) {
    const domain = `${index.domain_min}:${index.domain_max}`;
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), index]);
  }

  const domains = Array.from(byDomain.values());
  const span = (group: SpectralIndexOut[]) => group[0].domain_max - group[0].domain_min;
  const bySpan = [...domains].sort((a, b) => span(a) - span(b));

  const widest = span(bySpan[bySpan.length - 1]);
  const narrowest = span(bySpan[0]);
  if (widest / narrowest <= SEPARATE_AXIS_RATIO) return [axisOver('y', 'left', known)];

  // Split where the ranges grow the most, comparing by ratio so the break lands
  // on the change in magnitude rather than on the largest absolute range.
  let splitAt = 1;
  let widestJump = -Infinity;
  for (let i = 1; i < bySpan.length; i++) {
    const jump = span(bySpan[i]) / span(bySpan[i - 1]);
    if (jump > widestJump) {
      widestJump = jump;
      splitAt = i;
    }
  }

  let [near, far] = [bySpan.slice(0, splitAt).flat(), bySpan.slice(splitAt).flat()];
  if (!near.includes(known[0])) [near, far] = [far, near];
  return [axisOver('y', 'left', near), axisOver('y2', 'right', far)];
}

/** Which axis a series belongs on; the left one for anything unrecognised. Two
 *  custom indices may share a name with different ranges, so the narrowest axis
 *  that carries the name and spans the range wins. */
export function axisIdFor(
  axes: ChartAxis[],
  index: SpectralIndexOut | null | undefined
): 'y' | 'y2' {
  const fits = axes.filter(
    (axis) =>
      !!index &&
      axis.indexKeys.includes(index.key) &&
      axis.min <= index.domain_min &&
      index.domain_max <= axis.max
  );
  fits.sort((a, b) => a.max - a.min - (b.max - b.min));
  return fits[0]?.id ?? axes[0].id;
}

/** Muted horizontal lines at the values an index calls out, styled to match the
 *  y-axis gridlines. The values come from the chart's own options, so each
 *  chart marks the thresholds that mean something for what it plots. */
export const referenceLinePlugin: Plugin<'line'> = {
  id: 'referenceLines',
  defaults: { values: [] as number[], axisId: 'y' },
  beforeDatasetsDraw(chart, _args, options: { values?: number[]; axisId?: string }) {
    const values = options?.values ?? [];
    const yScale = chart.scales[options?.axisId ?? 'y'];
    if (values.length === 0 || !yScale) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    ctx.save();
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const value of values) {
      const y = yScale.getPixelForValue(value);
      if (y < chartArea.top || y > chartArea.bottom) continue;
      const snapped = Math.round(y) + 0.5;
      ctx.moveTo(chartArea.left, snapped);
      ctx.lineTo(chartArea.right, snapped);
    }
    ctx.stroke();
    ctx.restore();
  },
};
