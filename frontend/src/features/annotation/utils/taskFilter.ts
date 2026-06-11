import type { AnnotationTaskOut } from '~/api/client';
import type { TaskStatus } from '~/shared/utils/taskStatus';

// Sentinel value usable inside TaskFilter.assignedTo to match tasks that have
// no assignments. Lets the assignee filter express "unassigned" explicitly.
export const UNASSIGNED = '__unassigned__';

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
        assignments.some(
          (a) =>
            selectedUserIds.includes(a.user_id) && filter.statuses.includes(a.status as TaskStatus)
        );
      const matchesUnassigned =
        wantUnassigned &&
        assignments.length === 0 &&
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
