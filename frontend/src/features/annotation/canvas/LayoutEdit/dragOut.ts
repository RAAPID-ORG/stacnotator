import { resolveDropCell, type CanvasRect, type Point } from '../dropCell';
import type { LayoutItem } from '../grid';

/** Pointer movement below this distance (px) from the origin is a click, not
 *  a drag-out. */
export const MOVE_THRESHOLD_PX = 5;

export interface DragOutGeometry {
  canvasRect: CanvasRect;
  scrollTop: number;
  layout: LayoutItem[];
}

interface DragOutCell {
  x: number;
  y: number;
  free: boolean;
}

export type DragOutState =
  | { phase: 'idle' }
  | { phase: 'pending'; id: string; size: { w: number; h: number }; origin: Point }
  | {
      phase: 'dragging';
      id: string;
      size: { w: number; h: number };
      pointer: Point;
      cell: DragOutCell;
    }
  | { phase: 'dropped'; id: string; cell: { x: number; y: number } }
  | { phase: 'clicked'; id: string }
  | { phase: 'cancelled' };

export type DragOutEvent =
  | { type: 'pointerdown'; id: string; size: { w: number; h: number }; x: number; y: number }
  | { type: 'pointermove'; x: number; y: number }
  // `overExcludedRegion` is a caller-supplied hit-test result (e.g. from
  // `document.elementFromPoint(...).closest(...)`): true when the release
  // point is back over the tray's own floating panel, which floats above
  // the canvas so whatever grid cell is underneath it isn't a real drop
  // target. Only applies to an in-progress drag - a plain click always
  // releases over the tray by definition and must still place the item.
  | { type: 'pointerup'; overExcludedRegion?: boolean }
  | { type: 'cancel' };

const IDLE: DragOutState = { phase: 'idle' };

function snapCell(
  id: string,
  size: { w: number; h: number },
  pointer: Point,
  geometry: DragOutGeometry
): DragOutCell {
  return resolveDropCell(
    pointer,
    geometry.canvasRect,
    geometry.scrollTop,
    size.w,
    size.h,
    geometry.layout,
    id
  );
}

/** Pure state machine for dragging a hidden item out onto the canvas:
 *  pointerdown arms a pending drag; movement past MOVE_THRESHOLD_PX promotes
 *  it to an in-progress drag with a live snapped cell; release either drops
 *  (cell was free and not back over the tray itself), clicks (never moved
 *  past threshold), or is a no-op cancel (occupied cell, or released back
 *  over the tray); Escape always cancels.
 *  DOM wiring (pointer capture, window listeners, rendering the ghost/
 *  preview) lives in HiddenTray.tsx, which drives this reducer and reacts to
 *  its 'dropped' / 'clicked' terminal states. Keeping the drag logic
 *  decoupled from the DOM is what makes it directly testable. */
export function step(
  state: DragOutState,
  event: DragOutEvent,
  geometry: DragOutGeometry
): DragOutState {
  if (event.type === 'cancel') return IDLE;

  if (event.type === 'pointerdown') {
    return { phase: 'pending', id: event.id, size: event.size, origin: { x: event.x, y: event.y } };
  }

  if (event.type === 'pointermove') {
    if (
      state.phase === 'idle' ||
      state.phase === 'dropped' ||
      state.phase === 'clicked' ||
      state.phase === 'cancelled'
    ) {
      return state;
    }
    if (state.phase === 'pending') {
      const dist = Math.hypot(event.x - state.origin.x, event.y - state.origin.y);
      if (dist < MOVE_THRESHOLD_PX) return state;
      const pointer = { x: event.x, y: event.y };
      return {
        phase: 'dragging',
        id: state.id,
        size: state.size,
        pointer,
        cell: snapCell(state.id, state.size, pointer, geometry),
      };
    }
    // dragging
    const pointer = { x: event.x, y: event.y };
    return { ...state, pointer, cell: snapCell(state.id, state.size, pointer, geometry) };
  }

  // pointerup
  if (state.phase === 'pending') return { phase: 'clicked', id: state.id };
  if (state.phase === 'dragging') {
    if (event.overExcludedRegion) return { phase: 'cancelled' };
    return state.cell.free
      ? { phase: 'dropped', id: state.id, cell: { x: state.cell.x, y: state.cell.y } }
      : { phase: 'cancelled' };
  }
  return IDLE;
}
