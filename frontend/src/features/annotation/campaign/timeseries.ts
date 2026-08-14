import type { TimeSeriesOut } from '~/api/client';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';

/** Panel ids for timeseries windows, so the canvas can tell them from the
 *  numeric imagery-window ids. */
export const TIMESERIES_KEY_PREFIX = 'timeseries:';
export { DEFAULT_TIMESERIES_WINDOW_NAME };

export interface TimeseriesWindow {
  key: string;
  title: string;
  series: TimeSeriesOut[];
}

export function groupTimeseriesIntoWindows(timeseries: TimeSeriesOut[]): TimeseriesWindow[] {
  const byKey = new Map<string, TimeseriesWindow>();
  for (const ts of timeseries) {
    const title = ts.window_name?.trim() || DEFAULT_TIMESERIES_WINDOW_NAME;
    const key = `${TIMESERIES_KEY_PREFIX}${title}`;
    let window = byKey.get(key);
    if (!window) {
      window = { key, title, series: [] };
      byKey.set(key, window);
    }
    window.series.push(ts);
  }
  return [...byKey.values()];
}
