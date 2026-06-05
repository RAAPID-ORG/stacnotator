import { create } from 'zustand';

/** Ephemeral state for dragging a hidden window from the panel onto the canvas.
 *  The panel starts the drag; the Canvas controller tracks the pointer, shows a
 *  snapped placeholder, and drops the window on release.
 *
 *  We roll our own drag rather than use react-grid-layout's native external
 *  drop, whose placeholder writes back through `onLayoutChange` on our
 *  controlled layout and spins into a "Maximum update depth" loop. */
interface WindowDragStore {
  collectionId: number | null;
  /** Pointer position where the drag began (for a small move threshold). */
  originX: number;
  originY: number;
  start: (collectionId: number, x: number, y: number) => void;
  clear: () => void;
}

export const useWindowDragStore = create<WindowDragStore>((set) => ({
  collectionId: null,
  originX: 0,
  originY: 0,
  start: (collectionId, x, y) => set({ collectionId, originX: x, originY: y }),
  clear: () => set({ collectionId: null }),
}));
