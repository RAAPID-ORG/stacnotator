import type { TimeSeriesOut } from '~/api/client';
import { DEFAULT_TIMESERIES_WINDOW_NAME } from '~/shared/utils/constants';

export const TIMESERIES_WINDOW_KEY_PREFIX = 'timeseries:';

export { DEFAULT_TIMESERIES_WINDOW_NAME };

export interface TimeseriesWindow {
  /** Grid key for this window (matches the backend layout entry). */
  key: string;
  title: string;
  series: TimeSeriesOut[];
}

export function groupTimeseriesIntoWindows(timeseries: TimeSeriesOut[]): TimeseriesWindow[] {
  const windows: TimeseriesWindow[] = [];
  const byKey = new Map<string, TimeseriesWindow>();
  for (const ts of timeseries) {
    const name = ts.window_name?.trim() || DEFAULT_TIMESERIES_WINDOW_NAME;
    const key = `${TIMESERIES_WINDOW_KEY_PREFIX}${name}`;
    let window = byKey.get(key);
    if (!window) {
      window = { key, title: name, series: [] };
      byKey.set(key, window);
      windows.push(window);
    }
    window.series.push(ts);
  }
  return windows;
}
