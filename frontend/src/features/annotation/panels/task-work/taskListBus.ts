import { useSyncExternalStore } from 'react';
import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import { wktToGeometry, geometryCentroid } from '~/features/annotation/core/annotation';
import type { Catalog } from '~/features/annotation/core/catalog';
import {
  applyTaskFilter,
  nextIndex,
  prevIndex,
  type TaskFilter,
} from '~/features/annotation/core/tasks';
import { useImageryStore } from '~/features/annotation/stores';
import { setMapFocus, type MapFocus } from '~/features/annotation/panels/shared/mapFocus';
import type { LonLat } from '~/features/annotation/engine/map';

export interface TaskListState {
  allTasks: AnnotationTaskOut[];
  taskSets: TaskSetOut[];
  visibleTasks: AnnotationTaskOut[];
  currentIndex: number;
  filter: TaskFilter;
  currentUserId: string | null;
  loaded: boolean;
  isSubmitting: boolean;
  /** Local "Validate" toggle for the KNN mismatch check - a panel-level
   *  preference, not a per-campaign availability computation. Lives here, not
   *  component state, so the Enter hotkey (which runs outside any component
   *  instance) reads the same value the checkbox set. */
  knnValidationEnabled: boolean;
}

const EMPTY_FILTER: TaskFilter = {
  assignedTo: [],
  statuses: ['pending'],
  selectedConfidences: [],
  flaggedOnly: false,
  taskSetId: null,
};

let state: TaskListState = {
  allTasks: [],
  taskSets: [],
  visibleTasks: [],
  currentIndex: 0,
  filter: EMPTY_FILTER,
  currentUserId: null,
  loaded: false,
  isSubmitting: false,
  knnValidationEnabled: false,
};

const listeners = new Set<() => void>();

function set(next: Partial<TaskListState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function getTaskListState(): TaskListState {
  return state;
}

export function getCurrentTask(): AnnotationTaskOut | null {
  return state.visibleTasks[state.currentIndex] ?? null;
}

export function useTaskListState(): TaskListState {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getTaskListState,
    getTaskListState
  );
}

/** Derives the map focus from a task's own geometry (center + footprint) and
 *  the currently active imagery source's crosshair colour. Exported so
 *  TaskControlsPanel can push the same focus on the initial task load,
 *  before any navigation action has run. */
export function deriveMapFocus(task: AnnotationTaskOut | null, catalog: Catalog): MapFocus | null {
  if (!task) return null;
  const geometry = wktToGeometry(task.geometry.geometry);
  const sourceId = useImageryStore.getState().address?.sourceId ?? null;
  const crosshairHex = sourceId != null ? catalog.sources.get(sourceId)?.crosshair_hex6 : null;
  return {
    center: geometryCentroid(geometry),
    extent: { geometry },
    crosshairColor: crosshairHex ? `#${crosshairHex}` : null,
    upcoming: upcomingCentroids(),
  };
}

/** The next few tasks' centroids, so per-point panels (the timeseries charts)
 *  can prefetch what the user is about to navigate to. */
function upcomingCentroids(): LonLat[] {
  return state.visibleTasks
    .slice(state.currentIndex + 1, state.currentIndex + 1 + PREFETCH_AHEAD)
    .map((task) => geometryCentroid(wktToGeometry(task.geometry.geometry)));
}

const PREFETCH_AHEAD = 3;

/** Pushes the current task's focus. Safe to call unconditionally - setMapFocus
 *  itself no-ops on an unchanged value. */
export function syncMapFocus(catalog: Catalog): void {
  setMapFocus(deriveMapFocus(getCurrentTask(), catalog));
}

/** Seeds the bus from loadCampaign's result (or a later reload). Applies the
 *  filter to derive visibleTasks/currentIndex - loadCampaign only seeds the
 *  filter itself, matching this module's responsibility for what it selects. */
export function initTaskList(
  allTasks: AnnotationTaskOut[],
  taskSets: TaskSetOut[],
  filter: TaskFilter,
  currentUserId: string | null,
  now: number,
  preferTaskId?: number
): void {
  const { visibleTasks, suggestedIndex } = applyTaskFilter(
    allTasks,
    filter,
    currentUserId,
    now,
    preferTaskId
  );
  set({
    allTasks,
    taskSets,
    visibleTasks,
    currentIndex: suggestedIndex,
    filter,
    currentUserId,
    loaded: true,
  });
}

export function setFilter(filter: TaskFilter, now: number, catalog: Catalog): void {
  const { visibleTasks, suggestedIndex } = applyTaskFilter(
    state.allTasks,
    filter,
    state.currentUserId,
    now
  );
  set({ filter, visibleTasks, currentIndex: suggestedIndex });
  syncMapFocus(catalog);
}

export function goToIndex(index: number, catalog: Catalog): void {
  if (index < 0 || index >= state.visibleTasks.length) return;
  set({ currentIndex: index });
  syncMapFocus(catalog);
}

export function next(catalog: Catalog): void {
  set({ currentIndex: nextIndex(state.visibleTasks, state.currentIndex) });
  syncMapFocus(catalog);
}

export function previous(catalog: Catalog): void {
  set({ currentIndex: prevIndex(state.visibleTasks, state.currentIndex) });
  syncMapFocus(catalog);
}

export function goToAnnotationNumber(annotationNumber: number, catalog: Catalog): boolean {
  const index = state.visibleTasks.findIndex((t) => t.annotation_number === annotationNumber);
  if (index === -1) return false;
  set({ currentIndex: index });
  syncMapFocus(catalog);
  return true;
}

/** Replaces one task in both lists in place - submissions and claims never
 *  add or remove list entries, so currentIndex stays well-defined. Re-syncs
 *  the focus too: the replaced task may be the current one, and while its
 *  geometry never actually changes on a submit/claim, recomputing here
 *  keeps this function correct without callers having to reason about it -
 *  setMapFocus's own by-value check makes the common no-op case free. */
export function replaceTask(updated: AnnotationTaskOut, catalog: Catalog): void {
  const replace = (list: AnnotationTaskOut[]) =>
    list.map((t) => (t.id === updated.id ? updated : t));
  set({ allTasks: replace(state.allTasks), visibleTasks: replace(state.visibleTasks) });
  syncMapFocus(catalog);
}

export function setSubmitting(isSubmitting: boolean): void {
  set({ isSubmitting });
}

export function setKnnValidationEnabled(knnValidationEnabled: boolean): void {
  set({ knnValidationEnabled });
}

export function resetTaskList(): void {
  set({
    allTasks: [],
    taskSets: [],
    visibleTasks: [],
    currentIndex: 0,
    filter: EMPTY_FILTER,
    currentUserId: null,
    loaded: false,
    isSubmitting: false,
    knnValidationEnabled: false,
  });
  setMapFocus(null);
}
