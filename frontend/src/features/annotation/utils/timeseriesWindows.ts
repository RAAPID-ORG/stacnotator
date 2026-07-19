import type { TimeSeriesOut } from '~/api/client';
import { DEFAULT_TIMESERIES_WINDOW_NAME, TIMESERIES_WINDOW_KEY_PREFIX } from './layoutDefaults';

export interface TimeseriesWindow {
  /** Grid key for this window (matches the backend layout entry). */
  key: string;
  title: string;
  series: TimeSeriesOut[];
}

/** Group a campaign's timeseries into canvas windows by `window_name`: series
 *  sharing a name render together in one window. Series without a name land in
 *  the default window. Window order follows first appearance so it lines up with
 *  the layout entries the backend packs. Mirror of the backend grouping in
 *  src/timeseries/windows.py. */
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
