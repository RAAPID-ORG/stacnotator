import type { Layout, LayoutItem } from 'react-grid-layout';

/** Mirror of backend src/campaigns/constants.py — keep in sync if either side
 *  changes. Used when the user adds a previously-hidden window back to the
 *  canvas: pick a sensible size and slot it at the bottom of the grid. */
export const VIEW_LAYOUT_COLS_PER_ROW = 6;
export const VIEW_LAYOUT_WINDOW_W = 10;
export const VIEW_LAYOUT_WINDOW_H = 9;
export const VIEW_LAYOUT_START_Y = 25;

/** Compute where to drop a freshly-added window: below all existing items, in
 *  the next free slot of a 6-column row. Matches the backend's
 *  `_sync_view_layouts` placement for added collections. */
export function nextWindowSlot(layout: Layout): LayoutItem {
  const existing = layout.filter((it) => !MAIN_LAYOUT_KEYS.has(it.i));
  const bottom = existing.reduce(
    (max, it) => Math.max(max, (it.y ?? 0) + (it.h ?? 0)),
    VIEW_LAYOUT_START_Y
  );
  // Place at the leftmost column of the new row.
  return {
    i: '',
    x: 0,
    y: bottom,
    w: VIEW_LAYOUT_WINDOW_W,
    h: VIEW_LAYOUT_WINDOW_H,
  };
}

/** Keys reserved for the fixed page chrome (main map, time series chart, etc.).
 *  Items with these keys are never hidden by per-window affordances. */
export const MAIN_LAYOUT_KEYS = new Set(['main', 'timeseries', 'minimap', 'controls']);
