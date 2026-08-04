import type { AnnotationTaskOut } from '~/api/client';
import type { TaskStatus } from '~/shared/utils/taskStatus';

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

export interface TaskProgress {
  total: number;
  completed: number;
}

type TaskProgressInput = Pick<AnnotationTaskOut, 'task_status' | 'assignments'>;

const RESOLVED_TASK_STATUSES = ['done', 'skipped', 'conflicting'];

/**
 * Progress within the assignment scope of `assignedTo` (all tasks when empty).
 * Scoped to users, completion follows their own assignment status - matching
 * the per-user semantics of applyTaskFilter - because the task-level status
 * lags at 'partial' until co-assignees act (e.g. on review assignments) and
 * must not hold back the scoped users' progress.
 */
export const computeTaskProgress = (
  allTasks: TaskProgressInput[],
  assignedTo: string[]
): TaskProgress => {
  if (assignedTo.length === 0) {
    return {
      total: allTasks.length,
      completed: allTasks.filter((t) => RESOLVED_TASK_STATUSES.includes(t.task_status ?? ''))
        .length,
    };
  }

  const scoped = allTasks.filter((t) =>
    (t.assignments || []).some((a) => assignedTo.includes(a.user_id))
  );
  return {
    total: scoped.length,
    completed: scoped.filter((t) =>
      (t.assignments || [])
        .filter((a) => assignedTo.includes(a.user_id))
        .every((a) => a.status !== 'pending')
    ).length,
  };
};

export const applyTaskFilter = (
  allTasks: AnnotationTaskOut[],
  filter: TaskFilter,
  preferTaskId?: number
): FilteredTasks => {
  const filterByUser = filter.assignedTo.length > 0;

  const visibleTasks = allTasks.filter((task) => {
    const assignments = task.assignments || [];
    const annotations = task.annotations || [];

    if (filterByUser) {
      const userAssignments = assignments.filter((a) => filter.assignedTo.includes(a.user_id));
      if (userAssignments.length === 0) return false;
      if (!userAssignments.some((a) => filter.statuses.includes(a.status as TaskStatus)))
        return false;
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
