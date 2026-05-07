import type { AnnotationTaskOut } from '~/api/client';

export type TaskStatus = 'pending' | 'partial' | 'done' | 'skipped' | 'conflicting';

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
