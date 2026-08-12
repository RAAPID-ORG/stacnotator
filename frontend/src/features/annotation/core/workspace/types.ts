export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Fixed page chrome that always exists in the grid: the main map, minimap,
 *  controls panel, and every timeseries window (keyed by its grid key,
 *  `timeseries:<name>`, default window included). Never hidden by
 *  per-collection window affordances. */
export interface MainLayout {
  main: LayoutItem;
  minimap: LayoutItem;
  controls: LayoutItem;
  timeseries: Record<string, LayoutItem>;
}

/** Per-collection imagery windows for the selected view, keyed by collectionId. */
export interface ViewLayout {
  windows: Record<number, LayoutItem>;
}

export interface WorkspaceLayout {
  main: MainLayout;
  view: ViewLayout;
}

/** Domain-local mirror of src/platform/canvas/types.ts's GRID_COLS (the
 *  canvas is always a 60-column grid). */
export const GRID_COLS = 60;

const isTimeseriesWindowKey = (key: string): boolean => key.startsWith('timeseries:');

/** Flatten a WorkspaceLayout into the single 60-column grid array the canvas
 *  renders (main chrome, then timeseries windows, then imagery windows).
 *  Each LayoutItem already carries its own grid key in `.i`. */
export function toGridLayout(l: WorkspaceLayout): LayoutItem[] {
  return [
    l.main.main,
    l.main.minimap,
    l.main.controls,
    ...Object.values(l.main.timeseries),
    ...Object.values(l.view.windows),
  ];
}

/** Rebuild a WorkspaceLayout from a flat grid array (e.g. the canvas's
 *  onLayoutChange callback). Routes each item by its key: 'main' / 'minimap'
 *  / 'controls' to the matching MainLayout slot, `timeseries:*` keys into
 *  main.timeseries, and everything else (a collectionId) into view.windows.
 *  `prev` supplies the main-chrome slots when one is unexpectedly absent
 *  from `items`, since MainLayout requires all three; windows and
 *  timeseries entries are rebuilt purely from `items`, so an entry dropped
 *  from the flat array (e.g. by hideWindow) does not linger from `prev`. */
export function fromGridLayout(items: LayoutItem[], prev: WorkspaceLayout): WorkspaceLayout {
  let main = prev.main.main;
  let minimap = prev.main.minimap;
  let controls = prev.main.controls;
  const timeseries: Record<string, LayoutItem> = {};
  const windows: Record<number, LayoutItem> = {};

  for (const item of items) {
    if (item.i === 'main') main = item;
    else if (item.i === 'minimap') minimap = item;
    else if (item.i === 'controls') controls = item;
    else if (isTimeseriesWindowKey(item.i)) timeseries[item.i] = item;
    else windows[Number(item.i)] = item;
  }

  return { main: { main, minimap, controls, timeseries }, view: { windows } };
}
