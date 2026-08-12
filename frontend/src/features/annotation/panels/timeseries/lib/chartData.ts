import type { Chart as ChartJS, ChartType, Plugin } from 'chart.js';
import type { TimeSeriesData } from './cache';

// Registers the sliceMarker plugin's runtime config (chart.options.plugins.
// sliceMarker) with chart.js's own option types, the same way its built-in
// plugins are typed - so Chart.tsx can set it without a cast.
declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType> {
    sliceMarker?: { marker: SliceMarker | null };
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
  return Array.from(times).sort();
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Format date string to "MMM 'YY" format. Handles both YYYYMMDD and ISO
 *  date formats. */
export function formatDateLabel(dateStr: string): string {
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.slice(0, 4);
    const month = parseInt(dateStr.slice(4, 6), 10);
    return `${MONTH_NAMES[month - 1]} '${year.slice(2)}`;
  }

  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return `${MONTH_NAMES[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`;
  }

  return dateStr;
}

/** Format date string for tooltip display (e.g., "15 Jan 2025"). */
export function formatDateForTooltip(dateStr: string): string {
  if (/^\d{8}$/.test(dateStr)) {
    const year = dateStr.slice(0, 4);
    const month = parseInt(dateStr.slice(4, 6), 10);
    const day = parseInt(dateStr.slice(6, 8), 10);
    return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
  }

  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  }

  return dateStr;
}

/** Parse a series date label to epoch ms. `new Date()` rejects the YYYYMMDD
 *  format the timeseries API returns, so handle it explicitly; both branches
 *  resolve to UTC midnight so labels and ISO slice dates share one clock. */
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

/** Extract month key (YYYYMM) from a date string, for grouping. */
function getMonthKey(dateStr: string): string | null {
  if (/^\d{8}$/.test(dateStr)) return dateStr.slice(0, 6);

  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  return null;
}

interface MonthLabel {
  index: number;
  label: string;
}

/** Unique month labels from sorted date strings: indices and formatted
 *  labels for the first occurrence of each month. */
function getMonthLabels(dates: string[]): MonthLabel[] {
  const seen = new Set<string>();
  const result: MonthLabel[] = [];

  dates.forEach((date, index) => {
    const monthKey = getMonthKey(date);
    if (monthKey && !seen.has(monthKey)) {
      seen.add(monthKey);
      result.push({ index, label: formatDateLabel(date) });
    }
  });

  return result;
}

/** Label interval (in months) based on total months covered: fewer months
 *  shown per label as the range grows, so the x-axis doesn't overcrowd. */
function calculateLabelInterval(totalMonths: number): number {
  if (totalMonths <= 6) return 1;
  if (totalMonths <= 12) return 2;
  if (totalMonths <= 18) return 3;
  if (totalMonths <= 24) return 4;
  if (totalMonths <= 36) return 6;
  return 12;
}

/** Optimally spaced month labels for the x-axis: always includes the first
 *  month, then every nth month per `calculateLabelInterval`, plus the last
 *  month when it isn't already included and the gap to it is large enough
 *  to be worth a label. */
export function getOptimalMonthLabels(dates: string[]): MonthLabel[] {
  const allMonthLabels = getMonthLabels(dates);
  if (allMonthLabels.length === 0) return [];

  const interval = calculateLabelInterval(allMonthLabels.length);
  const result: MonthLabel[] = [];
  for (let i = 0; i < allMonthLabels.length; i += interval) {
    result.push(allMonthLabels[i]);
  }

  const lastMonth = allMonthLabels[allMonthLabels.length - 1];
  const lastIncluded = result[result.length - 1];
  if (lastIncluded && lastMonth.index !== lastIncluded.index) {
    const lastIncludedIdx = allMonthLabels.findIndex((m) => m.index === lastIncluded.index);
    const monthsGap = allMonthLabels.length - 1 - lastIncludedIdx;
    if (monthsGap >= interval / 2) result.push(lastMonth);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Chart.js plugins
// ---------------------------------------------------------------------------

export interface SliceMarker {
  startIdx: number;
  endIdx: number;
}

/** Subtle band + edge lines behind the chart data, showing which x-axis
 *  range corresponds to the slice currently shown on the map. Reads its
 *  marker from `chart.options.plugins.sliceMarker`, which Chart.tsx updates
 *  whenever the active slice or the chart's own labels change. */
export const sliceMarkerPlugin: Plugin<'line'> = {
  id: 'sliceMarker',
  afterDatasetsDraw(chart) {
    // chart.js types every options field as deep-partial (for merging), which
    // would make startIdx/endIdx optional too even though the runtime value
    // Chart.tsx assigns is always a complete SliceMarker.
    const marker = chart.options.plugins?.sliceMarker?.marker as SliceMarker | null | undefined;
    if (!marker) return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    // Half-step padding so a single-point slice gets a visible band.
    const halfStep =
      marker.endIdx === marker.startIdx
        ? Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0)) / 2 || 4
        : 0;
    const xLeft = xScale.getPixelForValue(marker.startIdx) - halfStep;
    const xRight = xScale.getPixelForValue(marker.endIdx) + halfStep;
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

/** Muted horizontal reference lines at NDVI 0.25/0.75, styled to match the
 *  default y-axis gridline at 0.5. Fixed values - no external state. */
export const referenceLinePlugin: Plugin<'line'> = {
  id: 'ndviReferenceLines',
  beforeDatasetsDraw(chart) {
    const yScale = chart.scales.y;
    if (!yScale) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    ctx.save();
    ctx.strokeStyle = '#e5e5e5';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const value of [0.25, 0.75]) {
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
