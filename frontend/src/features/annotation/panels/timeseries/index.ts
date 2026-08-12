import { createElement } from 'react';
import { groupTimeseriesIntoWindows } from '~/features/annotation/core/catalog';
import type { PanelDef } from '~/features/annotation/engine/canvas';
import type { Feature } from '../registry';
import { TimeseriesPanel } from './TimeseriesPanel';

export const timeseriesFeature: Feature = {
  panels: (ctx): PanelDef[] =>
    groupTimeseriesIntoWindows(ctx.campaign.time_series).map(
      (window): PanelDef => ({
        id: window.key,
        title: window.title,
        body: createElement(TimeseriesPanel, { ctx, window }),
      })
    ),
};

export { Chart, type ChartProps } from './Chart';
export { TimeseriesPanel, type TimeseriesPanelProps } from './TimeseriesPanel';
export { OptionsPopover, type OptionsPopoverProps, type SmoothingOptions } from './OptionsPopover';
export {
  timeSeriesCache,
  TimeSeriesCache,
  type LatLon,
  type TimeSeriesData,
  type TimeSeriesRow,
} from './lib/cache';
export {
  collectSeriesLabels,
  formatDateForTooltip,
  formatDateLabel,
  getOptimalMonthLabels,
  parseSeriesDate,
  referenceLinePlugin,
  sliceMarkerPlugin,
  type SliceMarker,
} from './lib/chartData';
export { savitzkyGolay } from './lib/smoothing';
