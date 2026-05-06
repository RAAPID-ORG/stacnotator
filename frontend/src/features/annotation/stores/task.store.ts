import { create } from 'zustand';
import {
  getAllAnnotationTasks,
  completeAnnotationTask,
  deleteAnnotation,
  validateAnnotationSubmission,
  type AnnotationTaskOut,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { useCampaignStore } from './campaign.store';
import { useMapStore } from './map.store';

/**
 * Task status values for filtering.
 */
export type TaskStatus = 'pending' | 'partial' | 'done' | 'skipped' | 'conflicting';

export interface TaskFilter {
  assignedTo: string[];
  statuses: TaskStatus[];
}

interface TaskStore {
  // State
  allTasks: AnnotationTaskOut[];
  visibleTasks: AnnotationTaskOut[];
  currentTaskIndex: number;
  taskFilter: TaskFilter;
  isSubmitting: boolean;
  isNavigating: boolean;
  tasksLoaded: boolean;

  // Form state
  selectedLabelId: number | null;
  comment: string;
  confidence: number;
  flaggedForReview: boolean;
  flagComment: string;
  magicWandEnabled: Record<number, boolean>;
  knnValidationEnabled: boolean;
  skipConfirmDisabled: boolean;

  // Actions
  loadTasks: (campaignId: number, initialTaskId?: number) => Promise<void>;
  submitAnnotation: (
    labelId: number | null,
    comment: string,
    confidence: number,
    isAuthoritative?: boolean,
    flaggedForReview?: boolean,
    flagComment?: string
  ) => Promise<void>;
  nextTask: () => void;
  previousTask: () => void;
  goToTask: (annotationNumber: number) => void;
  goToTaskById: (taskId: number, options?: { resetFilters?: boolean }) => void;

  setSelectedLabelId: (id: number | null) => void;
  setComment: (comment: string) => void;
  setConfidence: (confidence: number) => void;
  setFlaggedForReview: (flagged: boolean) => void;
  setFlagComment: (comment: string) => void;
  toggleMagicWand: (labelId: number) => void;
  setKnnValidationEnabled: (enabled: boolean) => void;
  setSkipConfirmDisabled: (disabled: boolean) => void;
  resetAnnotationForm: () => void;

  setTaskFilter: (filter: Partial<TaskFilter>) => void;
  resetTaskFilter: () => void;

  reset: () => void;
}

// Helpers

const applyTaskFilter = (
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter
): AnnotationTaskOut[] => {
  const filterByUser = filter.assignedTo.length > 0;

  return allTasks.filter((task) => {
    const assignments = task.assignments || [];
    if (filterByUser) {
      const userAssignments = assignments.filter((a) => filter.assignedTo.includes(a.user_id));
      if (userAssignments.length === 0) return false;
      return userAssignments.some((a) => filter.statuses.includes(a.status as TaskStatus));
    }
    return filter.statuses.includes(task.task_status as TaskStatus);
  });
};

const emptyFormState = {
  selectedLabelId: null as number | null,
  comment: '',
  confidence: 5,
  flaggedForReview: false,
  flagComment: '',
};

const getFormStateForTask = (task: AnnotationTaskOut | null) => {
  if (!task) return emptyFormState;
  const currentUserId = useAccountStore.getState().account?.id;
  if (!currentUserId) return emptyFormState;
  const userAnn = task.annotations.find((a) => a.created_by_user_id === currentUserId);
  return userAnn
    ? {
        selectedLabelId: userAnn.label_id,
        comment: userAnn.comment || '',
        confidence: userAnn.confidence ?? 5,
        flaggedForReview: userAnn.flagged_for_review ?? false,
        flagComment: userAnn.flag_comment || '',
      }
    : emptyFormState;
};

/** Resets map state relevant to task navigation. */
const resetMapForTaskNav = () => {
  const campaign = useCampaignStore.getState().campaign;
  const selectedViewId = useCampaignStore.getState().selectedViewId;
  const view = campaign?.imagery_views.find((v) => v.id === selectedViewId);
  const firstWindowRef = view?.collection_refs?.find((r) => r.show_as_window);
  const defaultCollectionId = firstWindowRef?.collection_id ?? null;

  useMapStore.setState({
    activeCollectionId: defaultCollectionId,
    activeSliceIndex: 0,
    collectionSliceIndices: {},
    emptySlices: {},
    viewSnapshots: {},
    currentMapZoom: null,
    probeTimeseriesPoint: null,
    // Fresh task: any empty-probe should land on the cover slice, not
    // carry over a leftover hotkey-direction intent from the previous task.
    sliceNavIntent: 'initial',
  });
};

const NAVIGATION_DEBOUNCE_MS = 500;

const initialState = {
  allTasks: [] as AnnotationTaskOut[],
  visibleTasks: [] as AnnotationTaskOut[],
  currentTaskIndex: 0,
  taskFilter: { assignedTo: [] as string[], statuses: ['pending' as TaskStatus] },
  isSubmitting: false,
  isNavigating: false,
  tasksLoaded: false,
  selectedLabelId: null as number | null,
  comment: '',
  confidence: 5,
  flaggedForReview: false,
  flagComment: '',
  magicWandEnabled: {} as Record<number, boolean>,
  knnValidationEnabled: false,
  skipConfirmDisabled: false,
};

export const useTaskStore = create<TaskStore>((set, get) => {
  const startNavigation = (stateUpdate: Partial<typeof initialState>) => {
    set({ isNavigating: true, ...stateUpdate });
    resetMapForTaskNav();
    setTimeout(() => set({ isNavigating: false }), NAVIGATION_DEBOUNCE_MS);
  };

  return {
    ...initialState,

    loadTasks: async (campaignId, initialTaskId) => {
      const tasksRes = await getAllAnnotationTasks({ path: { campaign_id: campaignId } });
      const allTasks = tasksRes.data!.tasks;
      const currentUserId = useAccountStore.getState().account?.id;
      const campaign = useCampaignStore.getState().campaign;

      let taskFilter: TaskFilter;
      let visibleTasks: AnnotationTaskOut[];
      let currentTaskIndex = 0;

      if (initialTaskId !== undefined) {
        taskFilter = {
          assignedTo: [],
          statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
        };
        visibleTasks = applyTaskFilter(allTasks, taskFilter);
        const idx = visibleTasks.findIndex((t) => t.id === initialTaskId);
        currentTaskIndex = idx !== -1 ? idx : 0;
      } else {
        // Public campaigns show all tasks by default since most users
        // won't have explicit assignments. Private campaigns default to
        // showing only the current user's assigned tasks.
        const showAll = campaign?.is_public;
        taskFilter = {
          assignedTo: showAll || !currentUserId ? [] : [currentUserId],
          statuses: ['pending'],
        };
        visibleTasks = applyTaskFilter(allTasks, taskFilter);

        // If the user-scoped filter yields nothing but unfiltered tasks
        // exist, auto-widen to show everything so the user lands on a
        // task instead of an empty screen.
        if (visibleTasks.length === 0 && allTasks.length > 0 && !showAll) {
          taskFilter = { assignedTo: [], statuses: ['pending'] };
          visibleTasks = applyTaskFilter(allTasks, taskFilter);
        }
      }

      const targetTask = visibleTasks[currentTaskIndex] || null;

      set({
        allTasks,
        visibleTasks,
        taskFilter,
        currentTaskIndex,
        tasksLoaded: true,
        ...getFormStateForTask(targetTask),
      });
    },

    submitAnnotation: async (
      labelId,
      comment,
      confidence,
      isAuthoritative,
      flaggedForReview,
      flagComment
    ) => {
      const { visibleTasks, allTasks, currentTaskIndex } = get();
      const task = visibleTasks[currentTaskIndex];
      const campaign = useCampaignStore.getState().campaign;
      const currentUserId = useAccountStore.getState().account?.id;

      if (!task || !campaign || !currentUserId) return;
      set({ isSubmitting: true });

      // visibleTasks is treated as a stable working set between explicit re-filters
      // (setTaskFilter, resetTaskFilter, loadTasks, goToTaskById({resetFilters})).
      // Submissions update the task object in place - they never add or remove
      // list entries - so currentTaskIndex stays well-defined across the session.
      const replaceTaskInList = (
        list: AnnotationTaskOut[],
        updated: AnnotationTaskOut
      ): AnnotationTaskOut[] => list.map((t) => (t.id === task.id ? updated : t));

      try {
        const userAnnotation = task.annotations.find((a) => a.created_by_user_id === currentUserId);
        const hasExistingLabel = userAnnotation?.label_id != null;

        // Remove label flow
        if (labelId === null && hasExistingLabel && !comment) {
          const deleteRes = await deleteAnnotation({
            path: { campaign_id: campaign.id, annotation_id: userAnnotation!.id },
          });
          const result = deleteRes.data;
          const updatedTask: AnnotationTaskOut = {
            ...task,
            annotations: task.annotations.filter((a) => a.id !== userAnnotation!.id),
            assignments: (task.assignments || []).map((a) =>
              a.user_id === currentUserId
                ? { ...a, status: result?.assignment_status ?? 'pending' }
                : a
            ),
            task_status: result?.task_status ?? 'pending',
          };
          set({
            allTasks: replaceTaskInList(allTasks, updatedTask),
            visibleTasks: replaceTaskInList(visibleTasks, updatedTask),
            isSubmitting: false,
            ...getFormStateForTask(updatedTask),
          });
          useLayoutStore.getState().showAlert('Annotation removed successfully', 'success');
          // Removing a labeled annotation also changes KNN counts.
          useCampaignStore.getState().refreshKnnValidationStatus();
          return;
        }

        // KNN validation
        if (get().knnValidationEnabled && labelId !== null) {
          try {
            const validationRes = await validateAnnotationSubmission({
              path: { campaign_id: campaign.id, annotation_task_id: task.id },
              query: { label_id: labelId },
            });
            if (validationRes.data?.status === 'mismatch') {
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
          } catch {
            // Validation unavailable -don't block
          }
        }

        // Submit
        const response = await completeAnnotationTask({
          path: { campaign_id: campaign.id, annotation_task_id: task.id },
          body: {
            label_id: labelId,
            comment: comment || null,
            confidence,
            is_authoritative: isAuthoritative ?? null,
            flagged_for_review: flaggedForReview ?? false,
            flag_comment: flaggedForReview ? flagComment || null : null,
          },
        });

        const submitResult = response.data;
        const newAnnotation = submitResult?.annotation ?? null;

        const updatedAnnotations = newAnnotation
          ? [
              ...task.annotations.filter((a) => a.created_by_user_id !== currentUserId),
              newAnnotation,
            ]
          : task.annotations.filter((a) => a.created_by_user_id !== currentUserId);
        const updatedTask: AnnotationTaskOut = {
          ...task,
          annotations: updatedAnnotations,
          assignments: (task.assignments || []).map((a) =>
            a.user_id === currentUserId
              ? { ...a, status: submitResult?.assignment_status ?? 'pending' }
              : a
          ),
          task_status: submitResult?.task_status ?? task.task_status,
        };

        const updatedVisible = replaceTaskInList(visibleTasks, updatedTask);
        const nextIndex =
          updatedVisible.length === 0 ? 0 : (currentTaskIndex + 1) % updatedVisible.length;
        const nextTask = updatedVisible[nextIndex] || null;

        set({
          allTasks: replaceTaskInList(allTasks, updatedTask),
          visibleTasks: updatedVisible,
          isSubmitting: false,
        });
        startNavigation({ currentTaskIndex: nextIndex, ...getFormStateForTask(nextTask) });

        // A labeled submission may change what the KNN validator has to work
        // with (total count and the submitted label's count); refresh async
        // so the tooltip in AnnotationControls reflects the latest state.
        if (labelId !== null) {
          useCampaignStore.getState().refreshKnnValidationStatus();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to submit annotation';
        useLayoutStore.getState().showAlert(message, 'error');
        set({ isSubmitting: false });
        console.error('Submit error:', error);
      }
    },

    nextTask: () => {
      const { visibleTasks, currentTaskIndex } = get();
      if (visibleTasks.length === 0) return;
      const nextIndex = currentTaskIndex >= visibleTasks.length - 1 ? 0 : currentTaskIndex + 1;
      const nextTask = visibleTasks[nextIndex] || null;

      startNavigation({ currentTaskIndex: nextIndex, ...getFormStateForTask(nextTask) });
    },

    previousTask: () => {
      const { visibleTasks, currentTaskIndex } = get();
      if (visibleTasks.length === 0) return;
      const prevIndex = currentTaskIndex === 0 ? visibleTasks.length - 1 : currentTaskIndex - 1;
      const prevTask = visibleTasks[prevIndex] || null;

      startNavigation({ currentTaskIndex: prevIndex, ...getFormStateForTask(prevTask) });
    },

    goToTask: (annotationNumber) => {
      const { visibleTasks } = get();
      const taskIndex = visibleTasks.findIndex((t) => t.annotation_number === annotationNumber);
      if (taskIndex === -1) return;

      const targetTask = visibleTasks[taskIndex] || null;
      startNavigation({ currentTaskIndex: taskIndex, ...getFormStateForTask(targetTask) });
    },

    goToTaskById: (taskId, options) => {
      const { allTasks, visibleTasks: currentVisible, taskFilter: currentFilter } = get();

      let taskFilter: TaskFilter;
      let visibleTasks: AnnotationTaskOut[];

      if (options?.resetFilters) {
        taskFilter = {
          assignedTo: [],
          statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
        };
        visibleTasks = applyTaskFilter(allTasks, taskFilter);
      } else {
        taskFilter = currentFilter;
        visibleTasks = currentVisible;
      }

      const targetIndex = visibleTasks.findIndex((t) => t.id === taskId);
      if (targetIndex === -1) return;

      const targetTask = visibleTasks[targetIndex] || null;
      startNavigation({
        taskFilter,
        visibleTasks,
        currentTaskIndex: targetIndex,
        ...getFormStateForTask(targetTask),
      });
    },

    // Form actions
    setSelectedLabelId: (id) => set({ selectedLabelId: id }),
    setComment: (comment) => set({ comment }),
    setConfidence: (confidence) => set({ confidence }),
    setFlaggedForReview: (flagged) =>
      set((s) => ({
        flaggedForReview: flagged,
        flagComment: flagged ? s.flagComment : '',
      })),
    setFlagComment: (flagComment) => set({ flagComment }),
    toggleMagicWand: (labelId) =>
      set((s) => ({
        magicWandEnabled: { ...s.magicWandEnabled, [labelId]: !s.magicWandEnabled[labelId] },
      })),
    setKnnValidationEnabled: (enabled) => set({ knnValidationEnabled: enabled }),
    setSkipConfirmDisabled: (disabled) => set({ skipConfirmDisabled: disabled }),
    resetAnnotationForm: () =>
      set({
        selectedLabelId: null,
        comment: '',
        confidence: 5,
        flaggedForReview: false,
        flagComment: '',
      }),

    // Filter actions
    setTaskFilter: (filterUpdate) => {
      const { allTasks, taskFilter } = get();
      const newFilter: TaskFilter = { ...taskFilter, ...filterUpdate };
      const visibleTasks = applyTaskFilter(allTasks, newFilter);
      const firstTask = visibleTasks[0] || null;

      useMapStore.setState({ probeTimeseriesPoint: null });
      startNavigation({
        taskFilter: newFilter,
        visibleTasks,
        currentTaskIndex: 0,
        ...getFormStateForTask(firstTask),
      });
    },

    resetTaskFilter: () => {
      const currentUserId = useAccountStore.getState().account?.id;
      if (!currentUserId) return;
      get().setTaskFilter({ assignedTo: [currentUserId], statuses: ['pending'] });
    },

    reset: () => set(initialState),
  };
});
