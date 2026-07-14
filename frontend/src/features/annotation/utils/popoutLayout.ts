import type { Layout } from 'react-grid-layout';

/** Layout handed to react-grid-layout while some cards live in pop-out
 *  windows: their items are withheld so the grid can use the freed space. */
export function withoutKeys(layout: Layout, keys: ReadonlySet<string>): Layout {
  if (keys.size === 0) return layout;
  return layout.filter((it) => !keys.has(it.i));
}

/** Place a card at the bottom of a screen's layout, keeping the size it had
 *  on the canvas it came from (both grids share cols/rowHeight, so w/h
 *  transfer 1:1). No-op if the card is already on the screen. */
export function appendItem(layout: Layout, key: string, size: { w: number; h: number }): Layout {
  if (layout.some((it) => it.i === key)) return layout;
  const bottom = layout.reduce((max, it) => Math.max(max, (it.y ?? 0) + (it.h ?? 0)), 0);
  return [...layout, { i: key, x: 0, y: bottom, w: size.w, h: size.h }];
}

/** Convert a card width from one canvas to another so the card keeps its
 *  pixel width: both grids have 60 columns, but a column is wider on a wide
 *  canvas than in a smaller screen window. */
export function scaleWidthToScreen(w: number, sourcePx: number, targetPx: number): number {
  if (sourcePx <= 0 || targetPx <= 0) return w;
  return Math.max(4, Math.min(60, Math.round((w * sourcePx) / targetPx)));
}

/** react-grid-layout reports layout changes without the withheld items, but
 *  `currentLayout` must keep a slot for every popped-out card - it is where
 *  the card returns to, and what `saveLayout` persists. Re-add the remembered
 *  slots from the previous layout on every change. */
export function mergeLayoutChange(
  next: Layout,
  previous: Layout | null,
  poppedKeys: ReadonlySet<string>
): Layout {
  if (poppedKeys.size === 0) return next;
  const nextKeys = new Set(next.map((it) => it.i));
  const preserved = (previous ?? []).filter((it) => poppedKeys.has(it.i) && !nextKeys.has(it.i));
  return preserved.length === 0 ? next : [...next, ...preserved];
}
