import type { CampaignOutFull, CanvasLayoutItem, ImageryViewOut } from '~/api/client';
import { TIMESERIES_KEY_PREFIX } from '../campaign/timeseries';
import { sameValue } from '~/shared/utils/equality';

export const GRID_COLS = 60;
export const ROW_HEIGHT = 15;
export const GRID_MARGIN: [number, number] = [6, 6];

export type LayoutItem = CanvasLayoutItem;

/** Campaign-wide panels. Timeline and imagery controls stay inside the main
 *  map unless given their own slot. Timeseries windows are keyed `timeseries:<window id>`. */
export interface MainLayout {
  main: LayoutItem;
  minimap: LayoutItem;
  controls: LayoutItem;
  timeseries: Record<string, LayoutItem>;
  timeline?: LayoutItem;
  imagery?: LayoutItem;
}

export interface WorkspaceLayout {
  main: MainLayout;
  /** Where the selected view's imagery windows sit, by collection id. Every
   *  collection of the view is a window unless hidden; one with no slot here is
   *  placed wherever there is room. */
  windows: Record<number, LayoutItem>;
  /** The view's collections this layout hides. */
  hidden: number[];
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
  hidden: [],
};

export function toGridLayout(l: WorkspaceLayout): LayoutItem[] {
  return [
    l.main.main,
    l.main.minimap,
    l.main.controls,
    ...(l.main.timeline ? [l.main.timeline] : []),
    ...(l.main.imagery ? [l.main.imagery] : []),
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
  const navigation: Pick<MainLayout, 'timeline' | 'imagery'> = {};
  const previous = new Map(toGridLayout(prev).map((item) => [item.i, item]));

  for (const next of items) {
    // The grid returns geometry only; keep panel preferences across drags/resizes.
    const saved = previous.get(next.i);
    const orientation = next.orientation ?? saved?.orientation;
    const expandedSections = next.expanded_sections ?? saved?.expanded_sections;
    const sliceNavigation = next.slice_navigation ?? saved?.slice_navigation;
    const item: LayoutItem = {
      i: next.i,
      x: next.x,
      y: next.y,
      w: next.w,
      h: next.h,
      ...(orientation != null && { orientation }),
      ...(expandedSections != null && { expanded_sections: expandedSections }),
      ...(sliceNavigation != null && { slice_navigation: sliceNavigation }),
    };
    if (item.i === 'main') main = item;
    else if (item.i === 'minimap') minimap = item;
    else if (item.i === 'controls') controls = item;
    else if (item.i === 'timeline' || item.i === 'imagery') navigation[item.i] = item;
    else if (item.i.startsWith(TIMESERIES_KEY_PREFIX)) timeseries[item.i] = item;
    else if (Number.isFinite(Number(item.i))) windows[Number(item.i)] = item;
  }

  return {
    main: { main, minimap, controls, timeseries, ...navigation },
    windows,
    hidden: prev.hidden,
  };
}

/** A view's windows as the user saved them, else as the campaign default has them. */
export function viewLayout(
  view: ImageryViewOut | null
): Pick<WorkspaceLayout, 'windows' | 'hidden'> {
  const saved = view?.personal_canvas_layout ?? view?.default_canvas_layout;
  return {
    windows: fromGridLayout(saved?.layout_data ?? [], EMPTY_LAYOUT).windows,
    hidden: (saved?.hidden ?? []).map(Number),
  };
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
  return { main: fromGridLayout(chrome, EMPTY_LAYOUT).main, ...viewLayout(view) };
}

/** Drives the "applies to all views" warning before saving. */
export function mainLayoutChanged(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  return !sameValue(a.main, b.main);
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
      y: bottomOf(toGridLayout({ main, windows: {}, hidden: [] })),
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

/** Bring a hidden window back, at the end of the last row of windows. */
export function showWindow(
  layout: WorkspaceLayout,
  collectionId: number,
  size: { w: number; h: number }
): WorkspaceLayout {
  if (!layout.hidden.includes(collectionId)) return layout;
  const { x, y } = nextSlot(layout.main, layout.windows, size);
  return {
    main: layout.main,
    windows: { ...layout.windows, [collectionId]: { i: String(collectionId), x, y, ...size } },
    hidden: layout.hidden.filter((id) => id !== collectionId),
  };
}

export function hideWindow(layout: WorkspaceLayout, collectionId: number): WorkspaceLayout {
  return hideAllWindows(layout, [collectionId]);
}

export function hideAllWindows(
  layout: WorkspaceLayout,
  collectionIds: readonly number[]
): WorkspaceLayout {
  const windows = { ...layout.windows };
  for (const id of collectionIds) delete windows[id];
  return {
    main: layout.main,
    windows,
    hidden: [...new Set([...layout.hidden, ...collectionIds])],
  };
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

/** Split the map's footprint so the timeline starts where its integrated
 *  counterpart lived. Reclaim its old strip only while it still fits flush. */
export function placeTimeline(
  layout: WorkspaceLayout,
  orientation: 'horizontal' | 'vertical' | null
): WorkspaceLayout {
  const map = { ...layout.main.main };
  const previous = layout.main.timeline;
  if (previous) {
    if (
      previous.y === map.y &&
      previous.h === map.h &&
      (previous.x + previous.w === map.x || map.x + map.w === previous.x)
    ) {
      map.x = Math.min(map.x, previous.x);
      map.w += previous.w;
    } else if (
      previous.x === map.x &&
      previous.w === map.w &&
      (previous.y + previous.h === map.y || map.y + map.h === previous.y)
    ) {
      map.y = Math.min(map.y, previous.y);
      map.h += previous.h;
    }
  }
  const main = { ...layout.main, main: map };
  delete main.timeline;
  const next = { ...layout, main };
  if (orientation === null) return next;

  // A one-cell map cannot be split; leave a gap so this fallback is not
  // mistaken for a strip to reclaim on the next orientation change.
  if ((orientation === 'vertical' ? map.w : map.h) < 2) {
    const size =
      orientation === 'vertical'
        ? { w: 4, h: Math.max(1, map.h) }
        : { w: Math.max(1, map.w), h: 4 };
    return {
      ...next,
      main: {
        ...main,
        timeline: {
          ...previous,
          i: 'timeline',
          ...size,
          orientation,
          x: Math.min(map.x, GRID_COLS - size.w),
          y: bottomOf(toGridLayout(next)) + 1,
        },
      },
    };
  }

  const timeline: LayoutItem = {
    ...previous,
    i: 'timeline',
    x: map.x,
    y: map.y,
    w: map.w,
    h: map.h,
    orientation,
  };
  if (orientation === 'vertical') {
    timeline.w = Math.min(4, map.w - 1);
    map.x += timeline.w;
    map.w -= timeline.w;
  } else {
    timeline.h = Math.min(4, map.h - 1);
    map.h -= timeline.h;
    timeline.y = map.y + map.h;
  }
  return { ...next, main: { ...main, timeline } };
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
  windowIds: number[],
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
  for (const id of [...windowIds].sort((a, b) => a - b)) push(String(id), rest);

  return items;
}
