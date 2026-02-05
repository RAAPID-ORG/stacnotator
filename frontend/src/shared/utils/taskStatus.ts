import type { AnnotationTaskOut, AnnotationTaskAssignmentOut } from '~/api/client';

export type TaskStatus = 'pending' | 'partial' | 'conflicting' | 'complete';

/**
 * Compute overall task status based on assignments and annotations
 * 
 * - pending: No user has completed (no annotations)
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

  // Count how many users have completed
  const assignedUserIds = new Set(assignments.map(a => a.user_id));
  const completedUserIds = new Set(annotations.map(a => a.created_by_user_id));
  
  const completedCount = Array.from(assignedUserIds).filter(
    userId => completedUserIds.has(userId)
  ).length;

  // No completions
  if (completedCount === 0) {
    return 'pending';
  }

  // Partial completions
  if (completedCount < assignedUserIds.size) {
    return 'partial';
  }

  // All users have completed - check if labels match
  const labels = annotations
    .filter(a => assignedUserIds.has(a.created_by_user_id))
    .map(a => a.label_id);
  
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
export function getUserTaskStatuses(task: AnnotationTaskOut): Map<string, 'pending' | 'completed'> {
  const statusMap = new Map<string, 'pending' | 'completed'>();
  const assignments = task.assignments || [];
  const annotations = task.annotations || [];
  const completedUserIds = new Set(annotations.map(a => a.created_by_user_id));

  assignments.forEach(assignment => {
    statusMap.set(
      assignment.user_id,
      completedUserIds.has(assignment.user_id) ? 'completed' : 'pending'
    );
  });

  return statusMap;
}

/**
 * Get status badge color class based on task status
 */
export function getTaskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-gray-100 text-gray-700';
    case 'partial':
      return 'bg-yellow-100 text-yellow-700';
    case 'conflicting':
      return 'bg-red-100 text-red-700';
    case 'complete':
      return 'bg-green-100 text-green-700';
  }
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
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Check if current user has completed a task
 */
export function hasUserCompletedTask(task: AnnotationTaskOut, userId: string): boolean {
  const annotations = task.annotations || [];
  return annotations.some(a => a.created_by_user_id === userId);
}

/**
 * Get current user's assignment status for a task
 */
export function getUserAssignmentStatus(
  task: AnnotationTaskOut,
  userId: string
): 'not-assigned' | 'pending' | 'completed' {
  const assignments = task.assignments || [];
  const isAssigned = assignments.some(a => a.user_id === userId);
  
  if (!isAssigned) {
    return 'not-assigned';
  }

  return hasUserCompletedTask(task, userId) ? 'completed' : 'pending';
}
