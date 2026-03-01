/**
 * Task store – owns annotation task state for the main imagery window:
 *  - Loading tasks from the backend
 *  - Navigating between tasks (next / prev / go-to)
 *  - Deriving the center point of the current task
 *
 * Deliberately minimal: no filtering, no submission, no form state.
 * Those concerns live in the existing annotation.store.ts.
 */

import { create } from 'zustand';
import type { AnnotationTaskOut } from '~/api/client';
import { getAllAnnotationTasks } from '~/api/client';
import { extractLatLonFromWKT } from '~/shared/utils/utility';
import { DEFAULT_MAP_ZOOM } from '~/shared/utils/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract [lon, lat] from a task's WKT geometry (used as map center). */
export function taskCenter(task: AnnotationTaskOut): [number, number] | null {
  const result = extractLatLonFromWKT(task.geometry.geometry);
  if (!result) return null;
  return [result.lon, result.lat]; // OL uses [lon, lat]
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TaskState {
  campaignId: number | null;
  tasks: AnnotationTaskOut[];
  currentIndex: number;
  isLoading: boolean;
  error: string | null;
}

interface TaskActions {
  /** Load all tasks for a campaign. Idempotent if already loaded for the same campaign. */
  loadTasks: (campaignId: number) => Promise<void>;

  /** Navigate forward; wraps around. */
  next: () => void;

  /** Navigate backward; wraps around. */
  prev: () => void;

  /** Jump to a specific index. */
  goTo: (index: number) => void;

  /** Reset store state (e.g. on campaign change). */
  reset: () => void;
}

export type TaskStore = TaskState & TaskActions;

// ---------------------------------------------------------------------------
// Derived selectors (call outside the store to keep state slim)
// ---------------------------------------------------------------------------

/** Returns the currently selected task or null. */
export const selectCurrentTask = (s: TaskStore): AnnotationTaskOut | null =>
  s.tasks[s.currentIndex] ?? null;

/** Returns the [lon, lat] center of the current task, or null. */
export const selectCurrentTaskCenter = (s: TaskStore): [number, number] | null => {
  const task = selectCurrentTask(s);
  return task ? taskCenter(task) : null;
};

/** Returns suggested zoom from imagery default_zoom if available (passed externally). */
export const DEFAULT_TASK_ZOOM = DEFAULT_MAP_ZOOM;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialState: TaskState = {
  campaignId: null,
  tasks: [],
  currentIndex: 0,
  isLoading: false,
  error: null,
};

export const useTaskStore = create<TaskStore>((set, get) => ({
  ...initialState,

  loadTasks: async (campaignId) => {
    // Already loaded for this campaign – skip
    if (get().campaignId === campaignId && get().tasks.length > 0) return;

    set({ isLoading: true, error: null, campaignId });

    try {
      const response = await getAllAnnotationTasks({ path: { campaign_id: campaignId } });
      const tasks = response.data?.tasks ?? [];
      set({ tasks, currentIndex: 0, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks';
      set({ error: message, isLoading: false });
    }
  },

  next: () => {
    const { tasks, currentIndex } = get();
    if (tasks.length === 0) return;
    set({ currentIndex: (currentIndex + 1) % tasks.length });
  },

  prev: () => {
    const { tasks, currentIndex } = get();
    if (tasks.length === 0) return;
    set({ currentIndex: (currentIndex - 1 + tasks.length) % tasks.length });
  },

  goTo: (index) => {
    const { tasks } = get();
    if (index < 0 || index >= tasks.length) return;
    set({ currentIndex: index });
  },

  reset: () => set(initialState),
}));
