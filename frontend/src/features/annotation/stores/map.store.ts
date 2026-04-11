import { create } from 'zustand';

/**
 * Why the active slice last moved. Consumed by ImageryContainer's empty-slice
 * probe to decide whether (and in which direction) to auto-skip away from a
 * slice that turned out empty.
 *
 *   - 'pick'    : user explicit pick (dropdown / timeline). Do NOT auto-skip.
 *   - 'next'    : A/D hotkey moving forward. On empty, skip forward from here.
 *   - 'prev'    : A/D hotkey moving backward. On empty, skip backward from here.
 *   - 'initial' : task/collection/view change or app boot. Jump to first
 *                 non-empty slice anywhere in the collection ("land on cover").
 */
export type SliceNavIntent = 'pick' | 'next' | 'prev' | 'initial';

interface MapStore {
  // Collection & slice navigation (was window & slice)
  activeCollectionId: number | null;
  activeSliceIndex: number;
  collectionSliceIndices: Record<number, number>;
  emptySlices: Record<string, true>;
  sliceNavIntent: SliceNavIntent;
  viewSnapshots: Record<number, ViewSnapshot>;

  // Layer selection
  selectedLayerIndex: number;
  showBasemap: boolean;
  selectedBasemapId: string | null;

  // Map viewport (synced across all map instances)
  currentMapCenter: [number, number] | null;
  currentMapZoom: number | null;
  currentMapBounds: [number, number, number, number] | null;

  // Triggers (increment to fire action)
  refocusTrigger: number;
  fitAnnotationsTrigger: number;
  zoomInTrigger: number;
  zoomOutTrigger: number;
  panTrigger: { direction: 'up' | 'down' | 'left' | 'right'; count: number };
  panToCenterTrigger: number;
  showCrosshair: boolean;

  // View sync: link small windows' pan/zoom to the main map
  viewSyncEnabled: boolean;
  // Tile preloading: prefetch tiles for other collections and next tasks
  preloadingEnabled: boolean;

  // Active tool
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
  timeseriesPoint: { lat: number; lon: number } | null;
  probeTimeseriesPoint: { lat: number; lon: number } | null;

  // Actions
  setActiveCollectionId: (id: number | null) => void;
  setActiveSliceIndex: (index: number) => void;
  setCollectionSliceIndex: (collectionId: number, index: number) => void;
  setSliceNavIntent: (intent: SliceNavIntent) => void;
  markSliceEmpty: (sliceKey: string) => void;
  clearEmptySlices: () => void;
  saveViewSnapshot: (viewId: number | null) => void;
  restoreViewSnapshot: (viewId: number | null, fallbackCollectionId: number | null) => void;

  setSelectedLayerIndex: (index: number) => void;
  setShowBasemap: (show: boolean) => void;
  setSelectedBasemapId: (id: string | null) => void;

  setMapCenter: (center: [number, number]) => void;
  setMapZoom: (zoom: number) => void;
  setMapBounds: (bounds: [number, number, number, number]) => void;

  triggerRefocus: () => void;
  triggerFitAnnotations: () => void;
  triggerZoomIn: () => void;
  triggerZoomOut: () => void;
  triggerPan: (direction: 'up' | 'down' | 'left' | 'right') => void;
  triggerPanToCenter: (center: [number, number]) => void;
  toggleCrosshair: () => void;

  setActiveTool: (tool: 'pan' | 'annotate' | 'edit' | 'timeseries') => void;
  setTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  setProbeTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  toggleViewSync: () => void;
  togglePreloading: () => void;

  reset: () => void;
}

/** Per-view snapshot of navigation + empty state */
interface ViewSnapshot {
  activeCollectionId: number | null;
  activeSliceIndex: number;
  collectionSliceIndices: Record<number, number>;
  emptySlices: Record<string, true>;
  selectedLayerIndex: number;
}

const initialState = {
  activeCollectionId: null as number | null,
  activeSliceIndex: 0,
  collectionSliceIndices: {} as Record<number, number>,
  emptySlices: {} as Record<string, true>,
  sliceNavIntent: 'initial' as SliceNavIntent,

  /** Saved per-view state so switching views preserves position + empty info */
  viewSnapshots: {} as Record<number, ViewSnapshot>,

  selectedLayerIndex: 0,
  showBasemap: false,
  selectedBasemapId: null as string | null,

  currentMapCenter: null as [number, number] | null,
  currentMapZoom: null as number | null,
  currentMapBounds: null as [number, number, number, number] | null,

  refocusTrigger: 0,
  fitAnnotationsTrigger: 0,
  zoomInTrigger: 0,
  zoomOutTrigger: 0,
  panTrigger: { direction: 'up' as const, count: 0 },
  panToCenterTrigger: 0,
  showCrosshair: true,

  activeTool: 'pan' as const,
  timeseriesPoint: null as { lat: number; lon: number } | null,
  probeTimeseriesPoint: null as { lat: number; lon: number } | null,
  viewSyncEnabled: true,
  preloadingEnabled: true,
};

export const useMapStore = create<MapStore>((set) => ({
  ...initialState,

  setActiveCollectionId: (id) =>
    set((s) => {
      const newIndices = { ...s.collectionSliceIndices };
      if (s.activeCollectionId !== null) {
        newIndices[s.activeCollectionId] = s.activeSliceIndex;
      }
      return {
        activeCollectionId: id,
        activeSliceIndex: id !== null ? (newIndices[id] ?? 0) : 0,
        collectionSliceIndices: newIndices,
        showBasemap: false,
      };
    }),

  setActiveSliceIndex: (index) => set({ activeSliceIndex: index }),

  setCollectionSliceIndex: (collectionId, index) =>
    set((s) => ({
      collectionSliceIndices: { ...s.collectionSliceIndices, [collectionId]: index },
    })),

  setSliceNavIntent: (intent) => set({ sliceNavIntent: intent }),

  markSliceEmpty: (sliceKey) =>
    set((s) => ({ emptySlices: { ...s.emptySlices, [sliceKey]: true } })),

  clearEmptySlices: () => set({ emptySlices: {} }),

  /** Save current view state before switching away */
  saveViewSnapshot: (viewId) => {
    if (viewId === null) return;
    set((s) => ({
      viewSnapshots: {
        ...s.viewSnapshots,
        [viewId]: {
          activeCollectionId: s.activeCollectionId,
          activeSliceIndex: s.activeSliceIndex,
          collectionSliceIndices: { ...s.collectionSliceIndices },
          emptySlices: { ...s.emptySlices },
          selectedLayerIndex: s.selectedLayerIndex,
        },
      },
    }));
  },

  /** Restore saved view state when switching back */
  restoreViewSnapshot: (viewId, fallbackCollectionId) => {
    if (viewId === null) return;
    set((s) => {
      const snap = s.viewSnapshots[viewId];
      if (snap) {
        return {
          activeCollectionId: snap.activeCollectionId,
          activeSliceIndex: snap.activeSliceIndex,
          collectionSliceIndices: snap.collectionSliceIndices,
          emptySlices: snap.emptySlices,
          selectedLayerIndex: snap.selectedLayerIndex,
        };
      }
      return {
        activeCollectionId: fallbackCollectionId,
        activeSliceIndex: 0,
        collectionSliceIndices: {},
        emptySlices: {},
      };
    });
  },

  setSelectedLayerIndex: (index) => set({ selectedLayerIndex: index, showBasemap: false }),
  setShowBasemap: (show) => set({ showBasemap: show }),
  setSelectedBasemapId: (id) => set({ selectedBasemapId: id }),

  setMapCenter: (center) => set({ currentMapCenter: center }),
  setMapZoom: (zoom) => set({ currentMapZoom: zoom }),
  setMapBounds: (bounds) => set({ currentMapBounds: bounds }),

  triggerRefocus: () => set((s) => ({ refocusTrigger: s.refocusTrigger + 1 })),
  triggerFitAnnotations: () => set((s) => ({ fitAnnotationsTrigger: s.fitAnnotationsTrigger + 1 })),
  triggerZoomIn: () => set((s) => ({ zoomInTrigger: s.zoomInTrigger + 1 })),
  triggerZoomOut: () => set((s) => ({ zoomOutTrigger: s.zoomOutTrigger + 1 })),
  triggerPan: (direction) =>
    set((s) => ({ panTrigger: { direction, count: s.panTrigger.count + 1 } })),
  triggerPanToCenter: (center) =>
    set((s) => ({ currentMapCenter: center, panToCenterTrigger: s.panToCenterTrigger + 1 })),
  toggleCrosshair: () => set((s) => ({ showCrosshair: !s.showCrosshair })),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setTimeseriesPoint: (point) => set({ timeseriesPoint: point }),
  setProbeTimeseriesPoint: (point) => set({ probeTimeseriesPoint: point }),

  toggleViewSync: () => set((s) => ({ viewSyncEnabled: !s.viewSyncEnabled })),
  togglePreloading: () => set((s) => ({ preloadingEnabled: !s.preloadingEnabled })),

  reset: () => set(initialState),
}));
