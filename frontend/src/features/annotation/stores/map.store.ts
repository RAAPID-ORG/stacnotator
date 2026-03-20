import { create } from 'zustand';

interface MapStore {
  // Collection & slice navigation (was window & slice)
  activeCollectionId: number | null;
  activeSliceIndex: number;
  collectionSliceIndices: Record<number, number>;
  emptySlices: Record<string, true>;

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

  // Active tool
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries';
  timeseriesPoint: { lat: number; lon: number } | null;
  probeTimeseriesPoint: { lat: number; lon: number } | null;

  // Actions
  setActiveCollectionId: (id: number | null) => void;
  setActiveSliceIndex: (index: number) => void;
  setCollectionSliceIndex: (collectionId: number, index: number) => void;
  markSliceEmpty: (sliceKey: string) => void;
  clearEmptySlices: () => void;

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

  reset: () => void;
}

const initialState = {
  activeCollectionId: null as number | null,
  activeSliceIndex: 0,
  collectionSliceIndices: {} as Record<number, number>,
  emptySlices: {} as Record<string, true>,

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
    set((s) => ({ collectionSliceIndices: { ...s.collectionSliceIndices, [collectionId]: index } })),

  markSliceEmpty: (sliceKey) =>
    set((s) => ({ emptySlices: { ...s.emptySlices, [sliceKey]: true } })),

  clearEmptySlices: () => set({ emptySlices: {} }),

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
  triggerPan: (direction) => set((s) => ({ panTrigger: { direction, count: s.panTrigger.count + 1 } })),
  triggerPanToCenter: (center) => set((s) => ({ currentMapCenter: center, panToCenterTrigger: s.panToCenterTrigger + 1 })),
  toggleCrosshair: () => set((s) => ({ showCrosshair: !s.showCrosshair })),

  setActiveTool: (tool) =>
    set({ activeTool: tool, ...(tool !== 'timeseries' ? { probeTimeseriesPoint: null } : {}) }),

  setTimeseriesPoint: (point) => set({ timeseriesPoint: point }),
  setProbeTimeseriesPoint: (point) => set({ probeTimeseriesPoint: point }),

  toggleViewSync: () => set((s) => ({ viewSyncEnabled: !s.viewSyncEnabled })),

  reset: () => set(initialState),
}));
