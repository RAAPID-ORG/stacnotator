import type { AnnotationTaskOut } from '~/api/client';

/**
 * Task-level status values, matching backend-computed task_status.
 */
export type TaskStatus = 'pending' | 'partial' | 'conflicting' | 'done' | 'skipped';

/**
 * Task status configuration with colors and labels
 */
export const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; badgeClass: string }
> = {
  pending: {
    label: 'Pending',
    color: '#6B7280', // gray
    badgeClass: 'bg-gray-100 text-gray-700',
  },
  partial: {
    label: 'Partial',
    color: '#F59E0B', // amber
    badgeClass: 'bg-yellow-100 text-yellow-700',
  },
  conflicting: {
    label: 'Conflicting',
    color: '#EF4444', // red
    badgeClass: 'bg-red-100 text-red-700',
  },
  done: {
    label: 'Complete',
    color: '#10B981', // green
    badgeClass: 'bg-green-100 text-green-700',
  },
  skipped: {
    label: 'Skipped',
    color: '#8B5CF6', // violet
    badgeClass: 'bg-violet-100 text-violet-700',
  },
};

/**
 * Get status badge color class based on task status
 */
export function getTaskStatusColor(status: TaskStatus): string {
  return TASK_STATUS_CONFIG[status]?.badgeClass ?? 'bg-gray-100 text-gray-700';
}

/**
 * Get user completion badge color
 */
export function getUserStatusColor(completed: boolean): string {
  return completed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700';
}

/**
 * Format task status for display
 */
export function formatTaskStatus(status: TaskStatus): string {
  return TASK_STATUS_CONFIG[status]?.label ?? status;
}

/**
 * Count tasks by status. Returns a record keyed by every TaskStatus so
 * consumers can read `counts.done` directly without falling back to 0.
 */
export function countTasksByStatus(
  tasks: readonly AnnotationTaskOut[]
): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    partial: 0,
    conflicting: 0,
    done: 0,
    skipped: 0,
  };
  for (const t of tasks) {
    const s = t.task_status as TaskStatus;
    if (s in counts) counts[s]++;
  }
  return counts;
}

/**
 * Get user-specific completion status for a task.
 * Returns the status for each assigned user based on assignments and annotations.
 */
export function getUserTaskStatuses(
  task: AnnotationTaskOut
): Map<string, 'pending' | 'completed' | 'skipped'> {
  const statusMap = new Map<string, 'pending' | 'completed' | 'skipped'>();
  const assignments = task.assignments || [];
  const annotations = task.annotations || [];
  // Only labeled annotations count as completions
  const completedUserIds = new Set(
    annotations.filter((a) => a.label_id != null).map((a) => a.created_by_user_id)
  );

  assignments.forEach((assignment) => {
    if (assignment.status === 'skipped') {
      statusMap.set(assignment.user_id, 'skipped');
    } else if (completedUserIds.has(assignment.user_id)) {
      statusMap.set(assignment.user_id, 'completed');
    } else {
      statusMap.set(assignment.user_id, 'pending');
    }
  });

  return statusMap;
}

/**
 * Check if current user has completed a task (with a labeled annotation)
 */
export function hasUserCompletedTask(task: AnnotationTaskOut, userId: string): boolean {
  const annotations = task.annotations || [];
  return annotations.some((a) => a.created_by_user_id === userId && a.label_id != null);
}

/**
 * Get current user's assignment status for a task
 */
export function getUserAssignmentStatus(
  task: AnnotationTaskOut,
  userId: string
): 'not-assigned' | 'pending' | 'completed' | 'skipped' {
  const assignments = task.assignments || [];
  const assignment = assignments.find((a) => a.user_id === userId);

  if (!assignment) {
    return 'not-assigned';
  }

  if (assignment.status === 'skipped') {
    return 'skipped';
  }

  return hasUserCompletedTask(task, userId) ? 'completed' : 'pending';
}
