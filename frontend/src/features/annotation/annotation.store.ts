import { create } from 'zustand';
import type { Layout } from 'react-grid-layout';
import { DEFAULT_MAP_ZOOM } from '../../shared/utils/constants';
import {
  completeAnnotationTask,
  createNewCanvasLayoutForImagery,
  getAllAnnotationTasks,
  getCampaignWithImageryWindows,
  getCampaignUsers,
  createAnnotationOpenmode,
  updateAnnotationOpenmode,
  getAllAnnotationsForCampaign,
  deleteAnnotation,
  validateAnnotationSubmission,
  type AnnotationTaskOut,
  type CampaignOutWithImageryWindows,
  type AnnotationOut,
} from '~/api/client';
import { useLayoutStore } from '../layout/layout.store';
import { useAccountStore } from '../account/account.store';
import { handleApiError } from '~/shared/utils/errorHandler';
import { convertGeoJSONToWKT } from '~/shared/utils/utility';

/**
 * Task status values for filtering.
 * These match the backend-computed task_status values on AnnotationTaskOut.
 */
export type TaskStatus = 'pending' | 'partial' | 'done' | 'skipped' | 'conflicting';

/**
 * Task filter configuration
 */
export interface TaskFilter {
  assignedTo: string[]; // User IDs to filter by, empty array means all possible users
  statuses: TaskStatus[]; // Task statuses to include
}

/**
 * Store managing all state related to annotation domain
 */
interface AnnotationStore {
  // Campaign data
  campaign: CampaignOutWithImageryWindows | null;
  allTasks: AnnotationTaskOut[];
  visibleTasks: AnnotationTaskOut[]; // Tasks matching current filter
  currentTaskIndex: number;
  taskFilter: TaskFilter;

  // Open mode annotations
  annotations: AnnotationOut[]; // All annotations in the campaign (for open mode)
  isLoadingAnnotations: boolean;

  // Loading states
  isLoadingCampaign: boolean;
  isSubmitting: boolean;
  isNavigating: boolean; // True during task navigation to prevent premature submissions
  isReviewMode: boolean; // True when navigated from review page - shows all annotators' annotations
  isAuthoritativeReviewer: boolean; // True if current user is an authoritative reviewer for this campaign

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
  confidence: number; // Confidence level 0-5, default 5
  activeTool: 'pan' | 'annotate' | 'edit' | 'timeseries'; // Active tool for open mode
  timeseriesPoint: { lat: number; lon: number } | null; // Point for timeseries in open mode
  probeTimeseriesPoint: { lat: number; lon: number } | null; // Probe point for additional timeseries in task mode
  magicWandEnabled: Record<number, boolean>; // Track which labels have magic wand enabled (labelId -> boolean)
  knnValidationEnabled: boolean; // Whether to run KNN validation before submission
  skipConfirmDisabled: boolean; // Whether to skip the confirmation dialog when skipping annotations

  // Computed getters
  // NOTE: Components should compute currentTask directly as visibleTasks[currentTaskIndex]
  // to ensure coordinate synchronization across all components
  selectedImagery: () => CampaignOutWithImageryWindows['imagery'][number] | null;
  completedTasksCount: () => number;
  campaignBbox: () => [number, number, number, number] | null;

  // Data actions
  loadCampaign: (
    campaignId: number,
    initialTaskId?: number,
    isReviewMode?: boolean
  ) => Promise<void>;
  submitAnnotation: (
    labelId: number | null,
    comment: string,
    confidence: number,
    isAuthoritative?: boolean
  ) => Promise<void>;
  nextTask: () => void;
  previousTask: () => void;
  goToTask: (annotationNumber: number) => void;
  goToTaskById: (taskId: number, options?: { resetFilters?: boolean }) => void; // Navigate to a task by its database ID. resetFilters=true widens filter to all users/statuses (e.g. from review page)

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
  setConfidence: (confidence: number) => void;
  setActiveTool: (tool: 'pan' | 'annotate' | 'edit' | 'timeseries') => void;
  setTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  setProbeTimeseriesPoint: (point: { lat: number; lon: number } | null) => void;
  toggleMagicWand: (labelId: number) => void; // Toggle magic wand for a specific label
  setKnnValidationEnabled: (enabled: boolean) => void;
  setSkipConfirmDisabled: (disabled: boolean) => void;
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
  isReviewMode: false,
  isAuthoritativeReviewer: false,
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
  confidence: 5, // Default confidence level
  activeTool: 'pan' as const,
  timeseriesPoint: null,
  probeTimeseriesPoint: null,
  magicWandEnabled: {} as Record<number, boolean>,
  knnValidationEnabled: false,
  skipConfirmDisabled: false,
};

/**
 * Apply task filter to get visible tasks.
 *
 * When filtering by specific users (assignedTo is set), we filter by the
 * user's **assignment status** (pending/done/skipped) since the user cares
 * about their own work, not the overall task status.
 *
 * When showing all users (assignedTo is empty, e.g. review mode), we filter
 * by the backend-computed **task_status** (pending/partial/done/skipped/conflicting).
 */
const applyTaskFilter = (
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter
): AnnotationTaskOut[] => {
  const filterByUser = filter.assignedTo.length > 0;

  return allTasks.filter((task) => {
    const assignments = task.assignments || [];

    if (filterByUser) {
      // Filter by specific users: match tasks where at least one of the
      // selected users has an assignment whose status matches the filter.
      const userAssignments = assignments.filter((a) =>
        filter.assignedTo.includes(a.user_id)
      );
      if (userAssignments.length === 0) return false;
      return userAssignments.some((a) =>
        filter.statuses.includes(a.status as TaskStatus)
      );
    } else {
      // No user filter (review mode / all users): use task-level status
      return filter.statuses.includes(task.task_status as TaskStatus);
    }
  });
};

/**
 * Get form state (label, comment, confidence) from the current user's annotation on a task.
 * Returns defaults if the user hasn't annotated the task yet.
 */
const getFormStateForTask = (
  task: AnnotationTaskOut | null
): {
  selectedLabelId: number | null;
  comment: string;
  confidence: number;
} => {
  if (!task) return { selectedLabelId: null, comment: '', confidence: 5 };
  const currentUserId = useAccountStore.getState().account?.id;
  if (!currentUserId) return { selectedLabelId: null, comment: '', confidence: 5 };
  const userAnnotation = task.annotations.find((a) => a.created_by_user_id === currentUserId);
  if (userAnnotation) {
    return {
      selectedLabelId: userAnnotation.label_id,
      comment: userAnnotation.comment || '',
      confidence: userAnnotation.confidence ?? 5,
    };
  }
  return { selectedLabelId: null, comment: '', confidence: 5 };
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
    return allTasks.filter(
      (task) => task.task_status === 'done' || task.task_status === 'conflicting'
    ).length;
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
  loadCampaign: async (campaignId: number, initialTaskId?: number, isReviewMode?: boolean) => {
    set({ isLoadingCampaign: true });

    try {
      // Load campaign, tasks, and campaign users in parallel
      const [campaignResponse, tasksResponse, usersResponse] = await Promise.all([
        getCampaignWithImageryWindows({ path: { campaign_id: campaignId } }),
        getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
        getCampaignUsers({ path: { campaign_id: campaignId } }),
      ]);

      const campaign = campaignResponse.data!;
      const allTasks = tasksResponse.data!.tasks;
      const campaignUsers = usersResponse.data?.users ?? [];
      // Account is already loaded by AuthGate - just read from the store
      const currentUserId = useAccountStore.getState().account?.id;

      // Check if current user is an authoritative reviewer for this campaign
      const currentCampaignUser = campaignUsers.find((cu) => cu.user.id === currentUserId);
      const isAuthoritativeReviewer = currentCampaignUser?.is_authorative_reviewer ?? false;

      // If navigating to a specific task (e.g. from review page), use a wide filter
      // so the target task is guaranteed to be visible. Otherwise use the default filter.
      let taskFilter: TaskFilter;
      let visibleTasks: AnnotationTaskOut[];
      let currentTaskIndex = 0;

      if (initialTaskId !== undefined) {
        taskFilter = {
          assignedTo: [],
          statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
        };
        visibleTasks = applyTaskFilter(allTasks, taskFilter);
        const targetIndex = visibleTasks.findIndex((t) => t.id === initialTaskId);
        currentTaskIndex = targetIndex !== -1 ? targetIndex : 0;
      } else {
        taskFilter = {
          assignedTo: currentUserId ? [currentUserId] : [],
          statuses: ['pending'],
        };
        visibleTasks = applyTaskFilter(allTasks, taskFilter);
      }

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

      // Populate form from the target task's existing annotation (if any)
      const targetTask = visibleTasks[currentTaskIndex] || null;

      set({
        campaign,
        allTasks,
        visibleTasks,
        taskFilter,
        currentTaskIndex,
        selectedImageryId,
        activeWindowId,
        currentLayout: mergedLayout,
        savedLayout: mergedLayout,
        currentMapCenter: initialMapCenter,
        currentMapZoom: initialMapZoom,
        currentMapBounds: null,
        isLoadingCampaign: false,
        isReviewMode: isReviewMode ?? false,
        isAuthoritativeReviewer,
        ...getFormStateForTask(targetTask),
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

  submitAnnotation: async (
    labelId: number | null,
    comment: string,
    confidence: number,
    isAuthoritative?: boolean
  ) => {
    const { campaign, visibleTasks, allTasks, currentTaskIndex, taskFilter } = get();
    const task = visibleTasks[currentTaskIndex];
    const currentUserId = useAccountStore.getState().account?.id;

    if (!task || !campaign || !currentUserId) return;

    set({ isSubmitting: true });

    try {
      // Find the current user's annotation for this task (if any)
      const userAnnotation = task.annotations.find((a) => a.created_by_user_id === currentUserId);
      const hasExistingLabel = userAnnotation?.label_id != null;

      // "Remove Label" action: user explicitly clears their labeled annotation
      // Only triggers when user has a labeled annotation and submits with no label AND no comment
      if (labelId === null && hasExistingLabel && !comment) {
        const deleteResponse = await deleteAnnotation({
          path: {
            campaign_id: campaign.id,
            annotation_id: userAnnotation!.id,
          },
        });

        const deleteResult = deleteResponse.data;

        // Update local state using backend-returned statuses
        const updatedTasks = allTasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                annotations: t.annotations.filter((a) => a.id !== userAnnotation!.id),
                assignments: (t.assignments || []).map((a) =>
                  a.user_id === currentUserId
                    ? { ...a, status: deleteResult?.assignment_status ?? 'pending' }
                    : a
                ),
                task_status: deleteResult?.task_status ?? 'pending',
              }
            : t
        );

        const updatedVisibleTasks = applyTaskFilter(updatedTasks, taskFilter);

        set({
          allTasks: updatedTasks,
          visibleTasks: updatedVisibleTasks,
          isSubmitting: false,
        });

        useLayoutStore.getState().showAlert('Annotation removed successfully', 'success');
      } else {
        // Pre-submission KNN validation (only when enabled and a label is selected)
        if (get().knnValidationEnabled && labelId !== null) {
          try {
            const validationRes = await validateAnnotationSubmission({
              path: {
                campaign_id: campaign.id,
                annotation_task_id: task.id,
              },
              query: { label_id: labelId },
            });

            const status = validationRes.data?.status;

            if (status === 'mismatch') {
              const proceed = await useLayoutStore.getState().showConfirmDialog({
                title: 'Label Mismatch Detected',
                description:
                  'This label does not match what the nearest-neighbour embedding model would predict. Are you sure you want to submit this label?',
                confirmText: 'Submit Anyway',
                cancelText: 'Go Back',
                isDangerous: true,
              });
              if (!proceed) {
                set({ isSubmitting: false });
                return;
              }
            }
            // status === 'ok' -> label agrees, proceed normally
            // status === 'skipped_no_embedding', 'skipped_insufficient_data', or 'disabled' -> not enough data / not configured, don't block
          } catch {
            // Validation endpoint unavailable - don't block submission
          }
        }

        // Create/update the annotation
        const response = await completeAnnotationTask({
          path: {
            campaign_id: campaign.id,
            annotation_task_id: task.id,
          },
          body: {
            label_id: labelId,
            comment: comment || null,
            confidence: confidence,
            is_authoritative: isAuthoritative ?? null,
          },
        });

        const submitResult = response.data;
        const newAnnotation = submitResult?.annotation ?? null;
        const newTaskStatus = submitResult?.task_status ?? task.task_status;
        const newAssignmentStatus = submitResult?.assignment_status ?? 'pending';

        // Update local state using backend-returned statuses
        const updatedTasks = allTasks.map((t) => {
          if (t.id === task.id) {
            const updatedAnnotations = newAnnotation
              ? [
                  ...t.annotations.filter((a) => a.created_by_user_id !== currentUserId),
                  newAnnotation,
                ]
              : t.annotations.filter((a) => a.created_by_user_id !== currentUserId);
            return {
              ...t,
              annotations: updatedAnnotations,
              assignments: (t.assignments || []).map((a) =>
                a.user_id === currentUserId ? { ...a, status: newAssignmentStatus } : a
              ),
              task_status: newTaskStatus,
            };
          }
          return t;
        });

        const updatedVisibleTasks = applyTaskFilter(updatedTasks, taskFilter);

        // Move to next task or loop to first
        const nextIndex =
          currentTaskIndex < updatedVisibleTasks.length - 1 ? currentTaskIndex + 1 : 0;
        const nextTask = updatedVisibleTasks[nextIndex] || null;

        set({
          allTasks: updatedTasks,
          visibleTasks: updatedVisibleTasks,
          isSubmitting: false,
          currentTaskIndex: nextIndex,
          ...getFormStateForTask(nextTask),
          probeTimeseriesPoint: null,
        });

        useLayoutStore.getState().showAlert('Annotation submitted successfully', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit annotation';
      useLayoutStore.getState().showAlert(message, 'error');
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

    const nextIndex = currentTaskIndex >= visibleTasks.length - 1 ? 0 : currentTaskIndex + 1;
    const nextTask = visibleTasks[nextIndex] || null;

    set({
      isNavigating: true,
      currentTaskIndex: nextIndex,
      activeWindowId: defaultWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
      ...getFormStateForTask(nextTask),
      currentMapZoom: null,
      probeTimeseriesPoint: null,
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

    const prevIndex = currentTaskIndex === 0 ? visibleTasks.length - 1 : currentTaskIndex - 1;
    const prevTask = visibleTasks[prevIndex] || null;

    set({
      isNavigating: true,
      currentTaskIndex: prevIndex,
      activeWindowId: defaultWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
      ...getFormStateForTask(prevTask),
      currentMapZoom: null,
      probeTimeseriesPoint: null,
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

      const targetTask = visibleTasks[taskIndex] || null;

      set({
        isNavigating: true,
        currentTaskIndex: taskIndex,
        activeWindowId: defaultWindowId,
        activeSliceIndex: 0,
        windowSliceIndices: {},
        ...getFormStateForTask(targetTask),
        currentMapZoom: null,
        probeTimeseriesPoint: null,
      });

      // Clear navigating flag after a delay to allow maps to update
      setTimeout(() => {
        set({ isNavigating: false });
      }, 500);
    }
  },

  goToTaskById: (taskId: number, options?: { resetFilters?: boolean }) => {
    const {
      allTasks,
      visibleTasks: currentVisibleTasks,
      taskFilter: currentFilter,
      campaign,
      selectedImageryId,
    } = get();

    // Determine which filter & visible list to use
    let taskFilter: TaskFilter;
    let visibleTasks: AnnotationTaskOut[];

    if (options?.resetFilters) {
      // Widen filter to show everything (e.g. coming from review page)
      taskFilter = {
        assignedTo: [],
        statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
      };
      visibleTasks = applyTaskFilter(allTasks, taskFilter);
    } else {
      // Keep the current filter - try to find the task within the existing visible list
      taskFilter = currentFilter;
      visibleTasks = currentVisibleTasks;
    }

    const targetIndex = visibleTasks.findIndex((task) => task.id === taskId);
    if (targetIndex === -1) return; // Task not in filtered list

    const targetTask = visibleTasks[targetIndex] || null;
    const selectedImagery = campaign?.imagery.find((img) => img.id === selectedImageryId);
    const defaultWindowId =
      selectedImagery?.default_main_window_id ?? selectedImagery?.windows[0]?.id ?? null;

    set({
      isNavigating: true,
      taskFilter,
      visibleTasks,
      currentTaskIndex: targetIndex,
      activeWindowId: defaultWindowId,
      activeSliceIndex: 0,
      windowSliceIndices: {},
      ...getFormStateForTask(targetTask),
      currentMapZoom: null,
      probeTimeseriesPoint: null,
    });

    setTimeout(() => {
      set({ isNavigating: false });
    }, 500);
  },

  // UI actions
  setCurrentLayout: (layout) => set({ currentLayout: layout }),

  setSavedLayout: (layout) => set({ savedLayout: layout }),

  setIsEditingLayout: (isEditing) => set({ isEditingLayout: isEditing }),

  saveLayout: async (shouldBeDefault = false) => {
    const { campaign, currentLayout, selectedImageryId } = get();

    if (!campaign || !currentLayout || selectedImageryId === null) {
      useLayoutStore
        .getState()
        .showAlert('Cannot save layout: missing campaign or imagery', 'error');
      return;
    }

    try {
      // Separate main layout items from imagery layout items
      const mainLayoutItems = currentLayout.filter(
        (item) =>
          item.i === 'main' ||
          item.i === 'timeseries' ||
          item.i === 'minimap' ||
          item.i === 'controls'
      );
      const imageryLayoutItems = currentLayout.filter(
        (item) =>
          item.i !== 'main' &&
          item.i !== 'timeseries' &&
          item.i !== 'minimap' &&
          item.i !== 'controls'
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
      useLayoutStore.getState().showAlert(`Layout saved successfully as ${layoutType}`, 'success');

      set({
        savedLayout: currentLayout,
        isEditingLayout: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save layout';
      useLayoutStore.getState().showAlert(message, 'error');
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

  setConfidence: (confidence) => set({ confidence }),

  setActiveTool: (tool) =>
    set({ activeTool: tool, ...(tool !== 'timeseries' ? { probeTimeseriesPoint: null } : {}) }),

  setTimeseriesPoint: (point) => set({ timeseriesPoint: point }),

  setProbeTimeseriesPoint: (point) => set({ probeTimeseriesPoint: point }),

  toggleMagicWand: (labelId) =>
    set((state) => ({
      magicWandEnabled: {
        ...state.magicWandEnabled,
        [labelId]: !state.magicWandEnabled[labelId],
      },
    })),

  setKnnValidationEnabled: (enabled) => set({ knnValidationEnabled: enabled }),

  setSkipConfirmDisabled: (disabled) => set({ skipConfirmDisabled: disabled }),

  resetAnnotationForm: () => set({ selectedLabelId: null, comment: '', confidence: 5 }),

  // Task filter actions
  setTaskFilter: (filterUpdate: Partial<TaskFilter>) => {
    const { allTasks, taskFilter } = get();

    // Merge with existing filter
    const newFilter: TaskFilter = {
      ...taskFilter,
      ...filterUpdate,
    };

    const visibleTasks = applyTaskFilter(allTasks, newFilter);
    const firstTask = visibleTasks[0] || null;

    // Set navigating flag and populate form from the first visible task
    set({
      isNavigating: true,
      taskFilter: newFilter,
      visibleTasks,
      currentTaskIndex: 0,
      ...getFormStateForTask(firstTask),
      probeTimeseriesPoint: null,
    });

    // Clear navigating flag after a delay to allow maps to update
    setTimeout(() => {
      set({ isNavigating: false });
    }, 500);
  },

  resetTaskFilter: () => {
    const currentUserId = useAccountStore.getState().account?.id;
    if (!currentUserId) return;
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

      const response = await createAnnotationOpenmode({
        path: { campaign_id: campaign.id },
        body: {
          label_id: labelId,
          comment: comment || null,
          geometry_wkt: wktGeometry,
          confidence: null,
        },
      });

      const annotation = response.data!;

      // Add to local state
      set((state) => ({
        annotations: [...state.annotations, annotation],
        isSubmitting: false,
      }));

      useLayoutStore.getState().showAlert('Annotation saved successfully', 'success');
      return annotation;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save annotation';
      useLayoutStore.getState().showAlert(message, 'error');
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

      const response = await updateAnnotationOpenmode({
        path: {
          campaign_id: campaign.id,
          annotation_id: annotationId,
        },
        body: {
          label_id: annotation.label_id,
          comment: annotation.comment,
          geometry_wkt: wktGeometry,
          is_authoritative: null, // Not setting this field in geometry updates
        },
      });

      const updatedAnnotation = response.data!;

      // Update local state
      set((state) => ({
        annotations: state.annotations.map((a) => (a.id === annotationId ? updatedAnnotation : a)),
        isSubmitting: false,
      }));

      useLayoutStore.getState().showAlert('Annotation updated successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update annotation';
      useLayoutStore.getState().showAlert(message, 'error');
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

      useLayoutStore.getState().showAlert('Annotation deleted successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete annotation';
      useLayoutStore.getState().showAlert(message, 'error');
      set({ isSubmitting: false });
      console.error('Delete annotation error:', error);
    }
  },

  reset: () => {
    set(initialState);
  },
}));

export default useAnnotationStore;
