import { create } from 'zustand';
import type { ImageryViewOut } from '~/api/client';
import { type ImageryCatalog } from '../campaign/imagery';
import {
  emptyKey,
  type Empties,
  type ImageryNavState,
  type SliceAddress,
  type ViewSnapshot,
} from '../campaign/imageryNav';
import { snapshotForView } from '../campaign/imageryNav';
import {
  collectionAddress,
  cycleSource,
  cycleViz,
  restoreSnapshot,
  stepCollectionId,
  stepSlice,
  toggleCycle,
  type OverlayAction,
} from '../campaign/imageryNav';

export interface ImageryState extends ImageryNavState {
  viewSnapshots: Record<number, ViewSnapshot>;
  /** Per-window date selection, campaign-scoped so a load can reset it
   *  atomically with the rest of navigation. */
  windowSlices: Record<number, { selected: number; userPicked: number | null }>;
  /** Location whose 204s populate `empties`. Empty imagery is spatial, so one
   *  task's result must not leak into another's date selector. */
  emptyScope: string | null;

  setAddress: (address: SliceAddress | null) => void;
  rememberWindowSlice: (collectionId: number, sliceIndex: number, byUser?: boolean) => void;
  markEmpty: (collectionId: number, sliceIndex: number) => void;
  setEmptyScope: (scope: string | null) => void;
  /** Start a new task at `collectionId`'s cover slice, clearing every
   *  location-specific cache in one write while keeping campaign-wide layer
   *  choices such as the visualization. */
  resetForTask: (cat: ImageryCatalog, collectionId: number | null, scope: string) => void;
  setShowBasemap: (show: boolean) => void;
  setSelectedBasemapId: (id: string | null) => void;
  setCrosshair: (crosshair: boolean) => void;
  toggleCrosshair: () => void;
  toggleAnnotations: () => void;
  toggleTaskAnnotations: () => void;
  toggleViewSync: () => void;
  overlayAction: (items: Array<{ id: number }>, action: OverlayAction) => void;
  setOverlayOpacity: (opacity: number) => void;
  vectorAction: (items: Array<{ id: number }>, action: OverlayAction) => void;
  cycleSourceAction: (
    cat: ImageryCatalog,
    view: Pick<ImageryViewOut, 'source_ids'>,
    dir: 1 | -1,
    lastBySource: Record<number, SliceAddress>
  ) => void;
  cycleVizAction: (cat: ImageryCatalog, dir: 1 | -1) => void;
  stepSliceAction: (cat: ImageryCatalog, dir: 1 | -1) => void;
  stepCollectionAction: (cat: ImageryCatalog, dir: 1 | -1) => void;
  /** Activate a collection inside the current task, resuming the slice its
   *  window last showed. Task transitions use `resetForTask` instead. */
  activateCollection: (cat: ImageryCatalog, collectionId: number | null) => void;
  switchView: (
    cat: ImageryCatalog,
    fromViewId: number | null,
    toViewId: number,
    fallbackCollectionId: number | null
  ) => void;
  reset: (patch: Partial<ImageryState>) => void;
}

const INITIAL_NAV: ImageryNavState = {
  address: null,
  showBasemap: false,
  selectedBasemapId: null,
  overlay: { id: null, visible: true },
  overlayOpacity: 1,
  vector: { id: null, visible: true },
  empties: {},
  crosshair: true,
  showAnnotations: true,
  showTaskAnnotations: false,
  viewSync: true,
};

/** One landing policy for every within-task collection change, so the picker,
 *  the timeline, the hotkeys and a panel click cannot drift apart. */
function activeAddress(
  cat: ImageryCatalog,
  state: Pick<ImageryState, 'address' | 'windowSlices'>,
  collectionId: number
): SliceAddress | null {
  return collectionAddress(
    cat,
    collectionId,
    state.address,
    state.windowSlices[collectionId]?.selected
  );
}

export const useImageryStore = create<ImageryState>((set) => ({
  ...INITIAL_NAV,
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

  markEmpty: (collectionId, sliceIndex) =>
    set((s) => {
      const key = emptyKey(collectionId, sliceIndex);
      return s.empties[key] ? s : { empties: { ...s.empties, [key]: true } as Empties };
    }),

  setEmptyScope: (emptyScope) =>
    set((s) => (s.emptyScope === emptyScope ? s : { emptyScope, empties: {} })),

  resetForTask: (cat, collectionId, emptyScope) =>
    set((s) => ({
      // Window memory is deliberately dropped: a task transition is the one
      // point where imagery starts from the configured collection default.
      address: collectionId != null ? collectionAddress(cat, collectionId, s.address) : null,
      showBasemap: false,
      empties: {},
      emptyScope,
      viewSnapshots: {},
      windowSlices: {},
    })),

  setShowBasemap: (showBasemap) => set({ showBasemap }),
  setSelectedBasemapId: (selectedBasemapId) => set({ selectedBasemapId }),
  setCrosshair: (crosshair) => set({ crosshair }),
  toggleCrosshair: () => set((s) => ({ crosshair: !s.crosshair })),
  toggleAnnotations: () => set((s) => ({ showAnnotations: !s.showAnnotations })),
  toggleTaskAnnotations: () => set((s) => ({ showTaskAnnotations: !s.showTaskAnnotations })),
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
      const collectionId = stepCollectionId(cat, s.address, dir);
      if (collectionId == null) return s;
      const address = activeAddress(cat, s, collectionId);
      return address ? { address } : s;
    }),

  activateCollection: (cat, collectionId) =>
    set((s) => ({
      address: collectionId != null ? activeAddress(cat, s, collectionId) : null,
      showBasemap: false,
    })),

  switchView: (cat, fromViewId, toViewId, fallbackCollectionId) =>
    set((s) => {
      const viewSnapshots =
        fromViewId != null
          ? { ...s.viewSnapshots, [fromViewId]: snapshotForView(s) }
          : s.viewSnapshots;
      return {
        ...restoreSnapshot(cat, viewSnapshots[toViewId], fallbackCollectionId),
        viewSnapshots,
      };
    }),

  reset: (patch) =>
    set({ ...INITIAL_NAV, viewSnapshots: {}, windowSlices: {}, emptyScope: null, ...patch }),
}));
