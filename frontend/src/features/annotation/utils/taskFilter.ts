import type { AnnotationTaskAssignmentOut, AnnotationTaskOut } from '~/api/client';
import type { TaskStatus } from '~/shared/utils/taskStatus';

// Sentinel value usable inside TaskFilter.assignedTo to match tasks that have
// no assignments. Lets the assignee filter express "unassigned" explicitly.
export const UNASSIGNED = '__unassigned__';

// Must mirror backend CLAIM_TTL_MINUTES; a claim older than this is stale/available.
export const CLAIM_TTL_MS = 30 * 60 * 1000;

const isStaleClaim = (a: AnnotationTaskAssignmentOut, now: number): boolean =>
  a.claimed_at != null &&
  a.status === 'pending' &&
  now - new Date(a.claimed_at).getTime() > CLAIM_TTL_MS;

// A task can be soft-claimed if no one has worked it and every assignment is a stale
// soft claim. Truly-unassigned tasks satisfy `[].every(...) === true`.
export const isClaimable = (task: AnnotationTaskOut): boolean => {
  if ((task.annotations || []).length > 0) return false;
  const now = Date.now();
  return (task.assignments || []).every((a) => isStaleClaim(a, now));
};

// The active soft claim currently holding a task (for the "Claimed by" badge), or null.
export const getActiveClaim = (task: AnnotationTaskOut): AnnotationTaskAssignmentOut | null => {
  const now = Date.now();
  return (
    (task.assignments || []).find(
      (a) =>
        a.claimed_at != null &&
        a.status === 'pending' &&
        now - new Date(a.claimed_at).getTime() <= CLAIM_TTL_MS
    ) ?? null
  );
};

export interface TaskFilter {
  assignedTo: string[];
  statuses: TaskStatus[];
  selectedConfidences: number[];
  flaggedOnly: boolean;
}

export interface FilteredTasks {
  visibleTasks: AnnotationTaskOut[];
  suggestedIndex: number;
}

export const applyTaskFilter = (
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter,
  preferTaskId?: number
): FilteredTasks => {
  const filterByUser = filter.assignedTo.length > 0;
  const wantUnassigned = filter.assignedTo.includes(UNASSIGNED);
  const selectedUserIds = filter.assignedTo.filter((id) => id !== UNASSIGNED);

  const visibleTasks = allTasks.filter((task) => {
    const assignments = task.assignments || [];
    const annotations = task.annotations || [];

    if (filterByUser) {
      const matchesUser =
        selectedUserIds.length > 0 &&
        assignments.some((a) => {
          if (!selectedUserIds.includes(a.user_id)) return false;
          if (!filter.statuses.includes(a.status as TaskStatus)) return false;
          if (a.claimed_at != null && a.status === 'pending') return false; // pending soft claim
          return true;
        });
      const matchesUnassigned =
        wantUnassigned &&
        isClaimable(task) &&
        filter.statuses.includes(task.task_status as TaskStatus);
      if (!matchesUser && !matchesUnassigned) return false;
    } else if (!filter.statuses.includes(task.task_status as TaskStatus)) {
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
