import { create } from 'zustand';
import type { ImageryViewOut } from '~/api/client';
import {
  cycleSource,
  cycleViz,
  jumpToCollection,
  markEmpty as markEmptyKey,
  restoreSnapshot,
  snapshotForView,
  stepCollection,
  stepSlice,
  toggleCycle,
  type Catalog,
  type EmptyKey,
  type ImageryNavState,
  type OverlayAction,
  type SliceAddress,
  type ViewSnapshot,
} from '~/features/annotation/core/catalog';

export interface ImageryState extends ImageryNavState {
  viewSnapshots: Record<number, ViewSnapshot>;
  /** Per-window date selection. This is campaign-scoped imagery state, not a
   * module-global panel cache, so loadCampaign can reset it atomically with
   * the rest of navigation. */
  windowSlices: Record<number, { selected: number; userPicked: number | null }>;
  /** Location whose explicit 204 results populate `empties`. Empty imagery is
   * spatial, so task A's result must not leak into task B's date selector. */
  emptyScope: string | null;

  setAddress: (address: SliceAddress | null) => void;
  rememberWindowSlice: (collectionId: number, sliceIndex: number, byUser?: boolean) => void;
  markEmpty: (key: EmptyKey) => void;
  setEmptyScope: (scope: string | null) => void;
  setShowBasemap: (show: boolean) => void;
  setSelectedBasemapId: (id: string | null) => void;
  setCrosshair: (crosshair: boolean) => void;
  toggleCrosshair: () => void;
  toggleAnnotations: () => void;
  toggleViewSync: () => void;
  /** Custom-map overlay selection: toggle on/off the current pick, cycle to
   *  the next item in `items`, or clear the pick entirely ('deselect' - the
   *  header's "No overlay"). Wraps domain/catalog's toggleCycle. */
  overlayAction: (items: Array<{ id: number }>, action: OverlayAction) => void;
  setOverlayOpacity: (opacity: number) => void;
  /** Same as overlayAction, for the PMTiles vector-layer selection. */
  vectorAction: (items: Array<{ id: number }>, action: OverlayAction) => void;
  cycleSourceAction: (
    cat: Catalog,
    view: Pick<ImageryViewOut, 'source_ids'>,
    dir: 1 | -1,
    lastBySource: Record<number, SliceAddress>
  ) => void;
  cycleVizAction: (cat: Catalog, dir: 1 | -1) => void;
  stepSliceAction: (cat: Catalog, dir: 1 | -1) => void;
  stepCollectionAction: (cat: Catalog, dir: 1 | -1) => void;
  /** Switch the active collection directly (e.g. clicking a window), landing
   *  on its cover slice. Leaves overlay/vector/empties untouched - only the
   *  address changes. */
  setActiveCollection: (cat: Catalog, collectionId: number | null) => void;
  /** Save the outgoing view's nav state under `fromViewId` (skipped when
   *  null, e.g. first view of a session), then restore `toViewId`'s saved
   *  snapshot or a fresh default at `fallbackCollectionId`. */
  switchView: (
    cat: Catalog,
    fromViewId: number | null,
    toViewId: number,
    fallbackCollectionId: number | null
  ) => void;
}

const initialNav: ImageryNavState = {
  address: null,
  showBasemap: false,
  selectedBasemapId: null,
  overlay: { id: null, visible: true },
  overlayOpacity: 1,
  vector: { id: null, visible: true },
  empties: {},
  crosshair: true,
  showAnnotations: true,
  viewSync: true,
};

export const useImageryStore = create<ImageryState>((set) => ({
  ...initialNav,
  viewSnapshots: {},
  windowSlices: {},
  emptyScope: null,

  setAddress: (address) => set({ address }),
  rememberWindowSlice: (collectionId, sliceIndex, byUser = false) =>
    set((s) => ({
      windowSlices: {
        ...s.windowSlices,
        [collectionId]: {
          selected: sliceIndex,
          userPicked: byUser ? sliceIndex : (s.windowSlices[collectionId]?.userPicked ?? null),
        },
      },
    })),
  markEmpty: (key) => set((s) => ({ empties: markEmptyKey(s.empties, key) })),
  setEmptyScope: (emptyScope) =>
    set((s) => (s.emptyScope === emptyScope ? s : { emptyScope, empties: {} })),
  setShowBasemap: (show) => set({ showBasemap: show }),
  setSelectedBasemapId: (id) => set({ selectedBasemapId: id }),
  setCrosshair: (crosshair) => set({ crosshair }),
  toggleCrosshair: () => set((s) => ({ crosshair: !s.crosshair })),
  toggleAnnotations: () => set((s) => ({ showAnnotations: !s.showAnnotations })),
  toggleViewSync: () => set((s) => ({ viewSync: !s.viewSync })),

  overlayAction: (items, action) =>
    set((s) => ({ overlay: toggleCycle(items, s.overlay, action) })),
  setOverlayOpacity: (overlayOpacity) => set({ overlayOpacity }),
  vectorAction: (items, action) => set((s) => ({ vector: toggleCycle(items, s.vector, action) })),

  cycleSourceAction: (cat, view, dir, lastBySource) =>
    set((s) => {
      const result = cycleSource(
        cat,
        view,
        s.address,
        { showBasemap: s.showBasemap, selectedBasemapId: s.selectedBasemapId },
        dir,
        lastBySource
      );
      if (!result) return s;
      return result.kind === 'basemap'
        ? { showBasemap: true, selectedBasemapId: result.basemapId }
        : { address: result.address, showBasemap: false };
    }),

  cycleVizAction: (cat, dir) =>
    set((s) => {
      const next = cycleViz(cat, s.address, dir);
      return next ? { address: next } : s;
    }),

  stepSliceAction: (cat, dir) =>
    set((s) => {
      if (!s.address) return s;
      const next = stepSlice(cat, s.address, dir, s.empties);
      return next ? { address: next } : s;
    }),

  stepCollectionAction: (cat, dir) =>
    set((s) => {
      if (!s.address) return s;
      const next = stepCollection(cat, s.address, dir, s.empties);
      return next ? { address: next } : s;
    }),

  setActiveCollection: (cat, collectionId) =>
    set((s) => ({
      address: collectionId != null ? jumpToCollection(cat, collectionId, s.address) : null,
      showBasemap: false,
    })),

  switchView: (cat, fromViewId, toViewId, fallbackCollectionId) =>
    set((s) => {
      const viewSnapshots =
        fromViewId != null
          ? { ...s.viewSnapshots, [fromViewId]: snapshotForView(s) }
          : s.viewSnapshots;
      const restored = restoreSnapshot(cat, viewSnapshots[toViewId], fallbackCollectionId);
      return { ...restored, viewSnapshots };
    }),
}));
