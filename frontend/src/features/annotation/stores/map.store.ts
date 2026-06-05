import { create } from 'zustand';
import { useCampaignStore } from './campaign.store';

/** Resolve a collection's cover slice index from the campaign store. Falls
 *  back to 0 if the collection isn't found (defensive). */
const coverIndexFor = (collectionId: number | null): number => {
  if (collectionId === null) return 0;
  const campaign = useCampaignStore.getState().campaign;
  for (const src of campaign?.imagery_sources ?? []) {
    const col = src.collections.find((c) => c.id === collectionId);
    if (col) return col.cover_slice_index ?? 0;
  }
  return 0;
};

interface MapStore {
  // Collection & slice navigation (was window & slice)
  activeCollectionId: number | null;
  activeSliceIndex: number;
  collectionSliceIndices: Record<number, number>;
  emptySlices: Record<string, true>;
  viewSnapshots: Record<number, ViewSnapshot>;

  // Layer selection
  selectedLayerIndex: number;
  showBasemap: boolean;
  selectedBasemapId: string | null;
  // Per-source memory so cycling I → static → back to a source restores the
  // last collection + visualization the user was on, instead of resetting to
  // the first slice / first viz.
  lastSourceState: Record<number, { collectionId: number; layerIndex: number }>;

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
  showAnnotations: boolean;

  // View sync: link small windows' pan/zoom to the main map
  viewSyncEnabled: boolean;

  // Active tool
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
  timeseriesPoint: { lat: number; lon: number } | null;
  probeTimeseriesPoint: { lat: number; lon: number } | null;
  // True when the chart has hidden the relevant datasets, so the map should
  // suppress the probe marker overlay even though probeTimeseriesPoint is set.
  probeMarkerHidden: boolean;

  // Actions
  setActiveCollectionId: (id: number | null) => void;
  setActiveSliceIndex: (index: number) => void;
  setCollectionSliceIndex: (collectionId: number, index: number) => void;
  markSliceEmpty: (sliceKey: string) => void;
  clearEmptySlices: () => void;
  saveViewSnapshot: (viewId: number | null) => void;
  restoreViewSnapshot: (viewId: number | null, fallbackCollectionId: number | null) => void;

  setSelectedLayerIndex: (index: number) => void;
  setShowBasemap: (show: boolean) => void;
  setSelectedBasemapId: (id: string | null) => void;
  recordSourceState: (sourceId: number, collectionId: number, layerIndex: number) => void;

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
  toggleAnnotations: () => void;

  setActiveTool: (tool: 'pan' | 'annotate' | 'edit' | 'timeseries') => void;
  setTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  setProbeTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  setProbeMarkerHidden: (hidden: boolean) => void;
  toggleViewSync: () => void;

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

  /** Saved per-view state so switching views preserves position + empty info */
  viewSnapshots: {} as Record<number, ViewSnapshot>,

  selectedLayerIndex: 0,
  showBasemap: false,
  selectedBasemapId: null as string | null,
  lastSourceState: {} as Record<number, { collectionId: number; layerIndex: number }>,

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
  showAnnotations: true,

  activeTool: 'pan' as const,
  timeseriesPoint: null as { lat: number; lon: number } | null,
  probeTimeseriesPoint: null as { lat: number; lon: number } | null,
  probeMarkerHidden: false,
  viewSyncEnabled: true,
};

export const useMapStore = create<MapStore>((set) => ({
  ...initialState,

  setActiveCollectionId: (id) =>
    set((s) => ({
      activeCollectionId: id,
      activeSliceIndex: id !== null ? (s.collectionSliceIndices[id] ?? coverIndexFor(id)) : 0,
      showBasemap: false,
    })),

  setActiveSliceIndex: (index) =>
    set((s) => ({
      activeSliceIndex: index,
      collectionSliceIndices:
        s.activeCollectionId !== null
          ? { ...s.collectionSliceIndices, [s.activeCollectionId]: index }
          : s.collectionSliceIndices,
    })),

  setCollectionSliceIndex: (collectionId, index) =>
    set((s) => ({
      collectionSliceIndices: { ...s.collectionSliceIndices, [collectionId]: index },
      // If this collection is the one in the main view, keep activeSliceIndex
      // in sync - the small window and main view are the same surface for it.
      ...(s.activeCollectionId === collectionId ? { activeSliceIndex: index } : {}),
    })),

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
        activeSliceIndex: coverIndexFor(fallbackCollectionId),
        collectionSliceIndices: {},
        emptySlices: {},
      };
    });
  },

  setSelectedLayerIndex: (index) => set({ selectedLayerIndex: index, showBasemap: false }),
  setShowBasemap: (show) => set({ showBasemap: show }),
  setSelectedBasemapId: (id) => set({ selectedBasemapId: id }),

  recordSourceState: (sourceId, collectionId, layerIndex) =>
    set((s) => ({
      lastSourceState: {
        ...s.lastSourceState,
        [sourceId]: { collectionId, layerIndex },
      },
    })),

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
  toggleAnnotations: () => set((s) => ({ showAnnotations: !s.showAnnotations })),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setTimeseriesPoint: (point) => set({ timeseriesPoint: point }),
  setProbeTimeseriesPoint: (point) => set({ probeTimeseriesPoint: point }),
  setProbeMarkerHidden: (hidden) => set({ probeMarkerHidden: hidden }),

  toggleViewSync: () => set((s) => ({ viewSyncEnabled: !s.viewSyncEnabled })),

  reset: () => set(initialState),
}));
