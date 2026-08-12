import { create } from 'zustand';
import {
  defaultWindowItem,
  hideAll,
  hideWindow as hideWindowLayout,
  showWindow as showWindowLayout,
  type WorkspaceLayout,
} from '~/features/annotation/core/workspace';

const EMPTY_ITEM = { i: '', x: 0, y: 0, w: 0, h: 0 };

/** Bootstrap value for a WorkspaceLayout before any campaign has loaded (or
 *  in `fromGridLayout`'s `prev` fallback slot). Real campaign data always
 *  carries a personal or default canvas layout with real main/minimap/
 *  controls items; this only backstops the zero-data case. */
export const EMPTY_WORKSPACE_LAYOUT: WorkspaceLayout = {
  main: {
    main: { ...EMPTY_ITEM, i: 'main' },
    minimap: { ...EMPTY_ITEM, i: 'minimap' },
    controls: { ...EMPTY_ITEM, i: 'controls' },
    timeseries: {},
  },
  view: { windows: {} },
};

export interface WorkspaceState {
  currentLayout: WorkspaceLayout;
  savedLayout: WorkspaceLayout;
  editing: boolean;
  newWindowSize: { perRow: number; rows: number };

  setLayout: (layout: WorkspaceLayout) => void;
  showWindow: (collectionId: number) => void;
  hideWindow: (collectionId: number) => void;
  hideAllWindows: () => void;
  setNewWindowSize: (size: { perRow: number; rows: number }) => void;
  /** Enter layout-edit mode. currentLayout keeps mutating from here; savedLayout
   *  is the value "cancel" will revert to. */
  startEditing: () => void;
  /** Commit the in-progress edits: savedLayout := currentLayout. */
  saveLayout: () => void;
  /** Discard the in-progress edits: currentLayout := savedLayout. */
  cancelEditing: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentLayout: EMPTY_WORKSPACE_LAYOUT,
  savedLayout: EMPTY_WORKSPACE_LAYOUT,
  editing: false,
  newWindowSize: { perRow: 6, rows: 9 },

  setLayout: (layout) => set({ currentLayout: layout }),

  showWindow: (collectionId) =>
    set((s) => ({
      currentLayout: showWindowLayout(
        s.currentLayout,
        collectionId,
        defaultWindowItem(s.newWindowSize.perRow, s.newWindowSize.rows)
      ),
    })),

  hideWindow: (collectionId) =>
    set((s) => ({ currentLayout: hideWindowLayout(s.currentLayout, collectionId) })),

  hideAllWindows: () => set((s) => ({ currentLayout: hideAll(s.currentLayout) })),

  setNewWindowSize: (size) => set({ newWindowSize: size }),

  startEditing: () => set({ editing: true }),

  saveLayout: () => set((s) => ({ savedLayout: s.currentLayout, editing: false })),

  cancelEditing: () => set((s) => ({ currentLayout: s.savedLayout, editing: false })),
}));
