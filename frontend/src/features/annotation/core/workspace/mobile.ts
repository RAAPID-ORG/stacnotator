import { GRID_COLS, type LayoutItem, type ViewLayout } from './types';

const ROW_HEIGHT = 15;

/** Mobile ignores the saved desktop grid and stacks everything in a single
 *  column: main and controls each get half the viewport (so both fit above
 *  the fold together), then each timeseries group, then the minimap, then
 *  every visible window, sorted by collectionId. */
export function mobileStack(view: ViewLayout, groups: string[], viewportH: number): LayoutItem[] {
  const halfRows = Math.max(20, Math.floor(viewportH / ROW_HEIGHT / 2));
  const restRows = 18;
  const items: LayoutItem[] = [];
  let y = 0;

  items.push({ i: 'main', x: 0, y, w: GRID_COLS, h: halfRows });
  y += halfRows;
  items.push({ i: 'controls', x: 0, y, w: GRID_COLS, h: halfRows });
  y += halfRows;

  for (const key of groups) {
    items.push({ i: key, x: 0, y, w: GRID_COLS, h: restRows });
    y += restRows;
  }

  items.push({ i: 'minimap', x: 0, y, w: GRID_COLS, h: restRows });
  y += restRows;

  const collectionIds = Object.keys(view.windows)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of collectionIds) {
    items.push({ i: String(id), x: 0, y, w: GRID_COLS, h: restRows });
    y += restRows;
  }

  return items;
}
