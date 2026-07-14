import type { Layout } from 'react-grid-layout';

/** Layout handed to react-grid-layout while some cards live in pop-out
 *  windows: their items are withheld so the grid can use the freed space. */
export function withoutKeys(layout: Layout, keys: ReadonlySet<string>): Layout {
  if (keys.size === 0) return layout;
  return layout.filter((it) => !keys.has(it.i));
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
