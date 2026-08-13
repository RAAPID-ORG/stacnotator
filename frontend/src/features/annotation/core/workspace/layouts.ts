import { GRID_COLS, type LayoutItem, type MainLayout, type WorkspaceLayout } from './types';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/** Whether the fixed page chrome (main map, minimap, controls, timeseries)
 *  differs between two layouts - drives the "applies to all views" warning
 *  before saving. Compares the typed MainLayout wholesale rather than testing
 *  a hand-written list of chrome keys, so a controls-only move is caught
 *  instead of silently skipping the warning. MainLayout's required
 *  `controls` field makes that
 *  omission unrepresentable here. */
export function mainLayoutChanged(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  return !deepEqual(a.main, b.main);
}

/** Size for a newly-shown window given the new-window picker's `perRow`
 *  (columns divided evenly across the 60-column grid) and `rows` (explicit
 *  height). */
export function defaultWindowItem(perRow: number, rows: number): { w: number; h: number } {
  return { w: Math.floor(GRID_COLS / perRow), h: rows };
}

const rowBottom = (items: LayoutItem[]): number =>
  items.reduce((max, it) => Math.max(max, it.y + it.h), 0);

/** Where a freshly-shown window packs to: continue the bottom-most row while
 *  it has horizontal room, otherwise start a new row; an empty view sits
 *  flush below the main chrome. */
function nextWindowSlot(
  main: MainLayout,
  windows: Record<number, LayoutItem>,
  size: { w: number; h: number }
) {
  const existing = Object.values(windows);
  if (existing.length === 0) {
    const chromeBottom = rowBottom([
      main.main,
      main.minimap,
      main.controls,
      ...Object.values(main.timeseries),
    ]);
    return { x: 0, y: chromeBottom };
  }

  const lastRowY = existing.reduce((max, it) => Math.max(max, it.y), 0);
  const rightEdge = existing
    .filter((it) => it.y === lastRowY)
    .reduce((max, it) => Math.max(max, it.x + it.w), 0);

  if (rightEdge + size.w <= GRID_COLS) return { x: rightEdge, y: lastRowY };
  return { x: 0, y: rowBottom(existing) };
}

/** Add a collection's window back into the view, packed at the next free
 *  slot. A no-op if it is already showing. */
export function showWindow(
  layout: WorkspaceLayout,
  collectionId: number,
  size: { w: number; h: number }
): WorkspaceLayout {
  if (layout.view.windows[collectionId]) return layout;
  const { x, y } = nextWindowSlot(layout.main, layout.view.windows, size);
  return {
    main: layout.main,
    view: {
      windows: {
        ...layout.view.windows,
        [collectionId]: { i: String(collectionId), x, y, ...size },
      },
    },
  };
}

/** Remove one collection's window from the view. */
export function hideWindow(layout: WorkspaceLayout, collectionId: number): WorkspaceLayout {
  const { [collectionId]: _removed, ...rest } = layout.view.windows;
  return { main: layout.main, view: { windows: rest } };
}

/** Remove every imagery window, leaving the main chrome untouched. */
export function hideAll(layout: WorkspaceLayout): WorkspaceLayout {
  return { main: layout.main, view: { windows: {} } };
}
