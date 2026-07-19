import type { Layout, LayoutItem } from 'react-grid-layout';

/** Mirror of backend src/campaigns/constants.py - keep in sync if either side
 *  changes. Used when the user adds a previously-hidden window back to the
 *  canvas: pick a sensible size and slot it at the bottom of the grid. */
export const VIEW_LAYOUT_COLS_PER_ROW = 6;
export const VIEW_LAYOUT_WINDOW_W = 10;
export const VIEW_LAYOUT_WINDOW_H = 9;

/** Total columns of the annotation grid (mirror of `cols: 60` in Canvas.tsx). */
export const GRID_COLS = 60;

/** Default size for a newly-added window, used until the user picks another. */
export const DEFAULT_NEW_WINDOW_SIZE = { w: VIEW_LAYOUT_WINDOW_W, h: VIEW_LAYOUT_WINDOW_H };

/** Compute where to drop a freshly-added window so that adding windows one after
 *  another packs them into a tidy left-to-right, top-to-bottom grid: continue
 *  the bottom-most row while it has horizontal room, otherwise start a new row. */
export function nextWindowSlot(layout: Layout, size: { w: number; h: number }): LayoutItem {
  const existing = layout.filter((it) => !isMainLayoutKey(it.i));
  if (existing.length === 0) {
    // First window after a full hide: sit flush below the page chrome rather
    // than at a fixed offset, so there's no empty band above the new row.
    const chromeBottom = layout
      .filter((it) => isMainLayoutKey(it.i))
      .reduce((m, it) => Math.max(m, (it.y ?? 0) + (it.h ?? 0)), 0);
    return { i: '', x: 0, y: chromeBottom, ...size };
  }

  const lastRowY = existing.reduce((max, it) => Math.max(max, it.y ?? 0), 0);
  const rightEdge = existing
    .filter((it) => (it.y ?? 0) === lastRowY)
    .reduce((max, it) => Math.max(max, (it.x ?? 0) + (it.w ?? 0)), 0);

  if (rightEdge + size.w <= GRID_COLS) {
    return { i: '', x: rightEdge, y: lastRowY, ...size };
  }

  const bottom = existing.reduce((max, it) => Math.max(max, (it.y ?? 0) + (it.h ?? 0)), 0);
  return { i: '', x: 0, y: bottom, ...size };
}

/** Every timeseries window is keyed `${TIMESERIES_WINDOW_KEY_PREFIX}<name>`; a
 *  series with no explicit window lands in the default one, named below. Mirror
 *  of backend src/timeseries/windows.py - keep in sync if either side changes. */
export const TIMESERIES_WINDOW_KEY_PREFIX = 'timeseries:';
export const DEFAULT_TIMESERIES_WINDOW_NAME = 'Time series';

/** Whether a grid key is a timeseries window. */
export function isTimeseriesWindowKey(key: string): boolean {
  return key.startsWith(TIMESERIES_WINDOW_KEY_PREFIX);
}

/** Fixed page chrome that lives in the main layout and is never hidden by
 *  per-window affordances: the main map, minimap, controls, and every
 *  timeseries window (default or named). */
const BASE_MAIN_LAYOUT_KEYS = new Set(['main', 'minimap', 'controls']);
export function isMainLayoutKey(key: string): boolean {
  return BASE_MAIN_LAYOUT_KEYS.has(key) || isTimeseriesWindowKey(key);
}

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Resolve a free grid cell for a window dropped at (x, y): clamp x within the
 *  grid, then push y downward until the footprint clears every existing item
 *  (page chrome included). Keeps drag-and-drop placement collision-free without
 *  changing the grid's free-form compaction. */
export function resolveDropCell(
  layout: Layout,
  x: number,
  y: number,
  size: { w: number; h: number },
  ignoreKey?: string
): { x: number; y: number } {
  const cx = Math.max(0, Math.min(x, GRID_COLS - size.w));
  const obstacles = layout.filter((it) => it.i !== ignoreKey);
  let cy = Math.max(0, y);
  while (obstacles.some((it) => rectsOverlap({ x: cx, y: cy, w: size.w, h: size.h }, it))) {
    cy += 1;
  }
  return { x: cx, y: cy };
}
