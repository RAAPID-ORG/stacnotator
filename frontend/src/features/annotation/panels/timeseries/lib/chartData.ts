import type { Plugin } from 'chart.js';
import type { TimeSeriesData } from './cache';

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

/** The label index range covered by a slice's date range. When no label falls
 *  inside it, the single label nearest the range's centre, so the marker still
 *  points at where the slice sits. */
export function sliceMarkerFor(
  labels: string[],
  startDate: string | null | undefined,
  endDate: string | null | undefined
): SliceMarker | null {
  if (!startDate || !endDate || labels.length === 0) return null;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < labels.length; i++) {
    const time = parseSeriesDate(labels[i]);
    if (time >= start && time <= end) {
      if (startIdx === -1) startIdx = i;
      endIdx = i;
    }
  }
  if (startIdx !== -1) return { startIdx, endIdx };

  const centre = (start + end) / 2;
  let nearest = 0;
  let bestDist = Infinity;
  for (let i = 0; i < labels.length; i++) {
    const dist = Math.abs(parseSeriesDate(labels[i]) - centre);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = i;
    }
  }
  return { startIdx: nearest, endIdx: nearest };
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
  if (current?.startIdx === marker?.startIdx && current?.endIdx === marker?.endIdx) return;
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
