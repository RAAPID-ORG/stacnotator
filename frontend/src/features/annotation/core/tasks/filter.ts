import type { AnnotationTaskOut, TaskSetOut } from '~/api/client';
import type { TaskStatus } from '~/features/annotation/core/apiTypes';
import { UNASSIGNED, getActiveClaim, isClaimable } from './claims';

export { UNASSIGNED } from './claims';

export interface TaskFilter {
  assignedTo: string[];
  statuses: TaskStatus[];
  selectedConfidences: number[];
  flaggedOnly: boolean;
  taskSetId: number | null;
}

export interface FilteredTasks {
  visibleTasks: AnnotationTaskOut[];
  suggestedIndex: number;
}

export interface TaskProgress {
  total: number;
  completed: number;
}

type TaskProgressInput = Pick<AnnotationTaskOut, 'task_status' | 'assignments'>;

/** Every task status, i.e. the "show me everything" filter. Exported because
 *  three call sites need exactly this list (the tour's temporary widening, the
 *  all-tasks-done escape hatch, and seedFilter's own broadest fallback). */
export const ALL_TASK_STATUSES: readonly TaskStatus[] = [
  'pending',
  'partial',
  'done',
  'skipped',
  'conflicting',
];

const RESOLVED_TASK_STATUSES: TaskStatus[] = ['done', 'skipped', 'conflicting'];

const isResolvedTask = (task: TaskProgressInput): boolean =>
  RESOLVED_TASK_STATUSES.includes((task.task_status ?? 'pending') as TaskStatus);

/**
 * Progress within the assignment scope of `assignedTo` (all tasks when empty;
 * the UNASSIGNED sentinel matches tasks without assignments). Scoped to users,
 * completion follows their own assignment status - matching the per-user
 * semantics of applyTaskFilter - because the task-level status lags at
 * 'partial' until co-assignees act (e.g. on review assignments) and must not
 * hold back the scoped users' progress.
 */
export const computeTaskProgress = (
  allTasks: TaskProgressInput[],
  assignedTo: string[]
): TaskProgress => {
  if (assignedTo.length === 0) {
    return {
      total: allTasks.length,
      completed: allTasks.filter(isResolvedTask).length,
    };
  }

  const wantUnassigned = assignedTo.includes(UNASSIGNED);
  let total = 0;
  let completed = 0;
  for (const task of allTasks) {
    const assignments = task.assignments || [];
    const scopedAssignments = assignments.filter((a) => assignedTo.includes(a.user_id));
    if (scopedAssignments.length > 0) {
      total += 1;
      if (scopedAssignments.every((a) => a.status !== 'pending')) completed += 1;
    } else if (wantUnassigned && assignments.length === 0) {
      total += 1;
      if (isResolvedTask(task)) completed += 1;
    }
  }
  return { total, completed };
};

// A task the current user is actively holding via their own live soft claim. Keeps it in
// their unassigned pool so a task they just claimed doesn't drop out of the list on re-entry.
const isHeldBy = (
  task: AnnotationTaskOut,
  userId: string | null | undefined,
  now: number
): boolean => userId != null && getActiveClaim(task, now)?.user_id === userId;

export const applyTaskFilter = (
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter,
  currentUserId: string | null | undefined,
  now: number,
  preferTaskId?: number
): FilteredTasks => {
  const filterByUser = filter.assignedTo.length > 0;
  const wantUnassigned = filter.assignedTo.includes(UNASSIGNED);
  const selectedUserIds = filter.assignedTo.filter((id) => id !== UNASSIGNED);

  const visibleTasks = allTasks.filter((task) => {
    if (filter.taskSetId !== null && task.task_set_id !== filter.taskSetId) return false;

    const assignments = task.assignments || [];
    const annotations = task.annotations || [];

    if (filterByUser) {
      const matchesUser =
        selectedUserIds.length > 0 &&
        assignments.some((a) => {
          if (!selectedUserIds.includes(a.user_id)) return false;
          if (!filter.statuses.includes(a.status)) return false;
          if (a.claimed_at != null && a.status === 'pending') return false; // pending soft claim
          return true;
        });
      const matchesUnassigned =
        wantUnassigned &&
        (isClaimable(task, now) || isHeldBy(task, currentUserId, now)) &&
        filter.statuses.includes(task.task_status ?? 'pending');
      if (!matchesUser && !matchesUnassigned) return false;
    } else if (!filter.statuses.includes(task.task_status ?? 'pending')) {
      return false;
    }

    if (filter.selectedConfidences.length > 0) {
      const taskConfs = annotations.map((a) => a.confidence ?? 0);
      if (taskConfs.length === 0) taskConfs.push(0);
      if (!taskConfs.some((c) => filter.selectedConfidences.includes(c))) return false;
    }

    if (filter.flaggedOnly && !annotations.some((a) => a.flagged_for_review)) {
      return false;
    }

    return true;
  });

  const preferredIdx =
    preferTaskId != null ? visibleTasks.findIndex((t) => t.id === preferTaskId) : -1;
  const suggestedIndex = preferredIdx >= 0 ? preferredIdx : 0;

  return { visibleTasks, suggestedIndex };
};

/**
 * Widens `filter` as little as it takes for `taskId` to be visible, for a deep
 * link into a task the seeded filter hides (the annotations page's "View" on a
 * done task, while the session seeds "my pending work"). Returned unchanged
 * when the task is already visible, or when no widening reaches it - a link to
 * a task of another campaign must not blank out the filter.
 */
export function widenFilterForTask(
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter,
  currentUserId: string | null | undefined,
  now: number,
  taskId: number
): TaskFilter {
  const shows = (candidate: TaskFilter): boolean =>
    applyTaskFilter(allTasks, candidate, currentUserId, now).visibleTasks.some(
      (task) => task.id === taskId
    );
  if (shows(filter)) return filter;

  const allStatuses = [...ALL_TASK_STATUSES];
  const candidates: TaskFilter[] = [
    { ...filter, statuses: allStatuses },
    { ...filter, statuses: allStatuses, assignedTo: [], taskSetId: null },
    {
      assignedTo: [],
      statuses: allStatuses,
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: null,
    },
  ];
  return candidates.find(shows) ?? filter;
}

/** Deep-link inputs for seedFilter: a task set id to try to land on first,
 *  and whether the campaign is public (public campaigns start on the shared
 *  unassigned pool rather than "mine", since there is no meaningful "mine"
 *  for an anonymous/public viewer). */
export interface SeedFilterDeepLink {
  taskSetId?: number;
  isPublic?: boolean;
}

/**
 * Seeds the initial TaskFilter a session lands on. Five levels are tried in
 * order and the first that yields a non-empty visible set wins:
 *   1. the user's own pending work (or the unassigned pool for a public
 *      campaign / no known user), scoped to a live deep-linked task set;
 *   2. the unassigned pool, still scoped to that set;
 *   3. every status, still scoped to that set (the set is abandoned only
 *      once none of its tasks show up under any status);
 *   4. the unassigned pool with no set scoping;
 *   5. every pending task, unscoped - the final, unconditional fallback.
 * When allTasks is empty every level is empty; the function then returns the
 * last candidate it tried rather than force-falling back to level 5 with
 * nothing to show.
 */
export function seedFilter(
  allTasks: AnnotationTaskOut[],
  taskSets: TaskSetOut[],
  currentUserId: string | null | undefined,
  now: number,
  deepLink: SeedFilterDeepLink = {}
): TaskFilter {
  const seededTaskSetId =
    deepLink.taskSetId !== undefined && taskSets.some((s) => s.id === deepLink.taskSetId)
      ? deepLink.taskSetId
      : null;
  const setHasTasks =
    seededTaskSetId !== null && allTasks.some((t) => t.task_set_id === seededTaskSetId);
  const effectiveSetId = setHasTasks ? seededTaskSetId : null;
  const showAll = deepLink.isPublic === true;

  const pendingFilter = (assignedTo: string[], taskSetId: number | null = null): TaskFilter => ({
    assignedTo,
    statuses: ['pending'],
    selectedConfidences: [],
    flaggedOnly: false,
    taskSetId,
  });

  const nonEmpty = (candidate: TaskFilter): boolean =>
    applyTaskFilter(allTasks, candidate, currentUserId, now).visibleTasks.length > 0;

  let filter = pendingFilter(
    showAll || !currentUserId ? [UNASSIGNED] : [currentUserId],
    effectiveSetId
  );
  if (nonEmpty(filter)) return filter;

  if (effectiveSetId !== null && currentUserId && !showAll) {
    filter = pendingFilter([UNASSIGNED], effectiveSetId);
    if (nonEmpty(filter)) return filter;
  }
  if (effectiveSetId !== null) {
    filter = {
      assignedTo: [],
      statuses: [...ALL_TASK_STATUSES],
      selectedConfidences: [],
      flaggedOnly: false,
      taskSetId: effectiveSetId,
    };
    if (nonEmpty(filter)) return filter;
  }
  if (currentUserId && !showAll) {
    filter = pendingFilter([UNASSIGNED]);
    if (nonEmpty(filter)) return filter;
  }
  if (allTasks.length > 0) {
    filter = pendingFilter([]);
  }
  return filter;
}
