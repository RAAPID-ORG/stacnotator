import { create } from 'zustand';
import type { ImageryViewOut } from '~/api/client';
import type { Catalog } from '~/features/annotation/core/catalog';
import { useImageryStore } from './imagery';
import { useWorkspaceStore } from './workspace';

export type WorkMode = 'tasks' | 'explore';

export interface SessionState {
  workMode: WorkMode;
  isReviewMode: boolean;
  selectedViewId: number | null;
  /** Effective start collection for task navigation in the selected view.
   * Unlike prefs.pinnedStart this is always resolved, including the default. */
  taskStartCollectionId: number | null;

  setWorkMode: (mode: WorkMode) => void;
  setReviewMode: (reviewMode: boolean) => void;
  setTaskStartCollection: (collectionId: number) => void;
  /** Make `view` the selected one: its imagery nav state and its canvas
   *  windows both come with it, so the whole page belongs to one view. */
  selectView: (view: ImageryViewOut, cat: Catalog, fallbackCollectionId: number | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  workMode: 'explore',
  isReviewMode: false,
  selectedViewId: null,
  taskStartCollectionId: null,

  setWorkMode: (mode) => {
    // Entering Explore also drops any lingering review-mode flag - review is
    // a Tasks-only concept, so carrying it over would trap the UI in it with
    // no way back short of a reload.
    set((s) => ({ workMode: mode, isReviewMode: mode === 'explore' ? false : s.isReviewMode }));
    // Crosshair on for Tasks (point placement), off for Explore (free-form
    // drawing) - routed through imagery's own action, not a raw setState.
    const imagery = useImageryStore.getState();
    imagery.setCrosshair(mode === 'tasks');
    // Task-scoped no-data observations are meaningless once the work mode (and
    // in Explore, the freely pannable location) changes.
    imagery.setEmptyScope(null);
  },

  setReviewMode: (reviewMode) => set({ isReviewMode: reviewMode }),

  setTaskStartCollection: (taskStartCollectionId) => set({ taskStartCollectionId }),

  selectView: (view, cat, fallbackCollectionId) => {
    const { selectedViewId } = get();
    useImageryStore.getState().switchView(cat, selectedViewId, view.id, fallbackCollectionId);
    useWorkspaceStore.getState().loadViewLayout(view);
    set({ selectedViewId: view.id, taskStartCollectionId: fallbackCollectionId });
  },
}));
