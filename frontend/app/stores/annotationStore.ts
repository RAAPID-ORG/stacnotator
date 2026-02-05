import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import { DEFAULT_MAP_ZOOM } from '../constants';
import {
  completeAnnotationTask,
  createNewCanvasLayoutForImagery,
  getAllAnnotationTasks,
  getCampaignWithImageryWindows,
  createAnnotation,
  updateAnnotation,
  getAllAnnotationsForCampaign,
  deleteAnnotation,
  type AnnotationTaskItemOut,
  type CampaignOutWithImageryWindows,
  type AnnotationOut,
} from '~/api/client';
import { convertGeoJSONToWKT, convertWKTToGeoJSON } from '~/utils/utility';
import { handleError, handleApiError } from '~/utils/errorHandler';
import { useUIStore } from './uiStore';
import { useUserStore } from './userStore';

/**
 * Task status values
 */
export type TaskStatus = 'pending' | 'done' | 'skipped';

/**
 * Task filter configuration
 */
export interface TaskFilter {
  assignedTo: string[]; // User IDs to filter by, empty array means all users
  statuses: TaskStatus[]; // Task statuses to include
}

/**
 * Store managing all state related to annotation domain
 */
interface AnnotationStore {
  // Campaign data
  campaign: CampaignOutWithImageryWindows | null;
  allTasks: AnnotationTaskItemOut[];
  visibleTasks: AnnotationTaskItemOut[]; // Tasks matching current filter
  currentTaskIndex: number;
  taskFilter: TaskFilter;

  // Open mode annotations
  annotations: AnnotationOut[]; // All annotations in the campaign (for open mode)
  isLoadingAnnotations: boolean;

  // Loading states
  isLoadingCampaign: boolean;
  isSubmitting: boolean;
  isNavigating: boolean; // True during task navigation to prevent premature submissions

  // Layout management
  currentLayout: Layout | null;
  savedLayout: Layout | null;
  isEditingLayout: boolean;

  // Imagery and layer selection
  selectedImageryId: number | null;
  selectedLayerIndex: number;
  showBasemap: boolean;
  basemapType: 'carto-light' | 'esri-world-imagery' | 'opentopomap';
  activeWindowId: number | null;
  activeSliceIndex: number;
  windowSliceIndices: Record<number, number>; // Per-window slice indices
  refocusTrigger: number;

  // Map control triggers (increment to trigger action)
  zoomInTrigger: number;
  zoomOutTrigger: number;
  panTrigger: { direction: 'up' | 'down' | 'left' | 'right'; count: number };
  showCrosshair: boolean; // Toggle crosshair visibility on maps

  // Synchronized map state (used for both open mode and task mode)
  currentMapCenter: [number, number] | null; // Current center of the main map [lat, lon]
  currentMapZoom: number | null; // Current zoom level (persists across slice/window changes, resets on task navigation)
  currentMapBounds: [number, number, number, number] | null; // Current visible bounds [west, south, east, north]

  // Annotation form state
  selectedLabelId: number | null;
  comment: string;
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries'; // Active tool for open mode
  timeseriesPoint: { lat: number; lon: number } | null; // Point for timeseries in open mode
  magicWandEnabled: Record<number, boolean>; // Track which labels have magic wand enabled (labelId -> boolean)

  // Computed getters
  // NOTE: Components should compute currentTask directly as visibleTasks[currentTaskIndex]
  // to ensure coordinate synchronization across all components
  selectedImagery: () => CampaignOutWithImageryWindows['imagery'][number] | null;
  completedTasksCount: () => number;
  campaignBbox: () => [number, number, number, number] | null;

  // Data actions
  loadCampaign: (campaignId: number) => Promise<void>;
  submitAnnotation: (labelId: number | null, comment: string) => Promise<void>;
  nextTask: () => void;
  previousTask: () => void;
  goToTask: (annotationNumber: number) => void;

  // UI actions
  setCurrentLayout: (layout: Layout) => void;
  setSavedLayout: (layout: Layout) => void;
  setIsEditingLayout: (isEditing: boolean) => void;
  saveLayout: (shouldBeDefault?: boolean) => Promise<void>;
  cancelLayoutEdit: () => void;
  resetLayout: (defaultLayout: Layout) => void;
  setSelectedImageryId: (id: number | null) => void;
  setSelectedLayerIndex: (index: number) => void;
  setShowBasemap: (show: boolean) => void;
  setBasemapType: (type: 'carto-light' | 'esri-world-imagery' | 'opentopomap') => void;
  setActiveWindowId: (id: number | null) => void;
  setActiveSliceIndex: (index: number) => void;
  setWindowSliceIndex: (windowId: number, index: number) => void;
  triggerRefocus: () => void;
  toggleCrosshair: () => void;

  // Map control actions
  triggerZoomIn: () => void;
  triggerZoomOut: () => void;
  triggerPan: (direction: 'up' | 'down' | 'left' | 'right') => void;

  // Synchronized map actions (used for both modes)
  setMapCenter: (center: [number, number]) => void;
  setMapZoom: (zoom: number) => void;
  setMapBounds: (bounds: [number, number, number, number]) => void;

  // Annotation form actions
  setSelectedLabelId: (id: number | null) => void;
  setComment: (comment: string) => void;
  setActiveTool: (tool: 'pan' | 'annotate' | 'edit' | 'timeseries') => void;
  setTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  toggleMagicWand: (labelId: number) => void; // Toggle magic wand for a specific label
  resetAnnotationForm: () => void;

  // Open mode annotation actions
  loadAnnotations: () => Promise<void>;
  saveAnnotation: (
    geometry: GeoJSON.Geometry,
    labelId: number,
    comment?: string | null
  ) => Promise<AnnotationOut | null>;
  updateAnnotationGeometry: (annotationId: number, geometry: GeoJSON.Geometry) => Promise<void>;
  deleteAnnotation: (annotationId: number) => Promise<void>;

  // Task filter actions
  setTaskFilter: (filter: Partial<TaskFilter>) => void;
  resetTaskFilter: () => void;

  // Reset
  reset: () => void;
}

const initialState = {
  campaign: null,
  allTasks: [],
  visibleTasks: [],
  currentTaskIndex: 0,
  taskFilter: {
    assignedTo: [], // Empty means filter by current user by default (set on load)
    statuses: ['pending' as TaskStatus],
  },
  annotations: [],
  isLoadingAnnotations: false,
  isLoadingCampaign: false,
  isSubmitting: false,
  isNavigating: false,
  currentLayout: null,
  savedLayout: null,
  isEditingLayout: false,
  selectedImageryId: null,
  selectedLayerIndex: 0,
  showBasemap: false,
  basemapType: 'carto-light' as const,
  activeWindowId: null,
  activeSliceIndex: 0,
  windowSliceIndices: {} as Record<number, number>,
  refocusTrigger: 0,
  zoomInTrigger: 0,
  zoomOutTrigger: 0,
  panTrigger: { direction: 'up' as const, count: 0 },
  showCrosshair: true,
  currentMapCenter: null,
  currentMapZoom: null,
  currentMapBounds: null,
  selectedLabelId: null,
  comment: '',
  activeTool: 'pan' as const,
  timeseriesPoint: null,
  magicWandEnabled: {} as Record<number, boolean>,
};

/**
 * Apply task filter to get visible tasks
 */
const applyTaskFilter = (
  allTasks: AnnotationTaskItemOut[],
  filter: TaskFilter
): AnnotationTaskItemOut[] => {
  return allTasks.filter((task) => {
    // Filter by assignment (empty array means all users)
    const matchesAssignment =
      filter.assignedTo.length === 0 ||
      filter.assignedTo.includes(task.assigned_user?.id || '');

    // Filter by status
    const matchesStatus = filter.statuses.includes(task.status as TaskStatus);

    return matchesAssignment && matchesStatus;
  });
};

export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  ...initialState,

  // Computed getters
  selectedImagery: () => {
    const { campaign, selectedImageryId } = get();
    return campaign?.imagery.find((img) => img.id === selectedImageryId) || null;
  },

  completedTasksCount: () => {
    const { allTasks } = get();
    return allTasks.filter((task) => task.status === 'done').length;
  },

  campaignBbox: () => {
    const { campaign } = get();
    if (!campaign) return null;
    return [
      campaign.settings.bbox_west,
      campaign.settings.bbox_south,
      campaign.settings.bbox_east,
      campaign.settings.bbox_north,
    ];
  },

  // Data actions
  loadCampaign: async (campaignId: number) => {
    set({ isLoadingCampaign: true });

    try {
      // Load campaign, tasks, and current user in parallel
      const [campaignResponse, tasksResponse, _currentUser] = await Promise.all([
        getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
        getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
        useUserStore.getState().getCurrentUser(),
      ]);

      const campaign = campaignResponse.data!;
      const allTasks = tasksResponse.data!.tasks;
      const currentUserId = useUserStore.getState().getCurrentUserId();

      // Initialize task filter with current user
      const taskFilter: TaskFilter = {
        assignedTo: currentUserId ? [currentUserId] : [],
        statuses: ['pending'],
      };

      const visibleTasks = applyTaskFilter(allTasks, taskFilter);

      // Set initial imagery selection
      const selectedImageryId = campaign.imagery.length > 0 ? campaign.imagery[0].id : null;

      // Set initial active window ID from the first imagery's default
      const firstImagery = campaign.imagery[0];
      const activeWindowId =
        firstImagery?.default_main_window_id ?? firstImagery?.windows[0]?.id ?? null;

      // Set initial layout - prefer personal layout over default
      const mainLayout = (campaign.personal_main_canvas_layout?.layout_data ||
        campaign.default_main_canvas_layout?.layout_data) as unknown as Layout;
      const imageryLayout = (firstImagery?.personal_canvas_layout?.layout_data ||
        firstImagery?.default_canvas_layout?.layout_data) as unknown as Layout | undefined;
      const mergedLayout = imageryLayout ? [...mainLayout, ...imageryLayout] : mainLayout;

      // Initialize map center/zoom for open mode using campaign bbox center
      let initialMapCenter: [number, number] | null = null;
      let initialMapZoom: number | null = null;
      if (campaign.mode === 'open') {
        const bboxCenter: [number, number] = [
          (campaign.settings.bbox_south + campaign.settings.bbox_north) / 2,
          (campaign.settings.bbox_west + campaign.settings.bbox_east) / 2,
        ];
        initialMapCenter = bboxCenter;
        initialMapZoom = firstImagery?.default_zoom ?? DEFAULT_MAP_ZOOM;
      }

      set({
        campaign,
        allTasks,
        visibleTasks,
        taskFilter,
        currentTaskIndex: 0,
        selectedImageryId,
        activeWindowId,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
        currentMapCenter: initialMapCenter,
        currentMapZoom: initialMapZoom,
        currentMapBounds: null,
        isLoadingCampaign: false,
      });

      // Load annotations if in open mode
      if (campaign.mode === 'open') {
        await get().loadAnnotations();
      }
    } catch (error) {
      handleApiError(error, 'Campaign load error', {
        defaultMessage: 'Failed to load campaign',
      });
      set({ isLoadingCampaign: false });
    }
  },

  submitAnnotation: async (labelId: number | null, comment: string) => {
    const { campaign, visibleTasks, allTasks, currentTaskIndex, taskFilter } = get();
    const task = visibleTasks[currentTaskIndex];

    if (!task || !campaign) return;

    set({ isSubmitting: true });

    try {
      let annotationData = null;
      let newStatus: 'pending' | 'done' | 'skipped';

      // If labelId is null and task has an annotation, delete it
      if (labelId === null && task.annotation !== null) {
        await deleteAnnotation({
          path: {
            campaign_id: campaign.id,
            annotation_id: task.annotation.id,
          },
        });
        annotationData = null;
        newStatus = 'pending';
        useUIStore.getState().showAlert('Annotation removed successfully', 'success');
      } else {
        // Otherwise, create/update the annotation
        const response = await completeAnnotationTask({
          path: {
            campaign_id: campaign.id,
            annotation_task_id: task.id,
          },
          body: {
            label_id: labelId,
            comment: comment || null,
          },
        });

        annotationData = response.data ?? null;
        newStatus = 'done';
        useUIStore.getState().showAlert('Annotation submitted successfully', 'success');
      }

      // Update local state with the annotation data from the server
      const updatedTasks = allTasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status: newStatus,
              annotation: annotationData,
            }
          : t
      );

      const updatedVisibleTasks = applyTaskFilter(updatedTasks, taskFilter);

      set({
        allTasks: updatedTasks,
        visibleTasks: updatedVisibleTasks,
        isSubmitting: false,
        // Move to next task or loop to first
        currentTaskIndex:
          currentTaskIndex < updatedVisibleTasks.length - 1 ? currentTaskIndex + 1 : 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit annotation';
      useUIStore.getState().showAlert(message, 'error');
      set({ isSubmitting: false });
      console.error('Submit error:', error);
    }
  },

  nextTask: () => {
    const { visibleTasks, currentTaskIndex, campaign, selectedImageryId } = get();
    if (visibleTasks.length === 0) return;

    // Get default window for current imagery
    const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId);
    const defaultWindowId =
      selectedImagery?.default_main_window_id ?? selectedImagery?.windows[0]?.id ?? null;

    // Set navigating flag and clear form immediately
    set({
      isNavigating: true,
      currentTaskIndex: currentTaskIndex >= visibleTasks.length - 1 ? 0 : currentTaskIndex + 1,
      activeWindowId: defaultWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
      selectedLabelId: null,
      comment: '',
      currentMapZoom: null,
    });

    // Clear navigating flag after a delay to allow maps to update
    setTimeout(() => {
      set({ isNavigating: false });
    }, 500);
  },

  previousTask: () => {
    const { visibleTasks, currentTaskIndex, campaign, selectedImageryId } = get();
    if (visibleTasks.length === 0) return;

    // Get default window for current imagery
    const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId);
    const defaultWindowId =
      selectedImagery?.default_main_window_id ?? selectedImagery?.windows[0]?.id ?? null;

    // Set navigating flag and clear form immediately
    set({
      isNavigating: true,
      currentTaskIndex: currentTaskIndex === 0 ? visibleTasks.length - 1 : currentTaskIndex - 1,
      activeWindowId: defaultWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
      selectedLabelId: null,
      comment: '',
      currentMapZoom: null,
    });

    // Clear navigating flag after a delay to allow maps to update
    setTimeout(() => {
      set({ isNavigating: false });
    }, 500);
  },

  goToTask: (annotationNumber: number) => {
    const { visibleTasks, campaign, selectedImageryId } = get();
    // Find the task with the matching annotation_number
    const taskIndex = visibleTasks.findIndex((task) => task.annotation_number === annotationNumber);

    if (taskIndex !== -1) {
      // Get default window for current imagery
      const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId);
      const defaultWindowId =
        selectedImagery?.default_main_window_id ?? selectedImagery?.windows[0]?.id ?? null;

      // Set navigating flag and clear form immediately
      set({
        isNavigating: true,
        currentTaskIndex: taskIndex,
        activeWindowId: defaultWindowId,
        activeSliceIndex: 0,
        windowSliceIndices: {},
        selectedLabelId: null,
        comment: '',
        currentMapZoom: null,
      });

      // Clear navigating flag after a delay to allow maps to update
      setTimeout(() => {
        set({ isNavigating: false });
      }, 500);
    }
  },

  // UI actions
  setCurrentLayout: (layout) => set({ currentLayout: layout }),

  setSavedLayout: (layout) => set({ savedLayout: layout }),

  setIsEditingLayout: (isEditing) => set({ isEditingLayout: isEditing }),

  saveLayout: async (shouldBeDefault = false) => {
    const { campaign, currentLayout, selectedImageryId } = get();

    if (!campaign || !currentLayout || selectedImageryId === null) {
      useUIStore.getState().showAlert('Cannot save layout: missing campaign or imagery', 'error');
      return;
    }

    try {
      // Separate main layout items from imagery layout items
      const mainLayoutItems = currentLayout.filter(
        (item) => item.i === 'main' || item.i === 'timeseries' || item.i === 'minimap'
      );
      const imageryLayoutItems = currentLayout.filter(
        (item) => item.i !== 'main' && item.i !== 'timeseries' && item.i !== 'minimap'
      );

      // Save to backend
      await createNewCanvasLayoutForImagery({
        path: { campaign_id: campaign.id },
        body: {
          imagery_id: selectedImageryId,
          should_be_default: shouldBeDefault,
          layout: {
            main_layout_data: mainLayoutItems,
            imagery_layout_data: imageryLayoutItems.length > 0 ? imageryLayoutItems : null,
            imagery_id: selectedImageryId,
          },
        },
      });

      const layoutType = shouldBeDefault ? 'default' : 'personal';
      useUIStore.getState().showAlert(`Layout saved successfully as ${layoutType}`, 'success');

      set({
        savedLayout: currentLayout,
        isEditingLayout: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save layout';
      useUIStore.getState().showAlert(message, 'error');
      console.error('Save layout error:', error);
    }
  },

  cancelLayoutEdit: () => {
    const { savedLayout } = get();
    set({
      currentLayout: savedLayout,
      isEditingLayout: false,
    });
  },

  resetLayout: (defaultLayout) => {
    set({
      currentLayout: defaultLayout,
      savedLayout: defaultLayout,
    });
  },

  setSelectedImageryId: (id) => {
    const { campaign, activeWindowId, selectedImageryId: currentImageryId } = get();
    if (!campaign) return;

    set({ selectedImageryId: id });

    // Update layout when imagery changes - prefer personal layout over default
    const mainLayout = (campaign.personal_main_canvas_layout?.layout_data ||
      campaign.default_main_canvas_layout?.layout_data) as unknown as Layout;
    const imagery = campaign.imagery.find((img) => img.id === id);
    const imageryLayout = (imagery?.personal_canvas_layout?.layout_data ||
      imagery?.default_canvas_layout?.layout_data) as unknown as Layout | undefined;
    const mergedLayout = imageryLayout ? [...mainLayout, ...imageryLayout] : mainLayout;

    // Find the closest matching window in the new imagery
    let newActiveWindowId = imagery?.default_main_window_id ?? imagery?.windows[0]?.id ?? null;

    if (activeWindowId !== null && imagery) {
      // Get the current active window from the old imagery
      const oldImagery = campaign.imagery.find((img) => img.id === currentImageryId);
      const currentWindow = oldImagery?.windows.find((w) => w.id === activeWindowId);

      if (currentWindow) {
        // Find the window with the closest date range in the new imagery
        const currentStartDate = new Date(currentWindow.window_start_date);
        const currentEndDate = new Date(currentWindow.window_end_date);
        const currentMidpoint = (currentStartDate.getTime() + currentEndDate.getTime()) / 2;

        let closestWindow = imagery.windows[0];
        let smallestDiff = Number.MAX_SAFE_INTEGER;

        for (const window of imagery.windows) {
          const windowStartDate = new Date(window.window_start_date);
          const windowEndDate = new Date(window.window_end_date);
          const windowMidpoint = (windowStartDate.getTime() + windowEndDate.getTime()) / 2;

          // Calculate the difference between midpoints
          const diff = Math.abs(windowMidpoint - currentMidpoint);

          if (diff < smallestDiff) {
            smallestDiff = diff;
            closestWindow = window;
          }
        }

        newActiveWindowId = closestWindow.id;
      }
    }

    set({
      currentLayout: mergedLayout,
      savedLayout: mergedLayout,
      activeWindowId: newActiveWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
    });
  },

  setSelectedLayerIndex: (index) =>
    set({
      selectedLayerIndex: index,
      showBasemap: false,
    }),

  setShowBasemap: (show) => set({ showBasemap: show }),

  setBasemapType: (type) => set({ basemapType: type }),

  setActiveWindowId: (id) =>
    set((state) => {
      // Save current window's slice index before switching
      const newWindowSliceIndices = { ...state.windowSliceIndices };
      if (state.activeWindowId !== null) {
        newWindowSliceIndices[state.activeWindowId] = state.activeSliceIndex;
      }
      // Restore the new window's slice index (or default to 0)
      const newSliceIndex = id !== null ? (newWindowSliceIndices[id] ?? 0) : 0;
      return {
        activeWindowId: id,
        activeSliceIndex: newSliceIndex,
        windowSliceIndices: newWindowSliceIndices,
      };
    }),

  setActiveSliceIndex: (index) => set({ activeSliceIndex: index }),

  setWindowSliceIndex: (windowId, index) =>
    set((state) => ({
      windowSliceIndices: { ...state.windowSliceIndices, [windowId]: index },
    })),

  triggerRefocus: () => set((state) => ({ refocusTrigger: state.refocusTrigger + 1 })),

  toggleCrosshair: () => set((state) => ({ showCrosshair: !state.showCrosshair })),

  // Map control actions
  triggerZoomIn: () => set((state) => ({ zoomInTrigger: state.zoomInTrigger + 1 })),

  triggerZoomOut: () => set((state) => ({ zoomOutTrigger: state.zoomOutTrigger + 1 })),

  triggerPan: (direction) =>
    set((state) => ({
      panTrigger: { direction, count: state.panTrigger.count + 1 },
    })),

  // Synchronized map actions (used for both modes)
  setMapCenter: (center) => set({ currentMapCenter: center }),

  setMapZoom: (zoom) => set({ currentMapZoom: zoom }),

  setMapBounds: (bounds) => set({ currentMapBounds: bounds }),

  // Annotation form actions
  setSelectedLabelId: (id) => set({ selectedLabelId: id }),

  setComment: (comment) => set({ comment }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setTimeseriesPoint: (point) => set({ timeseriesPoint: point }),

  toggleMagicWand: (labelId) =>
    set((state) => ({
      magicWandEnabled: {
        ...state.magicWandEnabled,
        [labelId]: !state.magicWandEnabled[labelId],
      },
    })),

  resetAnnotationForm: () => set({ selectedLabelId: null, comment: '' }),

  // Task filter actions
  setTaskFilter: (filterUpdate: Partial<TaskFilter>) => {
    const { allTasks, taskFilter } = get();
    
    // Merge with existing filter
    const newFilter: TaskFilter = {
      ...taskFilter,
      ...filterUpdate,
    };

    const visibleTasks = applyTaskFilter(allTasks, newFilter);

    // Set navigating flag and clear form when filter changes
    set({
      isNavigating: true,
      taskFilter: newFilter,
      visibleTasks,
      currentTaskIndex: 0,
      selectedLabelId: null,
      comment: '',
    });

    // Clear navigating flag after a delay to allow maps to update
    setTimeout(() => {
      set({ isNavigating: false });
    }, 500);
  },

  resetTaskFilter: () => {
    const currentUserId = useUserStore.getState().getCurrentUserId();
    const defaultFilter: TaskFilter = {
      assignedTo: currentUserId ? [currentUserId] : [],
      statuses: ['pending'],
    };
    
    get().setTaskFilter(defaultFilter);
  },

  // Open mode annotation actions
  loadAnnotations: async () => {
    const { campaign } = get();
    if (!campaign || campaign.mode !== 'open') return;

    set({ isLoadingAnnotations: true });

    try {
      const response = await getAllAnnotationsForCampaign({
        path: { campaign_id: campaign.id },
      });

      const annotations = response.data || [];

      set({ annotations, isLoadingAnnotations: false });
    } catch (error) {
      handleApiError(error, 'Load annotations error', {
        defaultMessage: 'Failed to load annotations',
      });
      set({ isLoadingAnnotations: false });
    }
  },
  saveAnnotation: async (
    geometry: GeoJSON.Geometry,
    labelId: number,
    comment: string | null = null
  ) => {
    const { campaign } = get();
    if (!campaign) return null;

    set({ isSubmitting: true });

    try {
      const wktGeometry = convertGeoJSONToWKT(geometry);

      const response = await createAnnotation({
        path: { campaign_id: campaign.id },
        body: {
          label_id: labelId,
          comment: comment,
          geometry_wkt: wktGeometry,
        },
      });

      const annotation = response.data!;

      // Add to local state
      set((state) => ({
        annotations: [...state.annotations, annotation],
        isSubmitting: false,
      }));

      useUIStore.getState().showAlert('Annotation saved successfully', 'success');
      return annotation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save annotation';
      useUIStore.getState().showAlert(message, 'error');
      set({ isSubmitting: false });
      console.error('Save annotation error:', error);
      return null;
    }
  },

  updateAnnotationGeometry: async (annotationId: number, geometry: GeoJSON.Geometry) => {
    const { campaign, annotations } = get();
    if (!campaign) return;

    // Find the annotation to get its current label and comment
    const annotation = annotations.find((a) => a.id === annotationId);
    if (!annotation) return;

    set({ isSubmitting: true });

    try {
      const wktGeometry = convertGeoJSONToWKT(geometry);

      const response = await updateAnnotation({
        path: {
          campaign_id: campaign.id,
          annotation_id: annotationId,
        },
        body: {
          label_id: annotation.label_id,
          comment: annotation.comment,
          geometry_wkt: wktGeometry,
        },
      });

      const updatedAnnotation = response.data!;

      // Update local state
      set((state) => ({
        annotations: state.annotations.map((a) => (a.id === annotationId ? updatedAnnotation : a)),
        isSubmitting: false,
      }));

      useUIStore.getState().showAlert('Annotation updated successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update annotation';
      useUIStore.getState().showAlert(message, 'error');
      set({ isSubmitting: false });
      console.error('Update annotation error:', error);
      throw error; // Re-throw to allow rollback handling
    }
  },

  deleteAnnotation: async (annotationId: number) => {
    const { campaign } = get();
    if (!campaign) return;

    set({ isSubmitting: true });

    try {
      await deleteAnnotation({
        path: {
          campaign_id: campaign.id,
          annotation_id: annotationId,
        },
      });

      set((state) => ({
        annotations: state.annotations.filter((a) => a.id !== annotationId),
        isSubmitting: false,
      }));

      useUIStore.getState().showAlert('Annotation deleted successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete annotation';
      useUIStore.getState().showAlert(message, 'error');
      set({ isSubmitting: false });
      console.error('Delete annotation error:', error);
    }
  },

  reset: () => {
    useUserStore.getState().clearUser(); // Clear user cache on reset
    set(initialState);
  },
}));

export default useAnnotationStore;
