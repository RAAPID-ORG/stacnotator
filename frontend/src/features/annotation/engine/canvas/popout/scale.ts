import type { LayoutItem } from '../types';
import { GRID_COLS } from '../types';

/** Layout handed to the grid while some panels live in pop-out windows: their
 *  items are withheld so the grid can use the freed space.
 */
export function withoutKeys(layout: LayoutItem[], keys: ReadonlySet<string>): LayoutItem[] {
  if (keys.size === 0) return layout;
  return layout.filter((it) => !keys.has(it.i));
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Place a panel into the first free slot of a screen's layout - greedy
 *  top-to-bottom, left-to-right scan - keeping the size it arrives with.
 *  Falls back to a fresh row below everything; no-op if already present. */
export function packItem(
  layout: LayoutItem[],
  key: string,
  size: { w: number; h: number },
  cols: number = GRID_COLS
): LayoutItem[] {
  if (layout.some((it) => it.i === key)) return layout;
  const w = Math.min(size.w, cols);
  const bottom = layout.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const rect = { x, y, w, h: size.h };
      if (!layout.some((it) => overlaps(rect, it))) {
        return [...layout, { i: key, ...rect }];
      }
    }
  }
  return [...layout, { i: key, x: 0, y: bottom, w, h: size.h }];
}

/** Convert a panel width from one canvas to another so the panel keeps its
 *  pixel width: both grids share GRID_COLS columns, but a column is wider on
 *  a wide canvas than in a smaller screen window. */
export function scaleWidthToScreen(w: number, sourcePx: number, targetPx: number): number {
  if (sourcePx <= 0 || targetPx <= 0) return w;
  return Math.max(4, Math.min(GRID_COLS, Math.round((w * sourcePx) / targetPx)));
}

/** The grid reports layout changes without withheld items, but the caller's
 *  layout must keep a slot for every popped-out panel - it is where the
 *  panel returns to, and what a persisted layout serializes. Re-adds the
 *  remembered slots from the previous layout on every change. */
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
