import type { TimeSeriesOut } from '~/api/client';
import { DEFAULT_TIMESERIES_WINDOW_KEY, TIMESERIES_WINDOW_KEY_PREFIX } from './layoutDefaults';

export interface TimeseriesWindow {
  /** Grid key for this window (matches the backend layout entry). */
  key: string;
  title: string;
  series: TimeSeriesOut[];
}

/** Title shown for the default window that holds all unnamed series. */
export const DEFAULT_TIMESERIES_WINDOW_TITLE = 'Time series';

/** Group a campaign's timeseries into canvas windows by `window_name`: series
 *  sharing a name render together in one window, and unnamed series collapse
 *  into the default window. Window order follows first appearance so it lines up
 *  with the layout entries the backend packs. Mirror of the backend grouping in
 *  src/timeseries/windows.py. */
export function groupTimeseriesIntoWindows(timeseries: TimeSeriesOut[]): TimeseriesWindow[] {
  const windows: TimeseriesWindow[] = [];
  const byKey = new Map<string, TimeseriesWindow>();
  for (const ts of timeseries) {
    const name = ts.window_name?.trim() ?? '';
    const key = name ? `${TIMESERIES_WINDOW_KEY_PREFIX}${name}` : DEFAULT_TIMESERIES_WINDOW_KEY;
    let window = byKey.get(key);
    if (!window) {
      window = { key, title: name || DEFAULT_TIMESERIES_WINDOW_TITLE, series: [] };
      byKey.set(key, window);
      windows.push(window);
    }
    window.series.push(ts);
  }
  return windows;
}
