import { create } from 'zustand';
import type { CampaignOutFull, ImageryViewOut } from '~/api/client';
import {
  defaultWindowItem,
  fromGridLayout,
  hideAll,
  hideWindow as hideWindowLayout,
  showWindow as showWindowLayout,
  type LayoutItem,
  type ViewLayout,
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

/** The windows a view carries: the personal layout the user saved for it if
 *  there is one, else the campaign's default for that view. */
export function viewWindows(view: ImageryViewOut | null): ViewLayout {
  const items =
    view?.personal_canvas_layout?.layout_data ?? view?.default_canvas_layout?.layout_data;
  return fromGridLayout(items ?? [], EMPTY_WORKSPACE_LAYOUT).view;
}

/** The one 60-column grid the canvas renders: the campaign's page chrome plus
 *  the selected view's windows. Chrome is campaign-wide, windows belong to the
 *  view, so switching view swaps only the second half. */
export function layoutForView(
  campaign: CampaignOutFull,
  view: ImageryViewOut | null
): WorkspaceLayout {
  const chrome =
    campaign.personal_main_canvas_layout?.layout_data ??
    campaign.default_main_canvas_layout?.layout_data ??
    [];
  return { main: fromGridLayout(chrome, EMPTY_WORKSPACE_LAYOUT).main, view: viewWindows(view) };
}

/**
 * Whether a grid change accounts for every panel on the canvas. The grid
 * reports the items it rendered, so a change that arrives while the canvas is
 * between panel sets - the moment a view switch swaps every window - reports
 * the gap as deletions. Writing that back would erase the layout of the view
 * being left, so such a change is not the user's and must be dropped.
 */
export function coversPanels(change: LayoutItem[], panelIds: string[]): boolean {
  const changed = new Set(change.map((item) => item.i));
  return panelIds.every((id) => changed.has(id));
}

export interface WorkspaceState {
  currentLayout: WorkspaceLayout;
  savedLayout: WorkspaceLayout;
  editing: boolean;
  newWindowSize: { perRow: number; rows: number };

  setLayout: (layout: WorkspaceLayout) => void;
  /** Swap the canvas over to another view's windows, keeping the page chrome
   *  where it currently sits. Both layouts move together: the incoming windows
   *  are what "cancel" reverts to for the rest of this view's visit. */
  loadViewLayout: (view: ImageryViewOut | null) => void;
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

  loadViewLayout: (view) =>
    set((s) => {
      const windows = viewWindows(view);
      return {
        currentLayout: { main: s.currentLayout.main, view: windows },
        savedLayout: { main: s.savedLayout.main, view: windows },
      };
    }),

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
