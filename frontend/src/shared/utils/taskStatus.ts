import type { AnnotationTaskOut } from '~/api/client';

/**
 * Task-level status values, matching backend-computed task_status. The tuple is what
 * lets a caller walk every status without restating the list.
 */
export const TASK_STATUSES = ['pending', 'partial', 'conflicting', 'done', 'skipped'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

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
    const s = t.task_status;
    if (s !== undefined && s in counts) counts[s]++;
  }
  return counts;
}
