import { create } from 'zustand';
import {
  getAllAnnotationTasks,
  completeAnnotationTask,
  claimAnnotationTask,
  deleteAnnotation,
  validateAnnotationSubmission,
  listTaskSets,
  type AnnotationTaskAssignmentOut,
  type AnnotationTaskOut,
  type TaskSetOut,
} from '~/api/client';
import { useAccountStore } from '~/features/account/account.store';
import { useLayoutStore } from '~/features/layout/layout.store';
import { handleError } from '~/shared/utils/errorHandler';
import type { TaskStatus } from '~/shared/utils/taskStatus';
import { useAnnotationStore } from './annotation.store';
import { useCampaignStore } from './campaign.store';
import { useMapStore } from './map.store';
import { usePreferencesStore } from './preferences.store';
import { applyTaskFilter, isClaimable, UNASSIGNED, type TaskFilter } from '../utils/taskFilter';
import {
  formatMissingFieldsTitle,
  missingRequiredFields,
  type FormValues,
} from '../utils/formValues';

export type { TaskFilter, TaskStatus };

interface TaskStore {
  // State
  allTasks: AnnotationTaskOut[];
  visibleTasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
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
  formValues: FormValues;
  activeFieldIndex: number | null;
  magicWandEnabled: Record<number, boolean>;
  knnValidationEnabled: boolean;
  skipConfirmDisabled: boolean;

  // Actions
  loadTasks: (
    campaignId: number,
    initialTaskId?: number,
    initialTaskSetId?: number
  ) => Promise<void>;
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
  claimCurrentTask: () => Promise<void>;

  setSelectedLabelId: (id: number | null) => void;
  setComment: (comment: string) => void;
  setConfidence: (confidence: number) => void;
  setFlaggedForReview: (flagged: boolean) => void;
  setFlagComment: (comment: string) => void;
  setFormValues: (next: FormValues) => void;
  setActiveFieldIndex: (index: number | null) => void;
  toggleMagicWand: (labelId: number) => void;
  setKnnValidationEnabled: (enabled: boolean) => void;
  setSkipConfirmDisabled: (disabled: boolean) => void;
  resetAnnotationForm: () => void;

  setTaskFilter: (filter: Partial<TaskFilter>) => void;
  resetTaskFilter: () => void;

  reset: () => void;
}

// Helpers

const emptyFormState = {
  selectedLabelId: null as number | null,
  comment: '',
  confidence: 5,
  flaggedForReview: false,
  flagComment: '',
  formValues: {} as FormValues,
  activeFieldIndex: null as number | null,
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
        formValues: userAnn.form_values ?? {},
        activeFieldIndex: null,
      }
    : emptyFormState;
};

/** Resets map state relevant to task navigation. */
const resetMapForTaskNav = () => {
  const campaign = useCampaignStore.getState().campaign;
  const selectedViewId = useCampaignStore.getState().selectedViewId;
  const view = campaign?.imagery_views.find((v) => v.id === selectedViewId);
  const windowRefs = view?.collection_refs?.filter((r) => r.show_as_window) ?? [];

  // Honour the user's pinned starting collection for this view, falling back to
  // the first window collection if unset or no longer valid (e.g. removed).
  const pinned =
    selectedViewId != null
      ? usePreferencesStore.getState().taskStartCollectionByView[selectedViewId]
      : undefined;
  const pinnedValid = windowRefs.some((r) => r.collection_id === pinned);
  const defaultCollectionId = (pinnedValid ? pinned : windowRefs[0]?.collection_id) ?? null;

  useMapStore.setState({
    // Clear per-collection memory so the active slice resolves from the
    // collection's cover_slice_index on the next setActiveCollectionId call.
    activeCollectionId: null,
    collectionSliceIndices: {},
    emptySlices: {},
    viewSnapshots: {},
    currentMapZoom: null,
    probeTimeseriesPoint: null,
  });
  // Reducer resolves the cover_slice_index → activeSliceIndex.
  useMapStore.getState().setActiveCollectionId(defaultCollectionId);
};

const NAVIGATION_DEBOUNCE_MS = 500;

const initialState = {
  allTasks: [] as AnnotationTaskOut[],
  visibleTasks: [] as AnnotationTaskOut[],
  taskSets: [] as TaskSetOut[],
  currentTaskIndex: 0,
  taskFilter: {
    assignedTo: [] as string[],
    statuses: ['pending' as TaskStatus],
    selectedConfidences: [] as number[],
    flaggedOnly: false,
    taskSetId: null as number | null,
  },
  isSubmitting: false,
  isNavigating: false,
  tasksLoaded: false,
  selectedLabelId: null as number | null,
  comment: '',
  confidence: 5,
  flaggedForReview: false,
  flagComment: '',
  formValues: {} as FormValues,
  activeFieldIndex: null as number | null,
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

    loadTasks: async (campaignId, initialTaskId, initialTaskSetId) => {
      const [tasksRes, setsRes] = await Promise.all([
        getAllAnnotationTasks({ path: { campaign_id: campaignId } }),
        listTaskSets({ path: { campaign_id: campaignId } }),
      ]);
      const allTasks = tasksRes.data!.tasks;
      const taskSets = setsRes.data ?? [];
      const currentUserId = useAccountStore.getState().account?.id;
      const campaign = useCampaignStore.getState().campaign;

      // Only seed the filter from a deep-linked task set if it still exists;
      // a stale/removed id falls through to the usual seeding below.
      const seededTaskSetId =
        initialTaskSetId !== undefined && taskSets.some((s) => s.id === initialTaskSetId)
          ? initialTaskSetId
          : null;

      let taskFilter: TaskFilter;
      let visibleTasks: AnnotationTaskOut[];
      let currentTaskIndex = 0;

      if (initialTaskId !== undefined) {
        taskFilter = {
          assignedTo: [],
          statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
          selectedConfidences: [],
          flaggedOnly: false,
          taskSetId: seededTaskSetId ?? get().taskFilter.taskSetId ?? null,
        };
        ({ visibleTasks, suggestedIndex: currentTaskIndex } = applyTaskFilter(
          allTasks,
          taskFilter,
          currentUserId,
          initialTaskId
        ));
      } else {
        const pendingFilter = (
          assignedTo: string[],
          taskSetId: number | null = null
        ): TaskFilter => ({
          assignedTo,
          statuses: ['pending'],
          selectedConfidences: [],
          flaggedOnly: false,
          taskSetId,
        });

        // A deep-linked task set only stays in play while it actually has
        // tasks; an empty set is abandoned immediately rather than broadened.
        const setHasTasks =
          seededTaskSetId !== null && allTasks.some((t) => t.task_set_id === seededTaskSetId);
        const effectiveSetId = setHasTasks ? seededTaskSetId : null;

        // Users with their own assignments start on those. Everyone else
        // (public campaigns, or anyone with nothing assigned) starts on the
        // pool of unassigned pending tasks - work that's free to pick up -
        // rather than every pending task, so tasks already handed off to a
        // reviewer don't linger in the default view.
        const showAll = campaign?.is_public;
        taskFilter = pendingFilter(
          showAll || !currentUserId ? [UNASSIGNED] : [currentUserId],
          effectiveSetId
        );
        ({ visibleTasks } = applyTaskFilter(allTasks, taskFilter, currentUserId));

        // Progressive fallback so the user always lands on a task when work
        // exists. A live deep-linked set broadens within itself first (mine ->
        // unassigned -> all statuses) before it's abandoned; only then - or
        // when the set was empty from the start - does the search fall back
        // to the set-less chain (mine -> unassigned -> all).
        if (visibleTasks.length === 0 && effectiveSetId !== null && currentUserId && !showAll) {
          taskFilter = pendingFilter([UNASSIGNED], effectiveSetId);
          ({ visibleTasks } = applyTaskFilter(allTasks, taskFilter, currentUserId));
        }
        if (visibleTasks.length === 0 && effectiveSetId !== null) {
          taskFilter = {
            assignedTo: [],
            statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
            selectedConfidences: [],
            flaggedOnly: false,
            taskSetId: effectiveSetId,
          };
          ({ visibleTasks } = applyTaskFilter(allTasks, taskFilter, currentUserId));
        }
        if (visibleTasks.length === 0 && currentUserId && !showAll) {
          taskFilter = pendingFilter([UNASSIGNED]);
          ({ visibleTasks } = applyTaskFilter(allTasks, taskFilter, currentUserId));
        }
        if (visibleTasks.length === 0 && allTasks.length > 0) {
          taskFilter = pendingFilter([]);
          ({ visibleTasks } = applyTaskFilter(allTasks, taskFilter, currentUserId));
        }
      }

      const targetTask = visibleTasks[currentTaskIndex] || null;

      set({
        allTasks,
        taskSets,
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

      // Guard here rather than in the submit button's disabled state: the
      // Enter hotkey calls this directly and would otherwise reach the
      // backend's 422. Skips (no label) are exempt, matching the backend.
      if (labelId !== null) {
        const missing = missingRequiredFields(
          campaign.settings.form_fields ?? [],
          get().formValues
        );
        if (missing.length > 0) {
          useLayoutStore.getState().showAlert(formatMissingFieldsTitle(missing), 'error');
          return;
        }
      }

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
                ? {
                    ...a,
                    status: (result?.assignment_status ??
                      'pending') as AnnotationTaskAssignmentOut['status'],
                  }
                : a
            ),
            task_status: (result?.task_status ?? 'pending') as AnnotationTaskOut['task_status'],
          };
          set({
            allTasks: replaceTaskInList(allTasks, updatedTask),
            visibleTasks: replaceTaskInList(visibleTasks, updatedTask),
            isSubmitting: false,
            ...getFormStateForTask(updatedTask),
          });
          // Explore's tile layer caches by this version, so a task-side delete
          // must bump it too or Explore keeps showing the stale annotation.
          useAnnotationStore.getState().bumpTileVersion();
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
        const { formValues } = get();
        const response = await completeAnnotationTask({
          path: { campaign_id: campaign.id, annotation_task_id: task.id },
          body: {
            label_id: labelId,
            comment: comment || null,
            confidence,
            is_authoritative: isAuthoritative ?? null,
            flagged_for_review: flaggedForReview ?? false,
            flag_comment: flaggedForReview ? flagComment || null : null,
            form_values: Object.keys(formValues).length ? formValues : null,
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
              ? {
                  ...a,
                  status: (submitResult?.assignment_status ??
                    'pending') as AnnotationTaskAssignmentOut['status'],
                }
              : a
          ),
          task_status: (submitResult?.task_status ??
            task.task_status) as AnnotationTaskOut['task_status'],
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
        // Explore's tile layer caches by this version, so a task submit or
        // skip must bump it too or Explore keeps showing stale tiles.
        useAnnotationStore.getState().bumpTileVersion();
        startNavigation({ currentTaskIndex: nextIndex, ...getFormStateForTask(nextTask) });

        // A labeled submission may change what the KNN validator has to work
        // with (total count and the submitted label's count); refresh async
        // so the tooltip in AnnotationControls reflects the latest state.
        if (labelId !== null) {
          useCampaignStore.getState().refreshKnnValidationStatus();
        }
      } catch (error) {
        handleError(error, 'Failed to submit annotation');
        set({ isSubmitting: false });
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
      const currentUserId = useAccountStore.getState().account?.id;

      let taskFilter: TaskFilter;
      let visibleTasks: AnnotationTaskOut[];

      if (options?.resetFilters) {
        taskFilter = {
          assignedTo: [],
          statuses: ['pending', 'partial', 'done', 'skipped', 'conflicting'],
          selectedConfidences: [],
          flaggedOnly: false,
          taskSetId: null,
        };
        ({ visibleTasks } = applyTaskFilter(allTasks, taskFilter, currentUserId, taskId));
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

    // Claim the current task (or renew our own claim) so others stop seeing it as
    // free. The backend enforces one claim per user, so this also releases any prior
    // claim; the lease TTL is the real release. A 409 means someone beat us: skip on.
    claimCurrentTask: async () => {
      if (useCampaignStore.getState().isReviewMode) return;
      const { visibleTasks, currentTaskIndex } = get();
      const task = visibleTasks[currentTaskIndex];
      const campaign = useCampaignStore.getState().campaign;
      const currentUserId = useAccountStore.getState().account?.id;
      if (!task || !campaign || !currentUserId) return;

      const mine = (task.assignments || []).find((a) => a.user_id === currentUserId);
      const holdsSoftClaim = mine != null && mine.claimed_at != null && mine.status === 'pending';
      if (!holdsSoftClaim && !isClaimable(task)) return;

      const { data, response } = await claimAnnotationTask({
        path: { campaign_id: campaign.id, annotation_task_id: task.id },
      });

      if (data) {
        const updatedTask: AnnotationTaskOut = {
          ...task,
          assignments: mine
            ? (task.assignments || []).map((a) =>
                a.user_id === currentUserId ? { ...a, claimed_at: data.claimed_at } : a
              )
            : [
                ...(task.assignments || []),
                { user_id: currentUserId, status: 'pending', claimed_at: data.claimed_at },
              ],
        };
        // Functional update: read both lists fresh so overlapping claims from rapid
        // navigation can't clobber each other's in-place edits.
        const replace = (list: AnnotationTaskOut[]) =>
          list.map((t) => (t.id === task.id ? updatedTask : t));
        set((s) => ({ allTasks: replace(s.allTasks), visibleTasks: replace(s.visibleTasks) }));
        return;
      }

      if (response?.status === 409) {
        const { visibleTasks: vt, currentTaskIndex: ci } = get();
        if (vt[ci]?.id === task.id) {
          useLayoutStore.getState().showAlert('Task already taken - skipping', 'warning');
          get().nextTask();
        }
      }
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
    setFormValues: (formValues) => set({ formValues }),
    setActiveFieldIndex: (activeFieldIndex) => set({ activeFieldIndex }),
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
        formValues: {},
        activeFieldIndex: null,
      }),

    // Filter actions
    setTaskFilter: (filterUpdate) => {
      const { allTasks, taskFilter } = get();
      const currentUserId = useAccountStore.getState().account?.id;
      const newFilter: TaskFilter = { ...taskFilter, ...filterUpdate };
      const { visibleTasks, suggestedIndex } = applyTaskFilter(allTasks, newFilter, currentUserId);
      const firstTask = visibleTasks[suggestedIndex] || null;

      useMapStore.setState({ probeTimeseriesPoint: null });
      startNavigation({
        taskFilter: newFilter,
        visibleTasks,
        currentTaskIndex: suggestedIndex,
        ...getFormStateForTask(firstTask),
      });
    },

    resetTaskFilter: () => {
      const currentUserId = useAccountStore.getState().account?.id;
      if (!currentUserId) return;
      get().setTaskFilter({
        assignedTo: [currentUserId],
        statuses: ['pending'],
        selectedConfidences: [],
        flaggedOnly: false,
      });
    },

    reset: () => set(initialState),
  };
});

if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  (window as unknown as Record<string, unknown>).__TASK_STORE__ = useTaskStore;
}
