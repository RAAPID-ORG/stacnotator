import type { CampaignOutFull, ImageryViewOut } from '~/api/client';
import { TIMESERIES_KEY_PREFIX } from '../domain/catalog';

export const GRID_COLS = 60;
export const ROW_HEIGHT = 15;
export const GRID_MARGIN: [number, number] = [6, 6];

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Page chrome that always has a grid slot. Timeseries windows are keyed
 *  `timeseries:<name>`. None of these can be hidden. */
export interface MainLayout {
  main: LayoutItem;
  minimap: LayoutItem;
  controls: LayoutItem;
  timeseries: Record<string, LayoutItem>;
}

export interface WorkspaceLayout {
  main: MainLayout;
  /** Per-collection imagery windows for the selected view. */
  windows: Record<number, LayoutItem>;
}

const EMPTY_ITEM = { x: 0, y: 0, w: 0, h: 0 };

/** Backstop for before any campaign has loaded. Real data always carries a
 *  personal or default layout with real items. */
export const EMPTY_LAYOUT: WorkspaceLayout = {
  main: {
    main: { i: 'main', ...EMPTY_ITEM },
    minimap: { i: 'minimap', ...EMPTY_ITEM },
    controls: { i: 'controls', ...EMPTY_ITEM },
    timeseries: {},
  },
  windows: {},
};

export function toGridLayout(l: WorkspaceLayout): LayoutItem[] {
  return [
    l.main.main,
    l.main.minimap,
    l.main.controls,
    ...Object.values(l.main.timeseries),
    ...Object.values(l.windows),
  ];
}

/**
 * Rebuild from the flat array the grid reports back. `prev` only supplies the
 * three chrome slots when one is missing (MainLayout requires all three);
 * windows and timeseries entries come purely from `items` so that hiding one
 * does not resurrect it from `prev`.
 */
export function fromGridLayout(items: LayoutItem[], prev: WorkspaceLayout): WorkspaceLayout {
  let { main, minimap, controls } = prev.main;
  const timeseries: Record<string, LayoutItem> = {};
  const windows: Record<number, LayoutItem> = {};

  for (const item of items) {
    if (item.i === 'main') main = item;
    else if (item.i === 'minimap') minimap = item;
    else if (item.i === 'controls') controls = item;
    else if (item.i.startsWith(TIMESERIES_KEY_PREFIX)) timeseries[item.i] = item;
    else windows[Number(item.i)] = item;
  }

  return { main: { main, minimap, controls, timeseries }, windows };
}

/** The windows a view carries: the user's saved layout for it, else the
 *  campaign default for that view. */
export function viewWindows(view: ImageryViewOut | null): Record<number, LayoutItem> {
  const items =
    view?.personal_canvas_layout?.layout_data ?? view?.default_canvas_layout?.layout_data;
  return fromGridLayout(items ?? [], EMPTY_LAYOUT).windows;
}

/** Chrome is campaign-wide, windows belong to the view, so switching view
 *  swaps only the second half. */
export function layoutForView(
  campaign: CampaignOutFull,
  view: ImageryViewOut | null
): WorkspaceLayout {
  const chrome =
    campaign.personal_main_canvas_layout?.layout_data ??
    campaign.default_main_canvas_layout?.layout_data ??
    [];
  return { main: fromGridLayout(chrome, EMPTY_LAYOUT).main, windows: viewWindows(view) };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/** Drives the "applies to all views" warning before saving. */
export function mainLayoutChanged(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  return !deepEqual(a.main, b.main);
}

/**
 * Whether a grid change accounts for every panel on the canvas. The grid
 * reports the items it rendered, so a change arriving mid-swap (a view switch
 * replacing every window) reports the gap as deletions. Writing that back
 * would erase the outgoing view's layout, so it is not the user's and is
 * dropped.
 */
export function coversPanels(change: LayoutItem[], panelIds: string[]): boolean {
  const changed = new Set(change.map((item) => item.i));
  return panelIds.every((id) => changed.has(id));
}

export function defaultWindowItem(perRow: number, rows: number) {
  return { w: Math.floor(GRID_COLS / perRow), h: rows };
}

const bottomOf = (items: LayoutItem[]) => items.reduce((max, it) => Math.max(max, it.y + it.h), 0);

/** Continue the bottom row while it has room, else start a new one. */
function nextSlot(
  main: MainLayout,
  windows: Record<number, LayoutItem>,
  size: { w: number; h: number }
) {
  const existing = Object.values(windows);
  if (existing.length === 0) {
    return {
      x: 0,
      y: bottomOf([main.main, main.minimap, main.controls, ...Object.values(main.timeseries)]),
    };
  }
  const lastRowY = existing.reduce((max, it) => Math.max(max, it.y), 0);
  const rightEdge = existing
    .filter((it) => it.y === lastRowY)
    .reduce((max, it) => Math.max(max, it.x + it.w), 0);
  return rightEdge + size.w <= GRID_COLS
    ? { x: rightEdge, y: lastRowY }
    : { x: 0, y: bottomOf(existing) };
}

export function showWindow(
  layout: WorkspaceLayout,
  collectionId: number,
  size: { w: number; h: number }
): WorkspaceLayout {
  if (layout.windows[collectionId]) return layout;
  const { x, y } = nextSlot(layout.main, layout.windows, size);
  return {
    main: layout.main,
    windows: { ...layout.windows, [collectionId]: { i: String(collectionId), x, y, ...size } },
  };
}

export function hideWindow(layout: WorkspaceLayout, collectionId: number): WorkspaceLayout {
  const { [collectionId]: _removed, ...rest } = layout.windows;
  return { main: layout.main, windows: rest };
}

export function hideAllWindows(layout: WorkspaceLayout): WorkspaceLayout {
  return { main: layout.main, windows: {} };
}

export const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Packs `id` into the first free cell, top-to-bottom then left-to-right,
 *  keeping the size it arrives with. A no-op when it already has a slot.
 *  Panels can appear after a layout was saved - a campaign that grew a time
 *  series, a view that grew a window - and must not be dropped. */
export function packItem(
  items: LayoutItem[],
  id: string,
  size: { w: number; h: number },
  cols: number = GRID_COLS
): LayoutItem[] {
  if (items.some((it) => it.i === id)) return items;
  const w = Math.min(size.w, cols);
  const bottom = bottomOf(items);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const rect = { x, y, w, h: size.h };
      if (!items.some((it) => overlaps(rect, it))) return [...items, { i: id, ...rect }];
    }
  }
  return [...items, { i: id, x: 0, y: bottom, w, h: size.h }];
}

/** Withhold popped-out panels so the grid can use the freed space. */
export function withoutKeys(layout: LayoutItem[], keys: ReadonlySet<string>): LayoutItem[] {
  return keys.size === 0 ? layout : layout.filter((it) => !keys.has(it.i));
}

/** The grid reports changes without the withheld items, but the stored layout
 *  must keep a slot for every popped-out panel: that is where it returns to. */
export function mergeLayoutChange(
  next: LayoutItem[],
  previous: LayoutItem[] | null,
  poppedKeys: ReadonlySet<string>
): LayoutItem[] {
  if (poppedKeys.size === 0) return next;
  const nextKeys = new Set(next.map((it) => it.i));
  const preserved = (previous ?? []).filter((it) => poppedKeys.has(it.i) && !nextKeys.has(it.i));
  return preserved.length === 0 ? next : [...next, ...preserved];
}

/** Both grids have GRID_COLS columns, but a column is narrower in a small
 *  screen window - rescale so the panel keeps its pixel width. */
export function scaleWidthToScreen(w: number, sourcePx: number, targetPx: number): number {
  if (sourcePx <= 0 || targetPx <= 0) return w;
  return Math.max(4, Math.min(GRID_COLS, Math.round((w * sourcePx) / targetPx)));
}

/**
 * Mobile ignores the saved desktop grid for a single stacked column: main and
 * controls take half the viewport each so both fit above the fold, then the
 * timeseries groups, the minimap, and every visible window.
 */
export function mobileStack(
  windows: Record<number, LayoutItem>,
  timeseriesKeys: string[],
  viewportH: number
): LayoutItem[] {
  const half = Math.max(20, Math.floor(viewportH / ROW_HEIGHT / 2));
  const rest = 18;
  const items: LayoutItem[] = [];
  let y = 0;
  const push = (i: string, h: number) => {
    items.push({ i, x: 0, y, w: GRID_COLS, h });
    y += h;
  };

  push('main', half);
  push('controls', half);
  for (const key of timeseriesKeys) push(key, rest);
  push('minimap', rest);
  for (const id of Object.keys(windows)
    .map(Number)
    .sort((a, b) => a - b))
    push(String(id), rest);

  return items;
}
