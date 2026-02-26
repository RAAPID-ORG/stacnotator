import type { AnnotationTaskOut } from '~/api/client';

export type TaskStatus = 'pending' | 'partial' | 'conflicting' | 'complete' | 'skipped';

/**
 * Task status configuration with colors and labels
 */
export const TASK_STATUS_CONFIG = {
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
  complete: {
    label: 'Complete',
    color: '#10B981', // green
    badgeClass: 'bg-green-100 text-green-700',
  },
  skipped: {
    label: 'Skipped',
    color: '#8B5CF6', // violet
    badgeClass: 'bg-violet-100 text-violet-700',
  },
} as const;

/**
 * Compute overall task status based on assignments and annotations
 *
 * - pending: No user has completed (no annotations)
 * - skipped: All assigned users have skipped the task
 * - partial: Some users have completed, but not all
 * - conflicting: All assigned users have completed, but labels differ
 * - complete: All assigned users have completed with same label
 */
export function getTaskStatus(task: AnnotationTaskOut): TaskStatus {
  const assignments = task.assignments || [];
  const annotations = task.annotations || [];

  // If no assignments, fall back to simple check
  if (assignments.length === 0) {
    return annotations.length > 0 ? 'complete' : 'pending';
  }

  // Check if all assignments are skipped
  const allSkipped = assignments.every((a) => a.status === 'skipped');
  if (allSkipped) {
    return 'skipped';
  }

  // Count how many users have completed (done or skipped count as "acted on")
  const assignedUserIds = new Set(assignments.map((a) => a.user_id));
  const completedUserIds = new Set(annotations.map((a) => a.created_by_user_id));

  const completedCount = Array.from(assignedUserIds).filter((userId) =>
    completedUserIds.has(userId)
  ).length;

  // No completions (some may have skipped, but not all)
  if (completedCount === 0) {
    return 'pending';
  }

  // Partial completions (count non-skipped assignments)
  const nonSkippedAssignments = assignments.filter((a) => a.status !== 'skipped');
  const nonSkippedUserIds = new Set(nonSkippedAssignments.map((a) => a.user_id));
  const nonSkippedCompletedCount = Array.from(nonSkippedUserIds).filter((userId) =>
    completedUserIds.has(userId)
  ).length;

  if (nonSkippedCompletedCount < nonSkippedUserIds.size) {
    return 'partial';
  }

  // All non-skipped users have completed - check if labels match
  const labels = annotations
    .filter((a) => nonSkippedUserIds.has(a.created_by_user_id))
    .map((a) => a.label_id);

  // Check if all labels are the same (including null)
  const uniqueLabels = new Set(labels);

  if (uniqueLabels.size === 1) {
    return 'complete';
  } else {
    return 'conflicting';
  }
}

/**
 * Get user-specific completion status for a task
 * Returns the status for each assigned user
 */
export function getUserTaskStatuses(
  task: AnnotationTaskOut
): Map<string, 'pending' | 'completed' | 'skipped'> {
  const statusMap = new Map<string, 'pending' | 'completed' | 'skipped'>();
  const assignments = task.assignments || [];
  const annotations = task.annotations || [];
  const completedUserIds = new Set(annotations.map((a) => a.created_by_user_id));

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
 * Get status badge color class based on task status
 */
export function getTaskStatusColor(status: TaskStatus): string {
  return TASK_STATUS_CONFIG[status].badgeClass;
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
  return TASK_STATUS_CONFIG[status].label;
}

/**
 * Check if current user has completed a task
 */
export function hasUserCompletedTask(task: AnnotationTaskOut, userId: string): boolean {
  const annotations = task.annotations || [];
  return annotations.some((a) => a.created_by_user_id === userId);
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
