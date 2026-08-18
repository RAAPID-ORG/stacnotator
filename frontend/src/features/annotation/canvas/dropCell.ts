import { GRID_COLS, GRID_MARGIN, ROW_HEIGHT, type LayoutItem } from '../canvas/grid';

export interface Point {
  x: number;
  y: number;
}

/** The grid container's viewport-relative box, as from getBoundingClientRect(). */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
}

// react-grid-layout ships this exact math at runtime as `calculateUtils`
// (build/calculateUtils.js), but its @types package doesn't declare that
// export, so it can't be imported with a stable type. Reimplemented locally
// rather than reaching past the package's public TS surface with a cast.
function calcGridColWidth(containerWidth: number): number {
  return (containerWidth - GRID_MARGIN[0] * (GRID_COLS - 1) - GRID_MARGIN[0] * 2) / GRID_COLS;
}

function calcGridItemPositionPx(
  containerWidth: number,
  x: number,
  y: number,
  w: number,
  h: number
): { left: number; top: number; width: number; height: number } {
  const colWidth = calcGridColWidth(containerWidth);
  return {
    width: Math.round(colWidth * w + Math.max(0, w - 1) * GRID_MARGIN[0]),
    height: Math.round(ROW_HEIGHT * h + Math.max(0, h - 1) * GRID_MARGIN[1]),
    left: Math.round((colWidth + GRID_MARGIN[0]) * x + GRID_MARGIN[0]),
    top: Math.round((ROW_HEIGHT + GRID_MARGIN[1]) * y + GRID_MARGIN[1]),
  };
}

function calcXYFromPx(
  containerWidth: number,
  left: number,
  top: number,
  w: number
): { x: number; y: number } {
  const colWidth = calcGridColWidth(containerWidth);
  const x = Math.round((left - GRID_MARGIN[0]) / (colWidth + GRID_MARGIN[0]));
  const y = Math.round((top - GRID_MARGIN[1]) / (ROW_HEIGHT + GRID_MARGIN[1]));
  return { x: Math.max(0, Math.min(x, GRID_COLS - w)), y: Math.max(0, y) };
}

/** Where a freshly-added item lands so that adding them one after another
 *  packs into a tidy left-to-right, top-to-bottom grid: continue the bottom
 *  row while it has room, else start a new one. */
export function nextFreeSlot(layout: LayoutItem[], w: number): Point {
  if (layout.length === 0) return { x: 0, y: 0 };

  const lastRowY = layout.reduce((max, it) => Math.max(max, it.y), 0);
  const rightEdge = layout
    .filter((it) => it.y === lastRowY)
    .reduce((max, it) => Math.max(max, it.x + it.w), 0);

  if (rightEdge + w <= GRID_COLS) return { x: rightEdge, y: lastRowY };

  const bottom = layout.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  return { x: 0, y: bottom };
}

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Push a candidate cell downward until its footprint clears every existing
 *  item. */
function pushToFreeCell(
  layout: LayoutItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  ignoreKey?: string
): Point {
  const obstacles = ignoreKey ? layout.filter((it) => it.i !== ignoreKey) : layout;
  let cy = Math.max(0, y);
  while (obstacles.some((it) => rectsOverlap({ x, y: cy, w, h }, it))) cy += 1;
  return { x, y: cy };
}

/** Resolve the grid cell a pointer drop should snap to: convert the pointer's
 *  viewport position to grid units (centering the item's footprint on the
 *  cursor, accounting for how far the canvas is scrolled), clamp it inside
 *  the grid, then push it down until free of collisions. `free` reports
 *  whether the pointer's own cell was already free (no push needed) - the
 *  caller uses this to decide whether a drop is actually droppable there. */
export function resolveDropCell(
  pointerPx: Point,
  canvasRect: CanvasRect,
  scrollTop: number,
  w: number,
  h: number,
  layout: LayoutItem[],
  ignoreKey?: string
): { x: number; y: number; free: boolean } {
  const itemPx = calcGridItemPositionPx(canvasRect.width, 0, 0, w, h);
  const left = pointerPx.x - canvasRect.left - itemPx.width / 2;
  const top = pointerPx.y - canvasRect.top + scrollTop - itemPx.height / 2;
  const { x, y } = calcXYFromPx(canvasRect.width, left, top, w);

  const resolved = pushToFreeCell(layout, x, y, w, h, ignoreKey);
  return { x: resolved.x, y: resolved.y, free: resolved.x === x && resolved.y === y };
}

/** Pixel box (relative to the canvas container) for a grid cell - the
 *  inverse of the position half of resolveDropCell's math. Used to draw a
 *  drop-preview outline while dragging. */
export function cellToPixelRect(
  cell: Point,
  canvasWidth: number,
  w: number,
  h: number
): { left: number; top: number; width: number; height: number } {
  return calcGridItemPositionPx(canvasWidth, cell.x, cell.y, w, h);
}
