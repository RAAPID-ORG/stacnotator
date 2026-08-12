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

  setWorkMode: (mode: WorkMode) => void;
  setReviewMode: (reviewMode: boolean) => void;
  /** Make `view` the selected one: its imagery nav state and its canvas
   *  windows both come with it, so the whole page belongs to one view. */
  selectView: (view: ImageryViewOut, cat: Catalog, fallbackCollectionId: number | null) => void;
  activateCollection: (collectionId: number, cat: Catalog) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  workMode: 'explore',
  isReviewMode: false,
  selectedViewId: null,

  setWorkMode: (mode) => {
    // Entering Explore also drops any lingering review-mode flag - review is
    // a Tasks-only concept, so carrying it over would trap the UI in it with
    // no way back short of a reload.
    set((s) => ({ workMode: mode, isReviewMode: mode === 'explore' ? false : s.isReviewMode }));
    // Crosshair on for Tasks (point placement), off for Explore (free-form
    // drawing) - routed through imagery's own action, not a raw setState.
    useImageryStore.getState().setCrosshair(mode === 'tasks');
  },

  setReviewMode: (reviewMode) => set({ isReviewMode: reviewMode }),

  selectView: (view, cat, fallbackCollectionId) => {
    const { selectedViewId } = get();
    useImageryStore.getState().switchView(cat, selectedViewId, view.id, fallbackCollectionId);
    useWorkspaceStore.getState().loadViewLayout(view);
    set({ selectedViewId: view.id });
  },

  activateCollection: (collectionId, cat) => {
    useImageryStore.getState().setActiveCollection(cat, collectionId);
  },
}));
