import { create } from 'zustand';
import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import { geometryCentroid, squareAround, wktToGeometry } from '../campaign/annotation';
import type { ImageryCatalog } from '../campaign/imagery';
import {
  applyTaskFilter,
  nextIndex,
  prevIndex,
  widenFilterForTask,
  type TaskFilter,
} from '../campaign/tasks';
import { taskLandingCollectionId } from '../campaign/imageryNav';
import type { GeoFeature, LonLat } from '~/shared/map/types';
import { useCampaignStore } from './campaign';
import { useImageryStore } from './imagery';
import { usePrefsStore } from './prefs';
import { useWorkStore } from './work';

/** Where the page is pointed. Only tasks mode moves it; Explore leaves the
 *  user's own view alone. */
export interface MapFocus {
  /** Where recenter puts the map, and where the crosshair is drawn. */
  center: LonLat;
  /** Task footprint, or the campaign's sample extent around a point task.
   *  EPSG:4326, null when there is nothing to outline. */
  extent: GeoFeature | null;
  /** The active source's crosshair colour, '#rrggbb'. */
  crosshairColor: string | null;
  /** Centres the focus is about to move to, so panels that fetch per-point
   *  data can warm their caches without reaching into the task list. */
  upcoming: LonLat[];
}

const PREFETCH_AHEAD = 3;
const EMPTY_FILTER: TaskFilter = {
  assignedTo: [],
  statuses: ['pending'],
  selectedLabelIds: [],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

export interface TasksState {
  allTasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  visibleTasks: AnnotationTaskOut[];
  currentIndex: number;
  filter: TaskFilter;
  loaded: boolean;
  isSubmitting: boolean;
  /** Local "Validate" toggle for the KNN mismatch check, held here so the
   *  button and the hotkey read the same live value. */
  knnValidationEnabled: boolean;
  focus: MapFocus | null;

  initialize: (options: {
    tasks: AnnotationTaskOut[];
    taskSets: TaskSetOut[];
    filter: TaskFilter;
    catalog: ImageryCatalog;
    now: number;
    preferTaskId?: number;
  }) => void;
  setFilter: (filter: TaskFilter, now: number, catalog: ImageryCatalog) => void;
  goToAnnotationNumber: (annotationNumber: number, catalog: ImageryCatalog) => boolean;
  next: (catalog: ImageryCatalog) => void;
  previous: (catalog: ImageryCatalog) => void;
  replaceTask: (updated: AnnotationTaskOut, catalog: ImageryCatalog) => void;
  adoptTask: (claimed: AnnotationTaskOut, catalog: ImageryCatalog) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setKnnValidationEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const initialState = {
  allTasks: [] as AnnotationTaskOut[],
  taskSets: [] as TaskSetOut[],
  visibleTasks: [] as AnnotationTaskOut[],
  currentIndex: 0,
  filter: EMPTY_FILTER,
  loaded: false,
  isSubmitting: false,
  knnValidationEnabled: false,
  focus: null as MapFocus | null,
};

const currentOf = (state: TasksState) => state.visibleTasks[state.currentIndex] ?? null;

const samePoints = (a: LonLat[], b: LonLat[]) =>
  a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

/** Extents are rebuilt per selection, so identity says nothing about them. */
const sameExtent = (a: GeoFeature | null, b: GeoFeature | null) =>
  a === b || JSON.stringify(a?.geometry ?? null) === JSON.stringify(b?.geometry ?? null);

/** Callers rebuild the focus on every selection; comparing by value keeps that
 *  from re-rendering every map and restarting preloading. */
function sameFocus(a: MapFocus | null, b: MapFocus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.center[0] === b.center[0] &&
    a.center[1] === b.center[1] &&
    sameExtent(a.extent, b.extent) &&
    a.crosshairColor === b.crosshairColor &&
    samePoints(a.upcoming, b.upcoming)
  );
}

/** What the map outlines for a task: its own footprint, or - for a point task -
 *  the campaign's square sample extent around it. A point with no configured
 *  extent has no outline; the crosshair alone marks it. */
function focusExtent(
  geometry: GeoJSON.Geometry,
  center: LonLat,
  sampleExtentMeters: number | null
): GeoFeature | null {
  if (geometry.type !== 'Point') return { geometry };
  if (!sampleExtentMeters) return null;
  return { geometry: squareAround(center, sampleExtentMeters) };
}

function deriveFocus(state: TasksState, task: AnnotationTaskOut | null, catalog: ImageryCatalog) {
  if (!task) return null;
  const geometry = wktToGeometry(task.geometry.geometry);
  const sourceId = useImageryStore.getState().address?.sourceId ?? null;
  const hex = sourceId != null ? catalog.sources.get(sourceId)?.crosshair_hex6 : null;
  const settings = useCampaignStore.getState().campaign?.settings;
  const center = geometryCentroid(geometry);
  return {
    center,
    extent: focusExtent(geometry, center, settings?.sample_extent_meters ?? null),
    crosshairColor: hex ? `#${hex}` : null,
    upcoming: state.visibleTasks
      .slice(state.currentIndex + 1, state.currentIndex + 1 + PREFETCH_AHEAD)
      .map((t) => geometryCentroid(wktToGeometry(t.geometry.geometry))),
  };
}

/**
 * Everything selecting a task implies. Keeping it in here means no caller can
 * change which task is current without also moving the imagery, the probe
 * point and the focus.
 */
function publishSelection(catalog: ImageryCatalog): void {
  const state = useTasksStore.getState();
  const task = currentOf(state);
  const imagery = useImageryStore.getState();
  const scope = task ? `task:${task.id}` : null;

  if (task && imagery.emptyScope !== scope) {
    const { view, taskStartCollectionId } = useCampaignStore.getState();
    const start = taskLandingCollectionId(
      catalog,
      taskStartCollectionId,
      view ? usePrefsStore.getState().pinnedStart[view.id] : undefined,
      imagery.address?.collectionId ?? null
    );
    imagery.resetForTask(catalog, start, scope!);
    // Probes are comparisons at this task's location; the next task's map
    // is a different place, so they do not follow it.
    useWorkStore.getState().clearProbePoints();
  } else {
    imagery.setEmptyScope(scope);
  }

  const focus = deriveFocus(state, task, catalog);
  if (!sameFocus(focus, state.focus)) useTasksStore.setState({ focus });
}

export const useTasksStore = create<TasksState>((set, get) => ({
  ...initialState,

  initialize: ({ tasks, taskSets, filter, catalog, now, preferTaskId }) => {
    const currentUserId = useCampaignStore.getState().currentUserId;
    const effective =
      preferTaskId != null
        ? widenFilterForTask(tasks, filter, currentUserId, now, preferTaskId)
        : filter;
    const { visibleTasks, suggestedIndex } = applyTaskFilter(
      tasks,
      effective,
      currentUserId,
      now,
      preferTaskId
    );
    set({
      allTasks: tasks,
      taskSets,
      visibleTasks,
      currentIndex: suggestedIndex,
      filter: effective,
      loaded: true,
    });
    publishSelection(catalog);
  },

  setFilter: (filter, now, catalog) => {
    const { allTasks } = get();
    const currentUserId = useCampaignStore.getState().currentUserId;
    const { visibleTasks, suggestedIndex } = applyTaskFilter(allTasks, filter, currentUserId, now);
    set({ filter, visibleTasks, currentIndex: suggestedIndex });
    publishSelection(catalog);
  },

  goToAnnotationNumber: (annotationNumber, catalog) => {
    const index = get().visibleTasks.findIndex((t) => t.annotation_number === annotationNumber);
    if (index === -1) return false;
    set({ currentIndex: index });
    publishSelection(catalog);
    return true;
  },

  next: (catalog) => {
    set((s) => ({ currentIndex: nextIndex(s.visibleTasks, s.currentIndex) }));
    publishSelection(catalog);
  },

  previous: (catalog) => {
    set((s) => ({ currentIndex: prevIndex(s.visibleTasks, s.currentIndex) }));
    publishSelection(catalog);
  },

  replaceTask: (updated, catalog) => {
    const swap = (tasks: AnnotationTaskOut[]) =>
      tasks.map((task) => (task.id === updated.id ? updated : task));
    set((s) => ({ allTasks: swap(s.allTasks), visibleTasks: swap(s.visibleTasks) }));
    publishSelection(catalog);
  },

  adoptTask: (claimed, catalog) => {
    const { allTasks, filter } = get();
    const known = allTasks.some((task) => task.id === claimed.id);
    // Upsert, not replace: the server can hand back a task created after this
    // session loaded, and one somebody else was holding at load time was
    // filtered out of the visible list, so re-filtering is what surfaces it.
    const merged = known
      ? allTasks.map((task) => (task.id === claimed.id ? claimed : task))
      : [...allTasks, claimed];
    const currentUserId = useCampaignStore.getState().currentUserId;
    const { visibleTasks, suggestedIndex } = applyTaskFilter(
      merged,
      filter,
      currentUserId,
      Date.now(),
      claimed.id
    );
    set({ allTasks: merged, visibleTasks, currentIndex: suggestedIndex });
    publishSelection(catalog);
  },

  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  setKnnValidationEnabled: (knnValidationEnabled) => set({ knnValidationEnabled }),
  reset: () => set(initialState),
}));

export const currentTask = (): AnnotationTaskOut | null => currentOf(useTasksStore.getState());

export const useMapFocus = (): MapFocus | null => useTasksStore((s) => s.focus);

export const useCurrentTask = (): AnnotationTaskOut | null =>
  useTasksStore((s) => s.visibleTasks[s.currentIndex] ?? null);
