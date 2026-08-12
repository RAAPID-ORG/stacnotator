import type { LayoutItem } from '../types';
import { packItem, withoutKeys } from './scale';

/** Screen windows start at 2: the main browser window is conceptually
 *  screen 1, but never appears in this model. */
const FIRST_SCREEN_ID = 2;

export interface ScreenBounds {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

export interface ScreenDef {
  id: number;
  layout: LayoutItem[];
  bounds?: ScreenBounds;
}

/** Framework-free model of a canvas's secondary screen windows: which
 *  screens are open, each screen's own grid layout, and which panel id is
 *  assigned to which screen. Every operation here is a pure function over a
 *  state value - domain/stores wraps this in zustand (+ persistence) for
 *  actual use; platform never touches zustand itself. */
export interface ScreensState {
  screens: ScreenDef[];
  assignment: Record<string, number>;
}

export const EMPTY_SCREENS: ScreensState = { screens: [], assignment: {} };

function nextScreenId(state: ScreensState): number {
  return state.screens.reduce((max, s) => Math.max(max, s.id + 1), FIRST_SCREEN_ID);
}

/** Open a new screen (or a specific id, e.g. when restoring); no-op if that
 *  id is already open. */
export function open(state: ScreensState, id?: number): { state: ScreensState; id: number } {
  const screenId = id ?? nextScreenId(state);
  if (state.screens.some((s) => s.id === screenId)) return { state, id: screenId };
  return {
    state: { ...state, screens: [...state.screens, { id: screenId, layout: [] }] },
    id: screenId,
  };
}

/** Close a screen; every panel assigned to it returns to the main canvas. */
export function close(state: ScreensState, id: number): ScreensState {
  const assignment = Object.fromEntries(
    Object.entries(state.assignment).filter(([, sid]) => sid !== id)
  );
  return { screens: state.screens.filter((s) => s.id !== id), assignment };
}

/** Assign a panel to a screen, packing it into that screen's layout at the
 *  given size and removing it from wherever it was assigned before. No-op
 *  when the target screen does not exist. */
export function sendTo(
  state: ScreensState,
  panelId: string,
  screenId: number,
  size: { w: number; h: number }
): ScreensState {
  if (!state.screens.some((s) => s.id === screenId)) return state;
  const withoutPanel = new Set([panelId]);
  const screens = state.screens.map((s) => {
    if (s.id === screenId) return { ...s, layout: packItem(s.layout, panelId, size) };
    return s.layout.some((it) => it.i === panelId)
      ? { ...s, layout: withoutKeys(s.layout, withoutPanel) }
      : s;
  });
  return { screens, assignment: { ...state.assignment, [panelId]: screenId } };
}

/** Return a panel to the main canvas: remove it from its screen's layout and
 *  from the assignment map. */
export function returnPanel(state: ScreensState, panelId: string): ScreensState {
  const withoutPanel = new Set([panelId]);
  const screens = state.screens.map((s) =>
    s.layout.some((it) => it.i === panelId)
      ? { ...s, layout: withoutKeys(s.layout, withoutPanel) }
      : s
  );
  const assignment = { ...state.assignment };
  delete assignment[panelId];
  return { screens, assignment };
}

/** Record a screen window's last known OS bounds (position/size), so it can
 *  be reopened in the same place. */
export function rememberBounds(
  state: ScreensState,
  id: number,
  bounds: ScreenBounds
): ScreensState {
  return { ...state, screens: state.screens.map((s) => (s.id === id ? { ...s, bounds } : s)) };
}

/** Screens state is already a plain, JSON-serializable value - serialize and
 *  restore are the identity, kept as named functions so callers (persistence
 *  wrappers) have a stable seam if that ever changes. */
export function serialize(state: ScreensState): ScreensState {
  return state;
}

export function restore(snapshot: ScreensState): ScreensState {
  return snapshot;
}
