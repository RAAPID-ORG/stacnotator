import { create } from 'zustand';
import { getTaskDetails, getTaskSummary, type TaskOut, type TaskSetOut } from '~/api/client';
import {
  decodeTaskSummary,
  taskRowFromTaskOut,
  type TaskRow,
  type TaskRowAnswer,
} from '~/shared/utils/taskSummary';
import { squareAround, wktToGeometry } from '../campaign/annotation';
import { isZonalGeometry, probeLocation, type TimeseriesLocation } from '../campaign/probes';
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
  /** Null until the current task's details bring its geometry. */
  timeseriesLocation: TimeseriesLocation | null;
  upcomingTimeseriesLocations: TimeseriesLocation[];
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
  allTasks: TaskRow[];
  taskSets: TaskSetOut[];
  visibleTasks: TaskRow[];
  currentIndex: number;
  /** Everything about the current task the summary leaves out (geometry, form
   *  values, slice notes). Read it through `currentTaskDetails`, which checks
   *  it still belongs to the current task. */
  currentDetails: TaskOut | null;
  /** Details of the tasks prefetched after the current one, by id. */
  upcomingDetails: Record<number, TaskOut>;
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
    tasks: TaskRow[];
    taskSets: TaskSetOut[];
    /** The summary's `server_time`, so the first poll picks up what was
     *  written since the tasks were read. */
    syncCursor: string | null;
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
  replaceTask: (updated: TaskRow, catalog: ImageryCatalog) => void;
  /** Swap in newer copies of tasks without re-filtering, so work others
   *  finished counts toward progress without pulling the current task away. */
  mergeTasks: (updated: TaskRow[], catalog: ImageryCatalog) => void;
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
  allTasks: [] as TaskRow[],
  taskSets: [] as TaskSetOut[],
  visibleTasks: [] as TaskRow[],
  currentIndex: 0,
  currentDetails: null as TaskOut | null,
  upcomingDetails: {} as Record<number, TaskOut>,
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

const detailsOf = (state: TasksState): TaskOut | null => {
  const task = currentOf(state);
  return task && state.currentDetails?.id === task.id ? state.currentDetails : null;
};

const sameAnswers = (a: TaskRowAnswer[], b: TaskRowAnswer[]) =>
  JSON.stringify(a) === JSON.stringify(b);

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
    samePoints(a.upcoming, b.upcoming) &&
    JSON.stringify(a.timeseriesLocation) === JSON.stringify(b.timeseriesLocation) &&
    JSON.stringify(a.upcomingTimeseriesLocations) === JSON.stringify(b.upcomingTimeseriesLocations)
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

/** A point task is located by the summary's centroid rather than its own
 *  coordinates, so it matches the key it was prefetched under as an upcoming
 *  task. */
const taskLocation = (geometry: GeoJSON.Geometry, center: LonLat): TimeseriesLocation =>
  isZonalGeometry(geometry) ? geometry : probeLocation(center);

/** The centre comes from the summary and never moves once the details arrive;
 *  the outline and the time series location wait for the details' geometry. */
function deriveFocus(state: TasksState, task: TaskRow | null, catalog: ImageryCatalog) {
  if (!task) return null;
  const details = detailsOf(state);
  const geometry = details ? wktToGeometry(details.geometry_wkt) : null;
  const sourceId = useImageryStore.getState().address?.sourceId ?? null;
  const hex = sourceId != null ? catalog.sources.get(sourceId)?.crosshair_hex6 : null;
  const settings = useCampaignStore.getState().campaign?.settings;
  const center: LonLat = [task.lon, task.lat];
  const ahead = upcomingOf(state);
  const upcoming = ahead.map((t): LonLat => [t.lon, t.lat]);
  return {
    center,
    extent: geometry ? focusExtent(geometry, center, settings?.sample_extent_meters ?? null) : null,
    crosshairColor: hex ? `#${hex}` : null,
    upcoming,
    timeseriesLocation: geometry ? taskLocation(geometry, center) : null,
    // Only tasks whose details are here: a polygon task's series is zonal, and
    // guessing a point for it would prefetch one nobody is shown.
    upcomingTimeseriesLocations: ahead.flatMap((t) => {
      const upcomingDetails = state.upcomingDetails[t.id];
      return upcomingDetails
        ? [taskLocation(wktToGeometry(upcomingDetails.geometry_wkt), [t.lon, t.lat])]
        : [];
    }),
  };
}

function publishFocus(catalog: ImageryCatalog): void {
  const state = useTasksStore.getState();
  const focus = deriveFocus(state, currentOf(state), catalog);
  if (!sameFocus(focus, state.focus)) useTasksStore.setState({ focus });
}

const upcomingOf = (state: TasksState) =>
  state.visibleTasks.slice(state.currentIndex + 1, state.currentIndex + 1 + PREFETCH_AHEAD);

/** The latest request asked for each task; an older response for it is stale. */
const latestRequest = new Map<number, number>();
let detailsSeq = 0;
/** Tasks whose details are known to be out of date and are kept on screen only until
 *  a refresh lands, so a failed one is asked again by the next poll. */
const staleDetails = new Set<number>();

/** Fetch the details of ``taskIds`` in one request, for the current task and the
 *  ones prefetched after it. */
function loadDetails(taskIds: number[], catalog: ImageryCatalog): void {
  const campaignId = useCampaignStore.getState().campaign?.id;
  if (campaignId == null || taskIds.length === 0) return;
  const seq = ++detailsSeq;
  taskIds.forEach((id) => latestRequest.set(id, seq));
  const settle = (tasks: TaskOut[]) => {
    const fresh = tasks.filter((t) => latestRequest.get(t.id) === seq);
    fresh.forEach((t) => staleDetails.delete(t.id));
    taskIds.forEach((id) => {
      if (latestRequest.get(id) === seq) latestRequest.delete(id);
    });
    if (useCampaignStore.getState().campaign?.id !== campaignId) return;
    const state = useTasksStore.getState();
    const currentId = currentOf(state)?.id;
    const ahead = new Set(upcomingOf(state).map((t) => t.id));
    const upcomingDetails = Object.fromEntries(
      Object.entries(state.upcomingDetails).filter(([id]) => ahead.has(Number(id)))
    );
    let currentDetails = state.currentDetails;
    for (const task of fresh) {
      if (task.id === currentId) currentDetails = task;
      else if (ahead.has(task.id)) upcomingDetails[task.id] = task;
    }
    useTasksStore.setState({ currentDetails, upcomingDetails });
    publishFocus(catalog);
  };
  getTaskDetails({ path: { campaign_id: campaignId }, query: { ids: taskIds } }).then(
    ({ data }) => settle(data?.tasks ?? []),
    // The next task poll asks again.
    () => settle([])
  );
}

/** Fetch whatever details of the current task and the next few are neither here
 *  nor on their way; prefetched ones become current the moment their task does. */
function ensureDetails(catalog: ImageryCatalog): void {
  const state = useTasksStore.getState();
  const task = currentOf(state);
  if (!task) return;
  const prefetched = state.upcomingDetails[task.id];
  if (!detailsOf(state) && prefetched) useTasksStore.setState({ currentDetails: prefetched });
  const now = useTasksStore.getState();
  const missing = [task, ...upcomingOf(now)]
    .map((t) => t.id)
    .filter((id) => !latestRequest.has(id))
    .filter((id) =>
      id === task.id ? !detailsOf(now) || staleDetails.has(id) : !now.upcomingDetails[id]
    );
  loadDetails(missing, catalog);
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
    const start = taskLandingCollectionId(
      useCampaignStore.getState().taskStartCollectionId,
      imagery.address?.collectionId ?? null
    );
    imagery.resetForTask(catalog, start, scope!);
    // Probes are comparisons at this task's location; the next task's map
    // is a different place, so they do not follow it.
    useWorkStore.getState().clearProbes();
  } else {
    imagery.setEmptyScope(scope);
  }

  const visit = recordVisit(state);
  if (visit) useTasksStore.setState(visit);
  if (state.currentDetails && state.currentDetails.id !== task?.id) {
    useTasksStore.setState({ currentDetails: null });
  }

  ensureDetails(catalog);
  publishFocus(catalog);
}

export const useTasksStore = create<TasksState>((set, get) => ({
  ...initialState,

  initialize: ({ tasks, taskSets, syncCursor, filter, catalog, now, preferTaskId }) => {
    latestRequest.clear();
    staleDetails.clear();
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
      currentDetails: null,
      upcomingDetails: {},
      syncCursor,
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
    const swap = (tasks: TaskRow[]) => tasks.map((task) => byId.get(task.id) ?? task);
    const current = currentOf(get());
    // Answers are the only part of the details a merge can make stale; a
    // claim changing hands is already all in the row.
    const before = new Map(get().allTasks.map((task) => [task.id, task]));
    const answersChanged = new Set(
      updated
        .filter((task) => {
          const old = before.get(task.id);
          return old && !sameAnswers(old.annotations, task.annotations);
        })
        .map((task) => task.id)
    );
    set((s) => {
      const known = new Set(s.allTasks.map((task) => task.id));
      const added = updated.filter((task) => !known.has(task.id));
      return {
        allTasks: [...swap(s.allTasks), ...added],
        visibleTasks: swap(s.visibleTasks),
        upcomingDetails: Object.fromEntries(
          Object.entries(s.upcomingDetails).filter(([id]) => !answersChanged.has(Number(id)))
        ),
      };
    });
    // A response already on its way for a changed task predates the change.
    answersChanged.forEach((id) => latestRequest.delete(id));
    if (current && answersChanged.has(current.id)) {
      staleDetails.add(current.id);
      loadDetails([current.id], catalog);
    }
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
      const result = await getTaskSummary({
        path: { campaign_id: campaign.id },
        query: { since: get().syncCursor },
      });
      const data = result.data;
      // The campaign can change under the request; its tasks are not this one's.
      if (!data || useCampaignStore.getState().campaign?.id !== campaign.id) return;
      const tasks = decodeTaskSummary(data);
      const current = currentOf(get());
      const fresh = tasks.find((task) => task.id === current?.id);
      const { currentUserId } = useCampaignStore.getState();
      const isNew = (a: TaskRowAnswer) =>
        a.created_by_user_id !== currentUserId && !current?.annotations.some((b) => b.id === a.id);
      set({ syncCursor: data.server_time });
      if (fresh?.annotations.some(isNew)) set({ answeredElsewhereId: fresh.id });
      if (tasks.length > 0) get().mergeTasks(tasks, catalog);
      ensureDetails(catalog);
    } catch {
      // A missed poll is picked up by the next one.
    }
  },

  adoptTask: (claimed, catalog) => {
    const { allTasks, filter } = get();
    const known = allTasks.find((task) => task.id === claimed.id);
    const fromClaim = taskRowFromTaskOut(claimed);
    // The summary's centroid is the server's; keeping it stops the next poll
    // from nudging the camera.
    const row = known ? { ...fromClaim, lon: known.lon, lat: known.lat } : fromClaim;
    // Upsert, not replace: the server can hand back a task created after this
    // session loaded, and one somebody else was holding at load time was
    // filtered out of the visible list, so re-filtering is what surfaces it.
    const merged = known
      ? allTasks.map((task) => (task.id === claimed.id ? row : task))
      : [...allTasks, row];
    const currentUserId = useCampaignStore.getState().currentUserId;
    const { visibleTasks, suggestedIndex } = applyTaskFilter(
      merged,
      filter,
      currentUserId,
      Date.now(),
      claimed.id
    );
    set({ allTasks: merged, visibleTasks, currentIndex: suggestedIndex, currentDetails: claimed });
    publishSelection(catalog);
  },

  setSubmitting: (isSubmitting) => set({ isSubmitting }),
  setKnnValidationEnabled: (knnValidationEnabled) => set({ knnValidationEnabled }),
  reset: () => {
    latestRequest.clear();
    staleDetails.clear();
    set(initialState);
  },
}));

export const currentTask = (): TaskRow | null => currentOf(useTasksStore.getState());

export const currentTaskDetails = (): TaskOut | null => detailsOf(useTasksStore.getState());

export const useMapFocus = (): MapFocus | null => useTasksStore((s) => s.focus);

export const useCurrentTask = (): TaskRow | null => useTasksStore(currentOf);

/** The current task's details, null until they arrive. */
export const useCurrentTaskDetails = (): TaskOut | null => useTasksStore(detailsOf);
