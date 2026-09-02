import { create } from 'zustand';
import type { ImageryViewOut } from '~/api/client';
import {
  defaultWindowItem,
  hideAllWindows,
  hideWindow,
  scaleWidthToScreen,
  showWindow,
  syncViewWindows,
  viewWindows,
  EMPTY_LAYOUT,
  type LayoutItem,
  type WorkspaceLayout,
} from '../canvas/grid';
import {
  closeScreen,
  EMPTY_SCREENS,
  openScreen,
  rememberScreenBounds,
  restorableScreens,
  returnPanelFromScreen,
  sendToScreen,
  type ScreenBounds,
  type ScreensState,
} from '../canvas/screens';

/** Initial OS-window size for a newly opened screen. */
export const SCREEN_DEFAULT_BOUNDS: ScreenBounds = { width: 1280, height: 860, left: 80, top: 60 };
/** Rough horizontal overhead of a screen window, used to estimate its canvas
 *  width before the window has reported one. */
const SCREEN_CHROME_PX = 40;

const screensKey = (scope: string) => `annotation:screens:${scope}`;

function readSavedScreens(scope: string | null): ScreensState | null {
  if (!scope) return null;
  try {
    const raw = localStorage.getItem(screensKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScreensState;
    return Array.isArray(parsed.screens) && parsed.assignment ? parsed : null;
  } catch {
    return null;
  }
}

interface LayoutState {
  currentLayout: WorkspaceLayout;
  /** What "cancel" reverts to for the rest of this view's visit. */
  savedLayout: WorkspaceLayout;
  editing: boolean;
  newWindowSize: { perRow: number; rows: number };
  /** `data-tour` name of a header menu held open from outside, so the guided
   *  tour can show what is inside a picker while it explains it. */
  forcedOpenControl: string | null;

  /** `${userId}:${campaignId}` - the screen split is per user per campaign. */
  scope: string | null;
  screens: ScreensState;
  /** A remembered split this scope could reopen, offered by the restore toast. */
  savedScreens: ScreensState | null;
  /** The toast is hidden for this visit; the split itself stays remembered. */
  restorePromptHidden: boolean;

  setLayout: (layout: WorkspaceLayout) => void;
  /** Swap in another view's windows, leaving the page chrome where it is. */
  loadViewLayout: (view: ImageryViewOut | null) => void;
  /** Pick up a source-membership change on the view already loaded: drop the
   *  windows that left, place the ones that arrived, keep the rest put. */
  syncWindowsToView: (view: ImageryViewOut | null, eligible: ReadonlySet<number>) => void;
  showWindow: (collectionId: number) => void;
  hideWindow: (collectionId: number) => void;
  hideAllWindows: () => void;
  setNewWindowSize: (size: { perRow: number; rows: number }) => void;
  startEditing: () => void;
  setForcedOpenControl: (name: string | null) => void;
  saveLayout: () => void;
  cancelEditing: () => void;

  setScope: (scope: string | null) => void;
  sendToScreen: (
    panelId: string,
    target: number | 'new',
    item: LayoutItem | undefined,
    canvasPx: number
  ) => void;
  /** Move one panel off its screen, back to the main canvas. */
  returnPanelToMain: (panelId: string) => void;
  closeScreen: (id: number) => void;
  setScreenLayout: (id: number, layout: LayoutItem[]) => void;
  rememberScreenBounds: (id: number, bounds: ScreenBounds) => void;
  /** Return any panel the page no longer has (a view switch dropped its
   *  collection, settings dropped a time series). */
  pruneScreensTo: (validPanelIds: ReadonlySet<string>) => void;
  restoreSavedScreens: () => void;
  hideRestorePrompt: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  /** The split is remembered as it last stood with a screen open, so closing a
   *  screen stays undoable. Going empty writes nothing rather than erasing:
   *  only `forgetScreens` forgets. */
  const persistScreens = (screens: ScreensState) => {
    if (screens.screens.length === 0) return;
    set({ savedScreens: screens });
    const { scope } = get();
    if (!scope) return;
    try {
      localStorage.setItem(screensKey(scope), JSON.stringify(screens));
    } catch {
      // private mode / quota: the split just won't survive a reload
    }
  };

  const forgetScreens = () => {
    set({ savedScreens: null, restorePromptHidden: false });
    const { scope } = get();
    if (!scope) return;
    try {
      localStorage.removeItem(screensKey(scope));
    } catch {
      // ignore storage failures
    }
  };

  const updateScreens = (next: (current: ScreensState) => ScreensState) => {
    const screens = next(get().screens);
    set({ screens });
    persistScreens(screens);
  };

  return {
    currentLayout: EMPTY_LAYOUT,
    savedLayout: EMPTY_LAYOUT,
    editing: false,
    forcedOpenControl: null,
    newWindowSize: { perRow: 6, rows: 9 },
    scope: null,
    screens: EMPTY_SCREENS,
    savedScreens: null,
    restorePromptHidden: false,

    setLayout: (currentLayout) => set({ currentLayout }),

    loadViewLayout: (view) =>
      set((s) => {
        const windows = viewWindows(view);
        return {
          currentLayout: { main: s.currentLayout.main, windows },
          savedLayout: { main: s.savedLayout.main, windows },
        };
      }),

    // Membership is committed server-side the moment it is toggled, so it lands
    // in the cancel baseline too - cancelling the layout edit reverts
    // placements, never which windows the view has.
    syncWindowsToView: (view, eligible) =>
      set((s) => ({
        currentLayout: syncViewWindows(s.currentLayout, view, eligible),
        savedLayout: syncViewWindows(s.savedLayout, view, eligible),
      })),

    showWindow: (collectionId) =>
      set((s) => ({
        currentLayout: showWindow(
          s.currentLayout,
          collectionId,
          defaultWindowItem(s.newWindowSize.perRow, s.newWindowSize.rows)
        ),
      })),

    hideWindow: (collectionId) =>
      set((s) => ({ currentLayout: hideWindow(s.currentLayout, collectionId) })),

    hideAllWindows: () => set((s) => ({ currentLayout: hideAllWindows(s.currentLayout) })),
    setNewWindowSize: (newWindowSize) => set({ newWindowSize }),
    startEditing: () => set({ editing: true }),
    setForcedOpenControl: (forcedOpenControl) => set({ forcedOpenControl }),
    // A layout saved with nothing on a secondary screen is the user saying they
    // no longer work on one, and is the only thing that forgets the split.
    saveLayout: () => {
      if (get().screens.screens.length === 0) forgetScreens();
      set((s) => ({ savedLayout: s.currentLayout, editing: false }));
    },
    cancelEditing: () => set((s) => ({ currentLayout: s.savedLayout, editing: false })),

    // A scope change is a different campaign or user: drop the live windows
    // and pick up that scope's remembered split instead.
    setScope: (scope) =>
      set({
        scope,
        screens: EMPTY_SCREENS,
        savedScreens: readSavedScreens(scope),
        restorePromptHidden: false,
      }),

    sendToScreen: (panelId, target, item, canvasPx) =>
      updateScreens((current) => {
        const opened = target === 'new' ? openScreen(current) : { state: current, id: target };
        // A new screen is seeded with the bounds it will actually open at, so
        // the width the panel is scaled against is the real one.
        const seeded =
          target === 'new'
            ? rememberScreenBounds(opened.state, opened.id, SCREEN_DEFAULT_BOUNDS)
            : opened.state;
        const bounds = seeded.screens.find((s) => s.id === opened.id)?.bounds;
        const screenPx = (bounds?.width ?? SCREEN_DEFAULT_BOUNDS.width) - SCREEN_CHROME_PX;
        // Rows are a fixed height so h transfers as-is, but a grid column is
        // narrower in a screen window.
        const size = item
          ? { w: scaleWidthToScreen(item.w, canvasPx, screenPx), h: item.h }
          : { w: 20, h: 12 };
        return sendToScreen(seeded, panelId, opened.id, size);
      }),

    returnPanelToMain: (panelId) => updateScreens((c) => returnPanelFromScreen(c, panelId)),

    closeScreen: (id) => updateScreens((c) => closeScreen(c, id)),

    setScreenLayout: (id, layout) =>
      updateScreens((c) => ({
        ...c,
        screens: c.screens.map((s) => (s.id === id ? { ...s, layout } : s)),
      })),

    rememberScreenBounds: (id, bounds) => updateScreens((c) => rememberScreenBounds(c, id, bounds)),

    pruneScreensTo: (valid) => {
      const stale = Object.keys(get().screens.assignment).filter((id) => !valid.has(id));
      if (stale.length === 0) return;
      updateScreens((c) => stale.reduce((acc, id) => returnPanelFromScreen(acc, id), c));
    },

    restoreSavedScreens: () => {
      const { savedScreens } = get();
      if (savedScreens) updateScreens(() => savedScreens);
    },

    hideRestorePrompt: () => set({ restorePromptHidden: true }),
  };
});

/** Panel ids living in a screen window, withheld from the main grid. */
export function usePoppedPanels(): ReadonlySet<string> {
  const assignment = useLayoutStore((s) => s.screens.assignment);
  return new Set(Object.keys(assignment));
}

/** How many screens the remembered split would reopen, 0 when there is nothing
 *  to offer. */
export function useRestorableScreens(): number {
  const open = useLayoutStore((s) => s.screens);
  const saved = useLayoutStore((s) => s.savedScreens);
  const hidden = useLayoutStore((s) => s.restorePromptHidden);
  return hidden ? 0 : restorableScreens(open, saved);
}
