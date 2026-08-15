import { packItem, withoutKeys, type LayoutItem } from './grid';

/** Secondary windows start at 2: the main browser window is conceptually
 *  screen 1 but never appears in this model. */
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

/** Which secondary screens are open, each one's grid, and which panel sits on
 *  which. Plain values so the whole thing serializes as-is. */
export interface ScreensState {
  screens: ScreenDef[];
  assignment: Record<string, number>;
}

export const EMPTY_SCREENS: ScreensState = { screens: [], assignment: {} };

export function openScreen(state: ScreensState, id?: number): { state: ScreensState; id: number } {
  const screenId = id ?? state.screens.reduce((max, s) => Math.max(max, s.id + 1), FIRST_SCREEN_ID);
  if (state.screens.some((s) => s.id === screenId)) return { state, id: screenId };
  return {
    state: { ...state, screens: [...state.screens, { id: screenId, layout: [] }] },
    id: screenId,
  };
}

/** Closing a screen returns every panel on it to the main canvas. */
export function closeScreen(state: ScreensState, id: number): ScreensState {
  return {
    screens: state.screens.filter((s) => s.id !== id),
    assignment: Object.fromEntries(
      Object.entries(state.assignment).filter(([, sid]) => sid !== id)
    ),
  };
}

export function sendToScreen(
  state: ScreensState,
  panelId: string,
  screenId: number,
  size: { w: number; h: number }
): ScreensState {
  if (!state.screens.some((s) => s.id === screenId)) return state;
  const only = new Set([panelId]);
  const screens = state.screens.map((s) =>
    s.id === screenId
      ? { ...s, layout: packItem(s.layout, panelId, size) }
      : { ...s, layout: withoutKeys(s.layout, only) }
  );
  return { screens, assignment: { ...state.assignment, [panelId]: screenId } };
}

export function returnPanelFromScreen(state: ScreensState, panelId: string): ScreensState {
  const only = new Set([panelId]);
  const assignment = { ...state.assignment };
  delete assignment[panelId];
  return {
    screens: state.screens.map((s) => ({ ...s, layout: withoutKeys(s.layout, only) })),
    assignment,
  };
}

/** How many screens a remembered split would reopen: none while any screen is
 *  already open, and none for a split that holds no panels. */
export function restorableScreens(open: ScreensState, remembered: ScreensState | null): number {
  if (open.screens.length > 0 || !remembered) return 0;
  return Object.keys(remembered.assignment).length > 0 ? remembered.screens.length : 0;
}

/** Last known OS bounds, so a screen reopens where it was. */
export function rememberScreenBounds(
  state: ScreensState,
  id: number,
  bounds: ScreenBounds
): ScreensState {
  return { ...state, screens: state.screens.map((s) => (s.id === id ? { ...s, bounds } : s)) };
}
