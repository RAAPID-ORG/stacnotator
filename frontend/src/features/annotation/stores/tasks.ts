import { create } from 'zustand';
import {
  listTaskChanges,
  type AnnotationFromTaskOut,
  type TaskOut,
  type TaskSetOut,
} from '~/api/client';
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
import { campaignState, useCampaignStore } from './campaign';
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
  allTasks: TaskOut[];
  taskSets: TaskSetOut[];
  visibleTasks: TaskOut[];
  currentIndex: number;
  filter: TaskFilter;
  loaded: boolean;
  isSubmitting: boolean;
  /** Local "Validate" toggle for the KNN mismatch check, held here so the
   *  button and the hotkey read the same live value. */
  knnValidationEnabled: boolean;
  focus: MapFocus | null;
  /** Database clock the next task poll asks for changes since. */
  syncCursor: string | null;
  /** Ids of the tasks opened under the current filter, oldest first, and
   *  where in that trail the current task sits. Back and forward walk it like
   *  a browser's history, so a task the filter has since dropped (one just
   *  finished) is still one step back. Changing the filter starts a new one:
   *  the old trail leads into tasks the user has filtered away. */
  history: number[];
  historyPos: number;
  /** A task the poll found answered by someone else while it was the
   *  current one, so the panel can say so. */
  answeredElsewhereId: number | null;

  initialize: (options: {
    tasks: TaskOut[];
    taskSets: TaskSetOut[];
    filter: TaskFilter;
    catalog: ImageryCatalog;
    now: number;
    preferTaskId?: number;
  }) => void;
  setFilter: (filter: TaskFilter, now: number, catalog: ImageryCatalog) => void;
  goToAnnotationNumber: (annotationNumber: number, catalog: ImageryCatalog) => boolean;
  /** Forward along the trail, or to the next task in the list at its end. */
  next: (catalog: ImageryCatalog) => void;
  /** Back along the trail, or to the previous task in the list at its start. */
  previous: (catalog: ImageryCatalog) => void;
  /** Forward one step along the trail. False at its end, where the caller
   *  decides what the next new task is. */
  forward: (catalog: ImageryCatalog) => boolean;
  /** Back to the newest task on the trail. */
  latest: (catalog: ImageryCatalog) => void;
  replaceTask: (updated: TaskOut, catalog: ImageryCatalog) => void;
  /** Swap in newer copies of tasks without re-filtering, so work others
   *  finished counts toward progress without pulling the current task away. */
  mergeTasks: (updated: TaskOut[], catalog: ImageryCatalog) => void;
  /** Forget tasks deleted elsewhere. A deleted current task hands its place to
   *  the next one in the list. */
  removeTasks: (taskIds: number[], catalog: ImageryCatalog) => void;
  /** Pick up tasks others have worked, reassigned or deleted since the last poll. */
  syncRemoteTasks: () => Promise<void>;
  adoptTask: (claimed: TaskOut, catalog: ImageryCatalog) => void;
  setSubmitting: (isSubmitting: boolean) => void;
  setKnnValidationEnabled: (enabled: boolean) => void;
  reset: () => void;
}

const initialState = {
  allTasks: [] as TaskOut[],
  taskSets: [] as TaskSetOut[],
  visibleTasks: [] as TaskOut[],
  currentIndex: 0,
  filter: EMPTY_FILTER,
  loaded: false,
  isSubmitting: false,
  knnValidationEnabled: false,
  focus: null as MapFocus | null,
  syncCursor: null as string | null,
  history: [] as number[],
  historyPos: 0,
  answeredElsewhereId: null as number | null,
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

function deriveFocus(state: TasksState, task: TaskOut | null, catalog: ImageryCatalog) {
  if (!task) return null;
  const geometry = wktToGeometry(task.geometry_wkt);
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
      .map((t) => geometryCentroid(wktToGeometry(t.geometry_wkt))),
  };
}

/** Put `taskId` in the visible list if the filter has dropped it since, at its
 *  place in the campaign's order, and return the state that makes it current.
 *  Null when the task no longer exists. */
function showTask(state: TasksState, taskId: number): Partial<TasksState> | null {
  const index = state.visibleTasks.findIndex((t) => t.id === taskId);
  if (index >= 0) return { currentIndex: index };
  const order = new Map(state.allTasks.map((t, i) => [t.id, i]));
  const rank = order.get(taskId);
  if (rank === undefined) return null;
  const at = state.visibleTasks.findIndex((t) => (order.get(t.id) ?? -1) > rank);
  const insertAt = at === -1 ? state.visibleTasks.length : at;
  const visibleTasks = [...state.visibleTasks];
  visibleTasks.splice(insertAt, 0, state.allTasks[rank]);
  return { visibleTasks, currentIndex: insertAt };
}

/** Step `delta` along the trail, skipping tasks deleted since. False when
 *  there is no such step. */
function stepHistory(delta: 1 | -1, catalog: ImageryCatalog): boolean {
  const state = useTasksStore.getState();
  for (let pos = state.historyPos + delta; pos >= 0 && pos < state.history.length; pos += delta) {
    const shown = showTask(state, state.history[pos]);
    if (!shown) continue;
    useTasksStore.setState({ ...shown, historyPos: pos });
    publishSelection(catalog);
    return true;
  }
  return false;
}

/** Note the current task on the trail. Opening a task other than by walking
 *  the trail drops what lay ahead, as a browser does. */
function recordVisit(state: TasksState): Partial<TasksState> | null {
  const task = currentOf(state);
  if (!task || state.history[state.historyPos] === task.id) return null;
  const history = [...state.history.slice(0, state.historyPos + 1), task.id];
  return { history, historyPos: history.length - 1 };
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

  const visit = recordVisit(state);
  if (visit) useTasksStore.setState(visit);

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
      syncCursor: null,
      history: [],
      historyPos: 0,
    });
    publishSelection(catalog);
  },

  setFilter: (filter, now, catalog) => {
    const { allTasks } = get();
    const currentUserId = useCampaignStore.getState().currentUserId;
    const { visibleTasks, suggestedIndex } = applyTaskFilter(allTasks, filter, currentUserId, now);
    set({ filter, visibleTasks, currentIndex: suggestedIndex, history: [], historyPos: 0 });
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
    if (get().forward(catalog)) return;
    set((s) => ({ currentIndex: nextIndex(s.visibleTasks, s.currentIndex) }));
    publishSelection(catalog);
  },

  previous: (catalog) => {
    if (stepHistory(-1, catalog)) return;
    // Before the trail's start: step the list, and the trail grows backwards
    // so forward still leads back through what was already seen.
    const before = currentOf(get());
    set((s) => ({ currentIndex: prevIndex(s.visibleTasks, s.currentIndex) }));
    const task = currentOf(get());
    if (task && task.id !== before?.id) {
      set((s) => ({ history: [task.id, ...s.history.slice(s.historyPos)], historyPos: 0 }));
    }
    publishSelection(catalog);
  },

  forward: (catalog) => stepHistory(1, catalog),

  latest: (catalog) => {
    const { history, historyPos } = get();
    for (let pos = history.length - 1; pos > historyPos; pos--) {
      const shown = showTask(get(), history[pos]);
      if (!shown) continue;
      set({ ...shown, historyPos: pos });
      publishSelection(catalog);
      return;
    }
  },

  replaceTask: (updated, catalog) => get().mergeTasks([updated], catalog),

  mergeTasks: (updated, catalog) => {
    const byId = new Map(updated.map((task) => [task.id, task]));
    const swap = (tasks: TaskOut[]) => tasks.map((task) => byId.get(task.id) ?? task);
    set((s) => {
      const known = new Set(s.allTasks.map((task) => task.id));
      const added = updated.filter((task) => !known.has(task.id));
      return { allTasks: [...swap(s.allTasks), ...added], visibleTasks: swap(s.visibleTasks) };
    });
    publishSelection(catalog);
  },

  removeTasks: (taskIds, catalog) => {
    const gone = new Set(taskIds);
    set((s) => {
      const current = currentOf(s);
      const visibleTasks = s.visibleTasks.filter((task) => !gone.has(task.id));
      const kept = current ? visibleTasks.indexOf(current) : -1;
      return {
        allTasks: s.allTasks.filter((task) => !gone.has(task.id)),
        visibleTasks,
        currentIndex:
          kept >= 0 ? kept : Math.min(s.currentIndex, Math.max(visibleTasks.length - 1, 0)),
      };
    });
    publishSelection(catalog);
  },

  syncRemoteTasks: async () => {
    try {
      const { campaign, catalog } = campaignState();
      const result = await listTaskChanges({
        path: { campaign_id: campaign.id },
        query: { since: get().syncCursor },
      });
      const data = result.data;
      // The campaign can change under the request; its tasks are not this one's.
      if (!data || useCampaignStore.getState().campaign?.id !== campaign.id) return;
      const current = currentOf(get());
      const fresh = data.tasks.find((task) => task.id === current?.id);
      const { currentUserId } = useCampaignStore.getState();
      const isNew = (a: AnnotationFromTaskOut) =>
        a.created_by_user_id !== currentUserId && !current?.annotations.some((b) => b.id === a.id);
      set({ syncCursor: data.server_time });
      if (fresh?.annotations.some(isNew)) set({ answeredElsewhereId: fresh.id });
      if (data.tasks.length > 0) get().mergeTasks(data.tasks, catalog);
      const known = new Set(get().allTasks.map((task) => task.id));
      const deleted = (data.deleted ?? []).filter((id) => known.has(id));
      if (deleted.length > 0) get().removeTasks(deleted, catalog);
    } catch {
      // A missed poll is picked up by the next one.
    }
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

export const currentTask = (): TaskOut | null => currentOf(useTasksStore.getState());

export const useMapFocus = (): MapFocus | null => useTasksStore((s) => s.focus);

export const useCurrentTask = (): TaskOut | null =>
  useTasksStore((s) => s.visibleTasks[s.currentIndex] ?? null);
