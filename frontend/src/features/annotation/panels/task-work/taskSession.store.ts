import { create } from 'zustand';
import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import { geometryCentroid, wktToGeometry } from '~/features/annotation/core/annotation';
import type { Catalog } from '~/features/annotation/core/catalog';
import {
  applyTaskFilter,
  nextIndex,
  prevIndex,
  widenFilterForTask,
  type TaskFilter,
} from '~/features/annotation/core/tasks';
import type { LonLat } from '~/features/annotation/engine/map';
import { setProbePoint } from '~/features/annotation/shared/interactionSpec';
import { setMapFocus, type MapFocus } from '~/features/annotation/shared/mapFocus';
import { useImageryStore, usePrefsStore, useSessionStore } from '~/features/annotation/stores';

export interface InitializeTaskSession {
  tasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  filter: TaskFilter;
  currentUserId: string | null;
  now: number;
  catalog: Catalog;
  preferTaskId?: number;
}

export interface TaskSessionState {
  allTasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  visibleTasks: AnnotationTaskOut[];
  currentIndex: number;
  filter: TaskFilter;
  currentUserId: string | null;
  loaded: boolean;
  isSubmitting: boolean;
  /** Local "Validate" toggle for the KNN mismatch check. This belongs to the
   *  session because buttons and hotkeys must read the same live value. */
  knnValidationEnabled: boolean;

  initialize: (options: InitializeTaskSession) => void;
  setFilter: (filter: TaskFilter, now: number, catalog: Catalog) => void;
  goToAnnotationNumber: (annotationNumber: number, catalog: Catalog) => boolean;
  next: (catalog: Catalog) => void;
  previous: (catalog: Catalog) => void;
  replaceTask: (updated: AnnotationTaskOut, catalog: Catalog) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setKnnValidationEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const EMPTY_FILTER: TaskFilter = {
  assignedTo: [],
  statuses: ['pending'],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

function initialState(): Omit<
  TaskSessionState,
  | 'initialize'
  | 'setFilter'
  | 'goToAnnotationNumber'
  | 'next'
  | 'previous'
  | 'replaceTask'
  | 'setSubmitting'
  | 'setKnnValidationEnabled'
  | 'reset'
> {
  return {
    allTasks: [],
    taskSets: [],
    visibleTasks: [],
    currentIndex: 0,
    filter: {
      ...EMPTY_FILTER,
      assignedTo: [],
      statuses: ['pending'],
      selectedConfidences: [],
    },
    currentUserId: null,
    loaded: false,
    isSubmitting: false,
    knnValidationEnabled: false,
  };
}

const PREFETCH_AHEAD = 3;

function currentTask(state: TaskSessionState): AnnotationTaskOut | null {
  return state.visibleTasks[state.currentIndex] ?? null;
}

function upcomingCentroids(state: TaskSessionState): LonLat[] {
  return state.visibleTasks
    .slice(state.currentIndex + 1, state.currentIndex + 1 + PREFETCH_AHEAD)
    .map((task) => geometryCentroid(wktToGeometry(task.geometry.geometry)));
}

function deriveMapFocus(
  state: TaskSessionState,
  task: AnnotationTaskOut | null,
  catalog: Catalog
): MapFocus | null {
  if (!task) return null;
  const geometry = wktToGeometry(task.geometry.geometry);
  const sourceId = useImageryStore.getState().address?.sourceId ?? null;
  const crosshairHex = sourceId != null ? catalog.sources.get(sourceId)?.crosshair_hex6 : null;
  return {
    center: geometryCentroid(geometry),
    extent: { geometry },
    crosshairColor: crosshairHex ? `#${crosshairHex}` : null,
    upcoming: upcomingCentroids(state),
  };
}

/** Publishes everything implied by selecting a task. Keeping this inside the
 *  session means callers cannot change task identity without also updating
 *  imagery, the probe point, and the shared map-focus seam. */
function publishSelection(catalog: Catalog): void {
  const state = useTaskSessionStore.getState();
  const task = currentTask(state);
  const imagery = useImageryStore.getState();
  const scope = task ? `task:${task.id}` : null;
  const taskChanged = imagery.emptyScope !== scope;

  if (taskChanged && task) {
    const session = useSessionStore.getState();
    const viewId = session.selectedViewId;
    const pinned = viewId == null ? undefined : usePrefsStore.getState().pinnedStart[viewId];
    const startCollectionId =
      pinned != null && catalog.collections.has(pinned)
        ? pinned
        : (session.taskStartCollectionId ?? imagery.address?.collectionId ?? null);
    imagery.resetForTask(catalog, startCollectionId, `task:${task.id}`);
    setProbePoint(null);
  } else {
    imagery.setEmptyScope(scope);
  }

  setMapFocus(deriveMapFocus(state, task, catalog));
}

export const useTaskSessionStore = create<TaskSessionState>((set, get) => ({
  ...initialState(),

  initialize: ({ tasks, taskSets, filter, currentUserId, now, catalog, preferTaskId }) => {
    const effectiveFilter =
      preferTaskId != null
        ? widenFilterForTask(tasks, filter, currentUserId, now, preferTaskId)
        : filter;
    const { visibleTasks, suggestedIndex } = applyTaskFilter(
      tasks,
      effectiveFilter,
      currentUserId,
      now,
      preferTaskId
    );
    set({
      allTasks: tasks,
      taskSets,
      visibleTasks,
      currentIndex: suggestedIndex,
      filter: effectiveFilter,
      currentUserId,
      loaded: true,
    });
    publishSelection(catalog);
  },

  setFilter: (filter, now, catalog) => {
    const state = get();
    const { visibleTasks, suggestedIndex } = applyTaskFilter(
      state.allTasks,
      filter,
      state.currentUserId,
      now
    );
    set({ filter, visibleTasks, currentIndex: suggestedIndex });
    publishSelection(catalog);
  },

  goToAnnotationNumber: (annotationNumber, catalog) => {
    const index = get().visibleTasks.findIndex(
      (task) => task.annotation_number === annotationNumber
    );
    if (index === -1) return false;
    set({ currentIndex: index });
    publishSelection(catalog);
    return true;
  },

  next: (catalog) => {
    const state = get();
    set({ currentIndex: nextIndex(state.visibleTasks, state.currentIndex) });
    publishSelection(catalog);
  },

  previous: (catalog) => {
    const state = get();
    set({ currentIndex: prevIndex(state.visibleTasks, state.currentIndex) });
    publishSelection(catalog);
  },

  replaceTask: (updated, catalog) => {
    const replace = (tasks: AnnotationTaskOut[]) =>
      tasks.map((task) => (task.id === updated.id ? updated : task));
    const state = get();
    set({ allTasks: replace(state.allTasks), visibleTasks: replace(state.visibleTasks) });
    publishSelection(catalog);
  },

  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  setKnnValidationEnabled: (knnValidationEnabled) => set({ knnValidationEnabled }),

  reset: () => {
    set(initialState());
    setMapFocus(null);
  },
}));

export function getCurrentTask(): AnnotationTaskOut | null {
  return currentTask(useTaskSessionStore.getState());
}
